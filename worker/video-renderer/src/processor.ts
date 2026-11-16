import path from "node:path";
import {
  stageJobAssetsToTempWorkspace,
  WorkerAssetValidationError,
  type StagedJobAssetsResult,
} from "./assets";
import {
  WorkerApiConnectionError,
  WorkerApiHttpError,
  WorkerApiTimeoutError,
  type RenderWorkerApiClient,
  type WorkerCompletionPayload,
  type WorkerUploadedJobOutput,
} from "./client";
import {
  checkFfmpegEnvironment,
  sanitizeFfmpegErrorText,
  WorkerFfmpegError,
  type FfmpegEnvironmentStatus,
  type VerifiedMp4OutputMetadata,
} from "./ffmpeg";
import type { WorkerLogger } from "./logger";
import {
  parseAndValidateTransitionConfig,
  renderStagedSnapshotToMp4,
  WorkerRenderValidationError,
} from "./render-engine";
import { workerRenderSnapshotSchema, type WorkerClaimedJob } from "./schemas";

export const PART_C31_NOT_IMPLEMENTED_MESSAGE =
  "FFmpeg video rendering is not implemented yet in Phase 3 Part C3.1; placeholder processor left job status unchanged without calling fail or complete.";

export type JobProcessResult =
  | {
      outcome: "completed";
      jobId: string;
      outputStorageKey: string;
      checksumSha256: string;
      outputMetadata: WorkerCompletionPayload["outputMetadata"];
      probeMetadata: VerifiedMp4OutputMetadata;
      workspaceCleaned: boolean;
    }
  | {
      outcome: "rendered_awaiting_upload";
      jobId: string;
      outputFilePath: string;
      workspaceDir: string;
      intermediatesCleaned: boolean;
      outputMetadata: WorkerCompletionPayload["outputMetadata"];
      probeMetadata: VerifiedMp4OutputMetadata;
      cleanup: () => Promise<void>;
    }
  | { outcome: "cancelled"; jobId: string; reason: string }
  | { outcome: "failed"; jobId: string; error: string; preservedOutputFilePath?: string }
  | { outcome: "not_implemented_skipped"; jobId: string }
  | { outcome: "invalid_snapshot"; jobId: string };

export type ProcessClaimedRenderJobParams = {
  job: WorkerClaimedJob;
  client: RenderWorkerApiClient;
  logger: WorkerLogger;
  ffmpegStatus?: FfmpegEnvironmentStatus;
  tempDir?: string;
  ffmpegTimeoutMs?: number;
  uploadTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  leaseDurationSec?: number;
  signal?: AbortSignal;
  progressThrottleMs?: number;
  progressMinStep?: number;
  /** Defaults to true (full C3.3 upload + completion). Set false only in isolated render-only tests. */
  uploadAndComplete?: boolean;
};

/**
 * Preserved Part C3.1 placeholder processor for non-rendering safety tests.
 */
export async function processClaimedRenderJobPlaceholder(
  params: ProcessClaimedRenderJobParams,
): Promise<JobProcessResult> {
  const { job, logger } = params;
  const ffmpegStatus = params.ffmpegStatus ?? (await checkFfmpegEnvironment());

  const parsedSnapshot = workerRenderSnapshotSchema.safeParse(job.snapshot);
  if (!parsedSnapshot.success) {
    const firstIssue = parsedSnapshot.error.issues[0];
    const reason = `Render snapshot failed worker validation (${firstIssue?.path.join(".") || "snapshot"}: ${firstIssue?.message ?? "invalid structure"}).`;

    logger.error(
      "Claimed render job snapshot failed worker validation; placeholder mode did not mutate job status",
      {
        jobId: job.id,
        projectId: job.projectId,
        reason,
      },
    );

    return { outcome: "invalid_snapshot", jobId: job.id };
  }

  const snap = parsedSnapshot.data;
  logger.info(
    "Validated immutable render snapshot in Part C3.1 placeholder processor (no-op; FFmpeg not implemented yet)",
    {
      jobId: job.id,
      projectId: snap.project.projectId,
      aspectRatio: snap.renderSettings.aspectRatio,
      dimensions: snap.renderSettings.dimensions,
      sceneCount: snap.scenes.length,
      totalDurationSec: snap.renderSettings.totalDurationSec,
      outputProvider: snap.outputDestination.provider,
      ffmpegAvailable: ffmpegStatus.ffmpeg.available,
      ffprobeAvailable: ffmpegStatus.ffprobe.available,
      note: PART_C31_NOT_IMPLEMENTED_MESSAGE,
    },
  );

  return { outcome: "not_implemented_skipped", jobId: job.id };
}

function isOwnershipRevocationHttpError(err: unknown): boolean {
  return err instanceof WorkerApiHttpError && (err.status === 409 || err.status === 403);
}

function isTransientWorkerApiError(err: unknown): boolean {
  if (err instanceof WorkerApiTimeoutError || err instanceof WorkerApiConnectionError) {
    return true;
  }
  if (err instanceof WorkerApiHttpError && err.status >= 500) {
    return true;
  }
  return false;
}

function formatSafeJobError(params: {
  err: unknown;
  secrets: readonly string[];
  redactDirs: readonly string[];
}): string {
  const raw =
    params.err instanceof Error && params.err.message.trim()
      ? params.err.message.trim()
      : "Unexpected video render failure.";
  return sanitizeFfmpegErrorText(raw, {
    secrets: params.secrets,
    redactDirs: params.redactDirs,
  }).slice(0, 900);
}

/**
 * Part C3.2.4 FFmpeg Render Job Processor:
 * - Validates immutable snapshot + transition rules without mutating source records.
 * - Verifies FFmpeg/FFprobe availability.
 * - Downloads private snapshot assets into isolated per-job workspace.
 * - Renders standardized H.264/AAC MP4 (`16:9`, `9:16`, or `1:1`) via safe child processes.
 * - Reports real FFmpeg progress + periodic heartbeats and handles cancellation / lease expiry immediately.
 * - Verifies final MP4 via FFprobe, cleans up intermediates, keeps temp output ready for C3.3,
 *   and NEVER uploads to Spaces or calls reportCompletion (`/complete`) in C3.2.4.
 */
export async function processClaimedRenderJob(
  params: ProcessClaimedRenderJobParams,
): Promise<JobProcessResult> {
  const { job, client, logger } = params;
  const secrets = [client.getWorkerSecretForRedaction()].filter(Boolean);
  const redactDirs = params.tempDir ? [params.tempDir] : [];

  if (params.signal?.aborted) {
    return {
      outcome: "cancelled",
      jobId: job.id,
      reason: "Render cancelled before job processing began.",
    };
  }

  const jobAbortController = new AbortController();
  let ownershipRevoked = false;
  let cancellationReason: string | null = null;
  let staged: StagedJobAssetsResult | null = null;

  const triggerCancellation = (reason: string, fromOwnershipRevocation = false) => {
    if (!cancellationReason) {
      cancellationReason = reason;
    }
    if (fromOwnershipRevocation) {
      ownershipRevoked = true;
    }
    if (!jobAbortController.signal.aborted) {
      jobAbortController.abort();
    }
  };

  const onExternalAbort = () => {
    triggerCancellation("Worker shutdown or external cancellation requested.");
  };
  if (params.signal) {
    params.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const reportFailureSafely = async (errorMessage: string, stage: string) => {
    if (ownershipRevoked) return;
    try {
      await client.reportFailure(job.id, { errorMessage, stage });
    } catch (failErr) {
      if (isOwnershipRevocationHttpError(failErr)) {
        triggerCancellation("Job ownership was revoked before failure could be reported.", true);
        return;
      }
      logger.warn("Failed to send failure status to REBX API", {
        jobId: job.id,
        error: formatSafeJobError({ err: failErr, secrets, redactDirs }),
      });
    }
  };

  // Validate immutable snapshot before any network asset download or FFmpeg spawn
  const parsedSnapshot = workerRenderSnapshotSchema.safeParse(job.snapshot);
  if (!parsedSnapshot.success) {
    const firstIssue = parsedSnapshot.error.issues[0];
    const safeReason = formatSafeJobError({
      err: new Error(
        `Render snapshot failed worker validation (${firstIssue?.path.join(".") || "snapshot"}: ${firstIssue?.message ?? "invalid structure"}).`,
      ),
      secrets,
      redactDirs,
    });
    logger.error("Claimed render job snapshot failed worker validation", {
      jobId: job.id,
      projectId: job.projectId,
      reason: safeReason,
    });
    await reportFailureSafely(safeReason, "Invalid render snapshot");
    if (params.signal) params.signal.removeEventListener("abort", onExternalAbort);
    return { outcome: "failed", jobId: job.id, error: safeReason };
  }

  const snap = parsedSnapshot.data;
  if (snap.project.projectId !== job.projectId) {
    const safeReason = "Claimed job snapshot projectId does not match job record.";
    logger.error(safeReason, { jobId: job.id, projectId: job.projectId });
    await reportFailureSafely(safeReason, "Invalid render snapshot");
    if (params.signal) params.signal.removeEventListener("abort", onExternalAbort);
    return { outcome: "failed", jobId: job.id, error: safeReason };
  }

  // Validate supported transition settings up-front before downloading assets
  try {
    parseAndValidateTransitionConfig({
      rawTransition: snap.renderSettings.transition,
      rawTransitionDurationSec: snap.renderSettings.transitionDurationSec,
      sceneCount: snap.scenes.length,
      minSceneDurationSec: Math.min(...snap.scenes.map((s) => s.durationSec)),
      sceneTransitions: snap.scenes.map((s) => s.transition),
    });
  } catch (err) {
    const safeReason = formatSafeJobError({ err, secrets, redactDirs });
    logger.error("Render job rejected due to unsupported transition configuration", {
      jobId: job.id,
      projectId: job.projectId,
      error: safeReason,
    });
    await reportFailureSafely(safeReason, "Unsupported transition setting");
    if (params.signal) params.signal.removeEventListener("abort", onExternalAbort);
    return { outcome: "failed", jobId: job.id, error: safeReason };
  }

  const ffmpegStatus = params.ffmpegStatus ?? (await checkFfmpegEnvironment({ secrets }));
  if (
    !ffmpegStatus.readyForPartC32Rendering ||
    !ffmpegStatus.ffmpeg.executablePath ||
    !ffmpegStatus.ffprobe.executablePath
  ) {
    const safeReason = formatSafeJobError({
      err: new Error(
        `FFmpeg/FFprobe executables are unavailable on worker (ffmpeg=${ffmpegStatus.ffmpeg.errorCode ?? "ok"}, ffprobe=${ffmpegStatus.ffprobe.errorCode ?? "ok"}).`,
      ),
      secrets,
      redactDirs,
    });
    logger.error("Worker cannot process render job because FFmpeg/FFprobe is unavailable", {
      jobId: job.id,
      ffmpegAvailable: ffmpegStatus.ffmpeg.available,
      ffprobeAvailable: ffmpegStatus.ffprobe.available,
    });
    await reportFailureSafely(safeReason, "FFmpeg unavailable");
    if (params.signal) params.signal.removeEventListener("abort", onExternalAbort);
    return { outcome: "failed", jobId: job.id, error: safeReason };
  }

  // Serialized progress & heartbeat queue so updates remain strictly monotonic and ordered
  const minStep = Math.max(1, params.progressMinStep ?? 2);
  const throttleMs = Math.max(100, params.progressThrottleMs ?? 1000);
  let lastSentProgress = Math.max(0, Math.min(95, job.progress));
  let highestQueuedProgress = lastSentProgress;
  let lastProgressSentAtMs = 0;
  let currentStage = job.stage ?? "Downloading private assets";
  let telemetryQueue: Promise<void> = Promise.resolve();

  const enqueueProgress = (targetPct: number, stageLabel: string, force = false) => {
    const clampedPct = Math.max(highestQueuedProgress, Math.min(99, Math.round(targetPct)));
    currentStage = stageLabel;
    if (ownershipRevoked || jobAbortController.signal.aborted) return;

    const now = Date.now();
    const delta = clampedPct - lastSentProgress;
    const elapsed = now - lastProgressSentAtMs;
    const shouldSend =
      force
        ? clampedPct > highestQueuedProgress || stageLabel !== job.stage
        : clampedPct > highestQueuedProgress && (delta >= minStep || elapsed >= throttleMs);

    if (!shouldSend) return;
    highestQueuedProgress = clampedPct;

    telemetryQueue = telemetryQueue.then(async () => {
      if (ownershipRevoked || jobAbortController.signal.aborted) return;
      try {
        await client.reportProgress(job.id, {
          progress: clampedPct,
          stage: stageLabel,
        });
        lastSentProgress = clampedPct;
        lastProgressSentAtMs = Date.now();
      } catch (err) {
        if (isOwnershipRevocationHttpError(err)) {
          const msg = `Server revoked job ownership during progress update (${(err as WorkerApiHttpError).code ?? (err as WorkerApiHttpError).status}).`;
          logger.warn(msg, { jobId: job.id, status: (err as WorkerApiHttpError).status });
          triggerCancellation(msg, true);
          return;
        }
        logger.warn("Transient error sending worker progress update; continuing render", {
          jobId: job.id,
          error: formatSafeJobError({ err, secrets, redactDirs }),
        });
      }
    });
  };

  const leaseSec = params.leaseDurationSec ?? client.getLeaseDurationSec();
  const heartbeatIntervalMs =
    params.heartbeatIntervalMs ??
    Math.max(5_000, Math.min(30_000, Math.floor((leaseSec * 1000) / 3)));

  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (ownershipRevoked || jobAbortController.signal.aborted || heartbeatInFlight) return;
    heartbeatInFlight = true;
    telemetryQueue = telemetryQueue
      .then(async () => {
        if (ownershipRevoked || jobAbortController.signal.aborted) return;
        try {
          await client.sendHeartbeat(job.id, { stage: currentStage });
        } catch (err) {
          if (isOwnershipRevocationHttpError(err)) {
            const msg = `Server revoked job ownership during heartbeat (${(err as WorkerApiHttpError).code ?? (err as WorkerApiHttpError).status}).`;
            logger.warn(msg, { jobId: job.id, status: (err as WorkerApiHttpError).status });
            triggerCancellation(msg, true);
            return;
          }
          logger.warn("Transient error sending worker heartbeat", {
            jobId: job.id,
            error: formatSafeJobError({ err, secrets, redactDirs }),
          });
        }
      })
      .finally(() => {
        heartbeatInFlight = false;
      });
  }, heartbeatIntervalMs);
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }

  let preservedRenderedOutputPath: string | null = null;
  let failureStageOverride: string | null = null;

  try {
    // Stage 0 -> 5%: Download private assets into per-job temp workspace
    enqueueProgress(Math.max(lastSentProgress, 5), "Downloading private snapshot assets", true);
    await telemetryQueue;
    if (ownershipRevoked || jobAbortController.signal.aborted) {
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled prior to asset staging.",
      };
    }

    staged = await stageJobAssetsToTempWorkspace({
      job,
      transport: client,
      logger,
      tempDir: params.tempDir,
    });
    redactDirs.push(staged.workspaceDir);

    if (ownershipRevoked || jobAbortController.signal.aborted) {
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled after asset staging.",
      };
    }

    // 15%: Probing staged assets & encoding video via real FFmpeg progress telemetry (15 -> 94%)
    enqueueProgress(Math.max(lastSentProgress, 15), "Preparing FFmpeg video render", true);
    await telemetryQueue;
    if (ownershipRevoked || jobAbortController.signal.aborted) {
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled before FFmpeg encoding.",
      };
    }

    const renderResult = await renderStagedSnapshotToMp4({
      staged,
      ffmpegStatus,
      timeoutMs: params.ffmpegTimeoutMs,
      signal: jobAbortController.signal,
      secrets,
      logger,
      onRenderProgress: (info) => {
        const mappedPct = 15 + Math.round(info.ratio * 79); // 15..94%
        enqueueProgress(mappedPct, info.stageLabel, info.phase === "verifying");
      },
    });

    await telemetryQueue;

    if (ownershipRevoked || jobAbortController.signal.aborted) {
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled during final verification.",
      };
    }

    // 95%: MP4 rendered and verified by FFprobe
    enqueueProgress(95, "MP4 rendered and verified", true);
    await telemetryQueue;

    if (ownershipRevoked || jobAbortController.signal.aborted) {
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled before finalizing temporary output.",
      };
    }

    const baseOutputMetadata: WorkerCompletionPayload["outputMetadata"] = {
      container: "mp4",
      aspectRatio: renderResult.aspectRatio,
      width: renderResult.width,
      height: renderResult.height,
      fps: renderResult.fps,
      sceneCount: renderResult.sceneCount,
      totalDurationSec: snap.renderSettings.totalDurationSec,
      fileSizeBytes: renderResult.fileSizeBytes,
      renderedDurationSec: renderResult.renderedDurationSec,
      renderedAt: new Date().toISOString(),
      videoCodec: renderResult.probeMetadata.videoCodec,
      audioCodec: renderResult.probeMetadata.audioCodec,
      pixelFormat: renderResult.probeMetadata.pixelFormat,
      ...(renderResult.probeMetadata.bitRate != null
        ? { bitRate: renderResult.probeMetadata.bitRate }
        : {}),
      storageProvider: snap.outputDestination.provider,
    };

    if (params.uploadAndComplete === false) {
      logger.info("Completed Part C3.2.4 local MP4 rendering; output staged for C3.3 upload", {
        jobId: job.id,
        projectId: job.projectId,
        outputFilename: path.basename(renderResult.outputFilePath),
        width: baseOutputMetadata.width,
        height: baseOutputMetadata.height,
        fps: baseOutputMetadata.fps,
        fileSizeBytes: baseOutputMetadata.fileSizeBytes,
        renderedDurationSec: baseOutputMetadata.renderedDurationSec,
        intermediatesCleaned: renderResult.intermediatesCleaned,
      });

      return {
        outcome: "rendered_awaiting_upload",
        jobId: job.id,
        outputFilePath: renderResult.outputFilePath,
        workspaceDir: staged.workspaceDir,
        intermediatesCleaned: renderResult.intermediatesCleaned,
        outputMetadata: baseOutputMetadata,
        probeMetadata: renderResult.probeMetadata,
        cleanup: staged.cleanup,
      };
    }

    // Preserve recoverable rendered MP4 on disk if upload or /complete fails prematurely
    preservedRenderedOutputPath = renderResult.outputFilePath;

    // 96%: Upload verified temporary MP4 to private storage (with bounded transient retry)
    enqueueProgress(96, "Uploading rendered MP4 to private storage", true);
    await telemetryQueue;

    if (ownershipRevoked || jobAbortController.signal.aborted) {
      preservedRenderedOutputPath = null;
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled prior to output upload.",
      };
    }

    failureStageOverride = "Output upload failed";
    let uploaded: WorkerUploadedJobOutput | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        uploaded = await client.uploadJobOutput({
          jobId: job.id,
          outputFilePath: renderResult.outputFilePath,
          timeoutMs: params.uploadTimeoutMs,
          signal: jobAbortController.signal,
          redactDirs,
        });
        break;
      } catch (uploadErr) {
        if (
          ownershipRevoked ||
          jobAbortController.signal.aborted ||
          isOwnershipRevocationHttpError(uploadErr) ||
          attempt >= 2 ||
          !isTransientWorkerApiError(uploadErr)
        ) {
          throw uploadErr;
        }
        logger.warn("Transient error uploading rendered MP4; retrying once", {
          jobId: job.id,
          attempt,
          error: formatSafeJobError({ err: uploadErr, secrets, redactDirs }),
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    if (!uploaded) {
      throw new Error("Rendered MP4 upload did not produce a verified storage receipt.");
    }

    if (ownershipRevoked || jobAbortController.signal.aborted) {
      preservedRenderedOutputPath = null;
      await staged.cleanup();
      return {
        outcome: "cancelled",
        jobId: job.id,
        reason: cancellationReason ?? "Render cancelled after output upload.",
      };
    }

    // 99%: Verify uploaded MP4 and report completion to authenticated REBX endpoint
    enqueueProgress(99, "Finalizing completed render job", true);
    await telemetryQueue;

    const finalOutputMetadata: WorkerCompletionPayload["outputMetadata"] = {
      ...baseOutputMetadata,
      checksumSha256: uploaded.checksumSha256,
      ...(uploaded.etag ? { etag: uploaded.etag } : {}),
      storageProvider: uploaded.provider,
    };

    failureStageOverride = "Job completion failed";
    let completedJob = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        completedJob = await client.reportCompletion(job.id, {
          outputStorageKey: uploaded.outputStorageKey,
          stage: "Completed",
          outputMetadata: finalOutputMetadata,
        });
        break;
      } catch (completeErr) {
        if (
          ownershipRevoked ||
          jobAbortController.signal.aborted ||
          isOwnershipRevocationHttpError(completeErr) ||
          attempt >= 2 ||
          !isTransientWorkerApiError(completeErr)
        ) {
          throw completeErr;
        }
        logger.warn("Transient error reporting render job completion; retrying once", {
          jobId: job.id,
          attempt,
          error: formatSafeJobError({ err: completeErr, secrets, redactDirs }),
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    if (!completedJob) {
      throw new Error("Render job completion endpoint did not confirm completion.");
    }

    // Cleanup temporary MP4, intermediates, and per-job temp workspace ONLY AFTER durable upload + /complete succeed
    preservedRenderedOutputPath = null;
    let workspaceCleaned = false;
    try {
      await staged.cleanup();
      workspaceCleaned = true;
    } catch (cleanupErr) {
      logger.warn("Temporary workspace cleanup reported a non-fatal warning after job completion", {
        jobId: job.id,
        error: formatSafeJobError({ err: cleanupErr, secrets, redactDirs }),
      });
    }

    const finalKey = completedJob.outputStorageKey ?? uploaded.outputStorageKey;
    logger.info("Completed Part C3.3 render job end-to-end (MP4 uploaded, verified, and completed)", {
      jobId: job.id,
      projectId: job.projectId,
      outputStorageKey: finalKey,
      checksumSha256: uploaded.checksumSha256,
      width: finalOutputMetadata.width,
      height: finalOutputMetadata.height,
      fps: finalOutputMetadata.fps,
      fileSizeBytes: finalOutputMetadata.fileSizeBytes,
      renderedDurationSec: finalOutputMetadata.renderedDurationSec,
      workspaceCleaned,
    });

    return {
      outcome: "completed",
      jobId: job.id,
      outputStorageKey: finalKey,
      checksumSha256: uploaded.checksumSha256,
      outputMetadata: finalOutputMetadata,
      probeMetadata: renderResult.probeMetadata,
      workspaceCleaned,
    };
  } catch (err) {
    const isCancelledOrRevoked =
      ownershipRevoked ||
      jobAbortController.signal.aborted ||
      (err instanceof WorkerFfmpegError && err.code === "FFMPEG_CANCELLED") ||
      isOwnershipRevocationHttpError(err);

    if (isCancelledOrRevoked) {
      if (staged) {
        await staged.cleanup();
      }
      const reason =
        cancellationReason ??
        (err instanceof Error ? err.message : "Render job cancelled or lease expired.");
      logger.info("Render job aborted cleanly due to cancellation or expired lease", {
        jobId: job.id,
        reason: sanitizeFfmpegErrorText(reason, { secrets, redactDirs }),
      });
      return { outcome: "cancelled", jobId: job.id, reason };
    }

    // Only delete temporary workspace if no verified MP4 was produced yet;
    // if upload or /complete failed after rendering, preserve the temporary MP4 for recovery!
    if (staged && !preservedRenderedOutputPath) {
      await staged.cleanup();
    }

    const safeError = formatSafeJobError({ err, secrets, redactDirs });
    const stageLabel =
      failureStageOverride ??
      (err instanceof WorkerAssetValidationError
        ? "Asset validation failed"
        : err instanceof WorkerRenderValidationError
          ? "Render configuration failed"
          : err instanceof WorkerFfmpegError && err.code === "FFMPEG_TIMEOUT"
            ? "FFmpeg render timed out"
            : err instanceof WorkerFfmpegError && err.code === "INVALID_RENDER_OUTPUT"
              ? "MP4 verification failed"
              : "FFmpeg render failed");

    logger.error("Render job failed during worker execution", {
      jobId: job.id,
      projectId: job.projectId,
      stage: stageLabel,
      preservedTempOutput: Boolean(preservedRenderedOutputPath),
      error: safeError,
    });

    await reportFailureSafely(safeError, stageLabel);
    return {
      outcome: "failed",
      jobId: job.id,
      error: safeError,
      ...(preservedRenderedOutputPath ? { preservedOutputFilePath: preservedRenderedOutputPath } : {}),
    };
  } finally {
    clearInterval(heartbeatTimer);
    if (params.signal) {
      params.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
