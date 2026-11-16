import "server-only";
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import {
  assertStorageConfigured,
  deleteStoredRenderVideoBestEffort,
  prisma,
  RenderAssetStreamError,
  resolveRenderAssetsForScenes,
  verifySnapshotAssetsResolvable,
  verifyStoredRenderVideoObject,
  type UploadedRenderVideoResult,
} from "@/lib/video-studio/deps";
import {
  buildCanonicalSnapshotFingerprintPayload,
  buildPlannedOutputMetadata,
  buildRenderJobSnapshot,
  defaultStageForStatus,
  validateProjectForRender,
  validateRenderJobTransition,
  validateWorkerOutputMetadataMatchesSnapshot,
  validateWorkerOutputStorageKey,
  type RenderValidationProjectInput,
} from "@/lib/video-studio/render-validation";
import {
  ACTIVE_RENDER_JOB_STATUSES,
  DEFAULT_MAX_WORKER_AUTO_RETRIES,
  DEFAULT_WORKER_LEASE_SECONDS,
  extractDefaultCameraMotion,
  extractSceneCameraMotionMap,
  renderJobSnapshotSchema,
  sceneAudioMetadataSchema,
  workerClaimJobSchema,
  workerCompleteJobSchema,
  workerFailJobSchema,
  workerHeartbeatSchema,
  workerIdSchema,
  workerProgressSchema,
  workerRecoverLeasesSchema,
  type RenderJobOutputMetadata,
  type RenderJobSnapshot,
  type RenderJobStatus,
  type RenderJobSummary,
  type RenderValidationReport,
  type SceneCameraMotion,
} from "@/lib/video-studio/schemas";
import {
  extractAuthorizedSnapshotAssetManifest,
  isValidSnapshotAssetId,
  type AuthorizedSnapshotAsset,
} from "@/lib/video-studio/snapshot-assets";

export class RenderJobWorkerError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code = "WORKER_ERROR") {
    super(message);
    this.name = "RenderJobWorkerError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function hashRenderSnapshot(snapshot: RenderJobSnapshot): string {
  const canonical = buildCanonicalSnapshotFingerprintPayload(snapshot);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function serializeRenderJob(row: {
  id: string;
  projectId: string;
  createdById: number | null;
  status: string;
  progress: number;
  stage: string | null;
  errorMessage: string | null;
  snapshot: unknown;
  snapshotHash: string;
  outputStorageKey: string | null;
  outputMetadata: unknown;
  retryCount: number;
  workerId: string | null;
  leaseExpiresAt: Date | null;
  lastHeartbeatAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): RenderJobSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById ?? null,
    status: row.status as RenderJobStatus,
    progress: row.progress,
    stage: row.stage ?? null,
    errorMessage: row.errorMessage ?? null,
    snapshotHash: row.snapshotHash,
    outputStorageKey: row.outputStorageKey ?? null,
    outputMetadata: (row.outputMetadata as unknown as RenderJobOutputMetadata | null) ?? null,
    retryCount: row.retryCount,
    workerId: row.workerId ?? null,
    leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null,
    lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    snapshot: row.snapshot as unknown as RenderJobSnapshot,
  };
}

async function syncProjectStatusFromRenderJobs(
  tx: Prisma.TransactionClient,
  projectId: string,
  trigger:
    | { kind: "RENDER_ACTIVE" }
    | { kind: "RENDER_COMPLETED"; completedAt: Date }
    | { kind: "RENDER_FAILED" }
    | { kind: "RENDER_CANCELLED" },
): Promise<void> {
  if (trigger.kind === "RENDER_ACTIVE") {
    await tx.videoProject.updateMany({
      where: { id: projectId },
      data: { status: "PROCESSING" },
    });
    return;
  }

  const activeStatuses = [...ACTIVE_RENDER_JOB_STATUSES];
  const remainingActiveCount = await tx.videoRenderJob.count({
    where: {
      projectId,
      status: { in: activeStatuses },
    },
  });

  if (remainingActiveCount > 0) {
    await tx.videoProject.updateMany({
      where: { id: projectId },
      data: { status: "PROCESSING" },
    });
    return;
  }

  if (trigger.kind === "RENDER_COMPLETED") {
    const project = await tx.videoProject.findUnique({
      where: { id: projectId },
      select: { approvedAt: true },
    });
    if (!project) return;
    await tx.videoProject.update({
      where: { id: projectId },
      data: {
        status: "COMPLETED",
        approvedAt: project.approvedAt ?? trigger.completedAt,
      },
    });
    return;
  }

  if (trigger.kind === "RENDER_FAILED") {
    await tx.videoProject.updateMany({
      where: { id: projectId },
      data: { status: "FAILED" },
    });
    return;
  }

  // When cancelling the last active render job while project status was PROCESSING,
  // restore COMPLETED if an earlier completed render exists, otherwise return to DRAFT.
  const project = await tx.videoProject.findUnique({
    where: { id: projectId },
    select: { status: true },
  });
  if (!project || project.status !== "PROCESSING") return;

  const completedCount = await tx.videoRenderJob.count({
    where: {
      projectId,
      status: "COMPLETED",
    },
  });

  await tx.videoProject.update({
    where: { id: projectId },
    data: {
      status: completedCount > 0 ? "COMPLETED" : "DRAFT",
    },
  });
}

function extractRawSceneAudioEntry(metadata: unknown, sceneId: string): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const rawMap = (metadata as { sceneAudio?: unknown }).sceneAudio;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return null;
  }
  return (rawMap as Record<string, unknown>)[sceneId] ?? null;
}

async function loadAuthoritativeProjectForRender(projectId: string) {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: {
      scenes: {
        orderBy: [{ order: "asc" }, { position: "asc" }],
      },
    },
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  const sceneMotionMap = extractSceneCameraMotionMap(project.metadata);
  const defaultCameraMotion = extractDefaultCameraMotion(project.metadata);

  const input: RenderValidationProjectInput = {
    id: project.id,
    schemaVersion: project.schemaVersion,
    title: project.title,
    topic: project.topic,
    targetAudience: project.targetAudience,
    category: project.category,
    status: project.status,
    aspectRatio: project.aspectRatio,
    language: project.language,
    tone: project.tone,
    desiredDuration: project.duration,
    defaultCameraMotion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scenes: project.scenes.map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      imageUrl: s.imageUrl || s.imagePath || null,
      duration: s.duration,
      locked: s.locked,
      audio: extractRawSceneAudioEntry(project.metadata, s.id),
      cameraMotion: sceneMotionMap[s.id] ?? defaultCameraMotion,
    })),
  };

  return input;
}

export async function getProjectRenderReadiness(projectId: string): Promise<{
  report: RenderValidationReport;
  prepared?: {
    snapshot: RenderJobSnapshot;
    snapshotHash: string;
  };
}> {
  const { provider } = assertStorageConfigured();
  const project = await loadAuthoritativeProjectForRender(projectId);

  const assetCheckInput = project.scenes.map((s) => {
    const parsedAudio = s.audio ? sceneAudioMetadataSchema.safeParse(s.audio) : null;
    return {
      id: s.id,
      order: s.order,
      title: s.title,
      imageUrl: s.imageUrl,
      audio: parsedAudio?.success ? parsedAudio.data : null,
    };
  });

  const { issues: assetIssues, resolvedBySceneId } = await resolveRenderAssetsForScenes(assetCheckInput);
  const { report, versionedJson } = validateProjectForRender(project, assetIssues);

  if (!report.valid || !versionedJson) {
    return { report };
  }

  const resolvedScenes = versionedJson.scenes.map((scene) => {
    const resolved = resolvedBySceneId.get(scene.id);
    if (!resolved) {
      throw new Error(`Missing resolved storage reference for scene "${scene.title}".`);
    }
    return {
      sceneId: scene.id,
      order: scene.order,
      title: scene.title,
      narration: scene.narration,
      durationSec: scene.duration,
      image: resolved.image,
      audio: resolved.audio,
      cameraMotion: scene.cameraMotion ?? null,
    };
  });

  const snapshot = buildRenderJobSnapshot({
    versionedJson,
    resolvedScenes,
    storageProvider: provider,
    defaultCameraMotion: project.defaultCameraMotion as SceneCameraMotion | null ?? null,
  });
  const snapshotHash = hashRenderSnapshot(snapshot);

  return {
    report,
    prepared: {
      snapshot,
      snapshotHash,
    },
  };
}

export async function createRenderJobForProject(
  projectId: string,
  adminUserId: number,
): Promise<RenderJobSummary> {
  const { report, prepared } = await getProjectRenderReadiness(projectId);

  if (!report.valid || !prepared) {
    const summaryMsg =
      report.errors.length > 0
        ? report.errors.map((e) => e.message).join(" ")
        : "Project did not pass pre-render validation.";
    throw new Error(`Cannot create render job: ${summaryMsg}`);
  }

  const { snapshot, snapshotHash } = prepared;
  const activeStatuses = [...ACTIVE_RENDER_JOB_STATUSES];

  const createdJob = await prisma.$transaction(async (tx) => {
    // Re-check project exists cleanly inside transaction
    const exists = await tx.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) {
      throw new Error("Project not found.");
    }

    const existingDuplicate = await tx.videoRenderJob.findFirst({
      where: {
        projectId,
        snapshotHash,
        status: { in: activeStatuses },
      },
      select: { id: true, status: true },
    });

    if (existingDuplicate) {
      throw new Error(
        `Duplicate render job prevented: active job ${existingDuplicate.id} (${existingDuplicate.status}) already exists for this exact project snapshot. Cancel it or modify the project before creating another render job.`,
      );
    }

    const row = await tx.videoRenderJob.create({
      data: {
        projectId,
        createdById: adminUserId,
        status: "PENDING",
        progress: 0,
        stage: defaultStageForStatus("PENDING"),
        errorMessage: null,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotHash,
        outputStorageKey: null,
        retryCount: 0,
      },
    });

    const plannedMetadata = buildPlannedOutputMetadata({
      projectId,
      jobId: row.id,
      aspectRatio: snapshot.renderSettings.aspectRatio,
      sceneCount: snapshot.scenes.length,
      totalDurationSec: snapshot.renderSettings.totalDurationSec,
    });

    const updatedRow = await tx.videoRenderJob.update({
      where: { id: row.id },
      data: {
        outputMetadata: plannedMetadata as unknown as Prisma.InputJsonValue,
      },
    });

    await syncProjectStatusFromRenderJobs(tx, projectId, { kind: "RENDER_ACTIVE" });

    return updatedRow;
  }, { maxWait: 10000, timeout: 30000 });

  return serializeRenderJob(createdJob);
}

export async function getRenderJobForProject(
  projectId: string,
  jobId: string,
): Promise<RenderJobSummary> {
  const row = await prisma.videoRenderJob.findUnique({
    where: { id: jobId },
  });

  if (!row) {
    throw new Error("Render job not found.");
  }

  if (row.projectId !== projectId) {
    throw new Error("Unauthorized: Render job does not belong to this project.");
  }

  return serializeRenderJob(row);
}

export async function listRenderJobsForProject(projectId: string): Promise<RenderJobSummary[]> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) {
    throw new Error("Project not found.");
  }

  const rows = await prisma.videoRenderJob.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  return rows.map(serializeRenderJob);
}

export async function cancelRenderJobForProject(
  projectId: string,
  jobId: string,
): Promise<RenderJobSummary> {
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.videoRenderJob.findUnique({
      where: { id: jobId },
    });

    if (!row) {
      throw new Error("Render job not found.");
    }
    if (row.projectId !== projectId) {
      throw new Error("Unauthorized: Render job does not belong to this project.");
    }

    const check = validateRenderJobTransition({
      currentStatus: row.status as RenderJobStatus,
      currentProgress: row.progress,
      targetStatus: "CANCELLED",
      stage: "Cancelled by administrator",
    });

    if (!check.ok) {
      throw new Error(check.error);
    }

    const now = new Date();
    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: jobId,
        projectId,
        status: row.status,
      },
      data: {
        status: "CANCELLED",
        stage: check.nextStage,
        cancelledAt: now,
        workerId: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
      },
    });

    if (res.count !== 1) {
      throw new Error("Render job status changed concurrently. Please refresh and try again.");
    }

    await syncProjectStatusFromRenderJobs(tx, projectId, { kind: "RENDER_CANCELLED" });

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: jobId } });
  });

  return serializeRenderJob(updated);
}

function extractStaleUncommittedOutputKey(row: {
  outputStorageKey: string | null;
  outputMetadata: unknown;
  snapshot?: unknown;
}): { outputKey: string | null; provider: "local-private" | "spaces" } {
  const meta =
    row.outputMetadata && typeof row.outputMetadata === "object" && !Array.isArray(row.outputMetadata)
      ? (row.outputMetadata as Record<string, unknown>)
      : {};
  const snapProvider =
    row.snapshot &&
    typeof row.snapshot === "object" &&
    !Array.isArray(row.snapshot) &&
    typeof (row.snapshot as { outputDestination?: { provider?: unknown } }).outputDestination?.provider ===
      "string"
      ? (row.snapshot as { outputDestination: { provider: string } }).outputDestination.provider
      : null;
  const provider: "local-private" | "spaces" =
    meta.storageProvider === "spaces" || snapProvider === "spaces" ? "spaces" : "local-private";

  const uploadedKey =
    typeof meta.uploadedOutputKey === "string" && meta.uploadedOutputKey.trim()
      ? meta.uploadedOutputKey.trim()
      : null;
  const committedKey =
    typeof row.outputStorageKey === "string" && row.outputStorageKey.trim()
      ? row.outputStorageKey.trim()
      : null;

  return {
    outputKey: uploadedKey ?? committedKey,
    provider,
  };
}

function stripStaleUploadMetadataForRequeue(rawMeta: unknown): Prisma.InputJsonValue | undefined {
  if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
    return undefined;
  }
  const rest = { ...(rawMeta as Record<string, unknown>) };
  delete rest.uploadedOutputKey;
  delete rest.uploadedFileSizeBytes;
  delete rest.uploadedChecksumSha256;
  delete rest.uploadedEtag;
  delete rest.uploadedAt;
  delete rest.fileSizeBytes;
  delete rest.checksumSha256;
  delete rest.renderedDurationSec;
  delete rest.renderedAt;
  delete rest.etag;
  delete rest.videoCodec;
  delete rest.audioCodec;
  delete rest.pixelFormat;
  delete rest.bitRate;
  rest.workerPendingPartC3 = true;
  return rest as Prisma.InputJsonValue;
}

export async function retryRenderJobForProject(
  projectId: string,
  jobId: string,
): Promise<RenderJobSummary> {
  const current = await prisma.videoRenderJob.findUnique({
    where: { id: jobId },
  });

  if (!current) {
    throw new Error("Render job not found.");
  }
  if (current.projectId !== projectId) {
    throw new Error("Unauthorized: Render job does not belong to this project.");
  }

  const transitionCheck = validateRenderJobTransition({
    currentStatus: current.status as RenderJobStatus,
    currentProgress: current.progress,
    targetStatus: "QUEUED",
    progress: 0,
    stage: "Queued for retry (awaiting Part C3 worker)",
  });

  if (!transitionCheck.ok) {
    throw new Error(transitionCheck.error);
  }

  // Ensure frozen snapshot assets are still resolvable before re-queueing
  const snapshot = current.snapshot as unknown as RenderJobSnapshot;
  const assetsOk = await verifySnapshotAssetsResolvable(snapshot);
  if (!assetsOk.ok) {
    throw new Error(assetsOk.error);
  }

  const activeStatuses = [...ACTIVE_RENDER_JOB_STATUSES];
  let staleOutputToDelete: { outputKey: string | null; provider: "local-private" | "spaces" } = {
    outputKey: null,
    provider: "local-private",
  };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.videoRenderJob.findUnique({
      where: { id: jobId },
    });
    if (!row || row.projectId !== projectId || row.status !== "FAILED") {
      throw new Error(
        `Invalid render job status transition: ${row?.status ?? "UNKNOWN"} -> QUEUED.`,
      );
    }

    const duplicateActive = await tx.videoRenderJob.findFirst({
      where: {
        id: { not: jobId },
        projectId,
        snapshotHash: row.snapshotHash,
        status: { in: activeStatuses },
      },
      select: { id: true, status: true },
    });
    if (duplicateActive) {
      throw new Error(
        `Cannot retry job because active render job ${duplicateActive.id} (${duplicateActive.status}) already exists for the same snapshot.`,
      );
    }

    staleOutputToDelete = extractStaleUncommittedOutputKey(row);
    const cleanedMeta = stripStaleUploadMetadataForRequeue(row.outputMetadata);

    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: jobId,
        projectId,
        status: "FAILED",
      },
      data: {
        status: "QUEUED",
        progress: 0,
        stage: transitionCheck.nextStage,
        errorMessage: null,
        workerId: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        outputStorageKey: null,
        ...(cleanedMeta !== undefined ? { outputMetadata: cleanedMeta } : {}),
        retryCount: { increment: 1 },
      },
    });

    if (res.count !== 1) {
      throw new Error("Render job status changed concurrently. Please refresh and try again.");
    }

    await syncProjectStatusFromRenderJobs(tx, projectId, { kind: "RENDER_ACTIVE" });

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: jobId } });
  });

  if (staleOutputToDelete.outputKey) {
    await deleteStoredRenderVideoBestEffort({
      outputStorageKey: staleOutputToDelete.outputKey,
      projectId,
      jobId,
      provider: staleOutputToDelete.provider,
    });
  }

  return serializeRenderJob(updated);
}

/**
 * Server-only internal transition engine reserved for server-side orchestration,
 * automated tests, and the future Part C3 FFmpeg worker callback/coordinator.
 * Never exported from any "use server" module, so the browser cannot invoke it.
 */
export async function transitionRenderJobInternal(params: {
  projectId: string;
  jobId: string;
  targetStatus: RenderJobStatus;
  progress?: number;
  stage?: string | null;
  errorMessage?: string | null;
  outputStorageKey?: string | null;
  outputMetadataPatch?: Partial<RenderJobOutputMetadata>;
}): Promise<RenderJobSummary> {
  let staleOutputToDelete: { outputKey: string | null; provider: "local-private" | "spaces" } = {
    outputKey: null,
    provider: "local-private",
  };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.videoRenderJob.findUnique({
      where: { id: params.jobId },
    });

    if (!row) {
      throw new Error("Render job not found.");
    }
    if (row.projectId !== params.projectId) {
      throw new Error("Unauthorized: Render job does not belong to this project.");
    }

    const currentStatus = row.status as RenderJobStatus;
    const check = validateRenderJobTransition({
      currentStatus,
      currentProgress: row.progress,
      targetStatus: params.targetStatus,
      progress: params.progress,
      stage: params.stage,
      errorMessage: params.errorMessage,
      outputStorageKey: params.outputStorageKey,
    });

    if (!check.ok) {
      throw new Error(check.error);
    }

    const now = new Date();
    const existingOutputMeta = (row.outputMetadata as Record<string, unknown> | null) ?? {};
    const nextOutputMeta = params.outputMetadataPatch
      ? { ...existingOutputMeta, ...params.outputMetadataPatch }
      : existingOutputMeta;

    const updateData: Prisma.VideoRenderJobUpdateManyMutationInput = {
      status: params.targetStatus,
      progress: check.nextProgress,
      stage: check.nextStage,
    };

    if (params.targetStatus === "PROCESSING") {
      if (!row.startedAt) {
        updateData.startedAt = now;
      }
      updateData.errorMessage = null;
    } else if (params.targetStatus === "COMPLETED") {
      updateData.outputStorageKey = params.outputStorageKey!.trim();
      updateData.errorMessage = null;
      updateData.completedAt = now;
      updateData.leaseExpiresAt = null;
      updateData.outputMetadata = {
        ...nextOutputMeta,
        workerPendingPartC3: false,
        renderedAt: now.toISOString(),
      } as unknown as Prisma.InputJsonValue;
    } else if (params.targetStatus === "FAILED") {
      updateData.errorMessage = params.errorMessage!.trim();
      updateData.outputStorageKey = null;
      updateData.leaseExpiresAt = null;
    } else if (params.targetStatus === "CANCELLED") {
      updateData.cancelledAt = now;
      updateData.workerId = null;
      updateData.leaseExpiresAt = null;
      updateData.lastHeartbeatAt = null;
    } else if (params.targetStatus === "QUEUED") {
      staleOutputToDelete = extractStaleUncommittedOutputKey(row);
      const cleanedMeta = stripStaleUploadMetadataForRequeue(nextOutputMeta);
      updateData.errorMessage = null;
      updateData.cancelledAt = null;
      updateData.completedAt = null;
      updateData.startedAt = null;
      updateData.workerId = null;
      updateData.leaseExpiresAt = null;
      updateData.lastHeartbeatAt = null;
      updateData.outputStorageKey = null;
      if (cleanedMeta !== undefined) {
        updateData.outputMetadata = cleanedMeta;
      }
      if (currentStatus === "FAILED") {
        updateData.retryCount = { increment: 1 };
      }
    }

    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: params.jobId,
        projectId: params.projectId,
        status: row.status,
      },
      data: updateData,
    });

    if (res.count !== 1) {
      throw new Error("Render job status changed concurrently.");
    }

    if (params.targetStatus === "QUEUED" || params.targetStatus === "PROCESSING") {
      await syncProjectStatusFromRenderJobs(tx, params.projectId, { kind: "RENDER_ACTIVE" });
    } else if (params.targetStatus === "COMPLETED") {
      await syncProjectStatusFromRenderJobs(tx, params.projectId, {
        kind: "RENDER_COMPLETED",
        completedAt: now,
      });
    } else if (params.targetStatus === "FAILED") {
      await syncProjectStatusFromRenderJobs(tx, params.projectId, { kind: "RENDER_FAILED" });
    } else if (params.targetStatus === "CANCELLED") {
      await syncProjectStatusFromRenderJobs(tx, params.projectId, { kind: "RENDER_CANCELLED" });
    }

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: params.jobId } });
  });

  if (params.targetStatus === "QUEUED" && staleOutputToDelete.outputKey) {
    await deleteStoredRenderVideoBestEffort({
      outputStorageKey: staleOutputToDelete.outputKey,
      projectId: params.projectId,
      jobId: params.jobId,
      provider: staleOutputToDelete.provider,
    });
  }

  return serializeRenderJob(updated);
}

/* ==================== Part C3.1 Worker Coordination Engine ==================== */

class ClaimRaceConflictError extends Error {
  constructor() {
    super("Concurrent worker claim conflict");
    this.name = "ClaimRaceConflictError";
  }
}

function isRetryableConcurrencyError(err: unknown): boolean {
  if (err instanceof ClaimRaceConflictError) return true;
  const code = (err as { code?: string })?.code;
  if (code === "P2034") return true;
  const msg = err instanceof Error ? err.message : "";
  return /deadlock|lock wait/i.test(msg);
}

/**
 * Recovers PROCESSING render jobs whose worker lease has expired.
 * Jobs below maxAutoRetries (default 3) are re-queued atomically if assets remain resolvable
 * and no duplicate active job exists; exhausted jobs are marked permanently FAILED so crashed
 * jobs never retry infinitely.
 */
export async function recoverExpiredRenderJobs(rawOptions?: unknown): Promise<{
  checkedCount: number;
  requeuedJobIds: string[];
  failedJobIds: string[];
}> {
  const parsedOpts = rawOptions ? workerRecoverLeasesSchema.parse(rawOptions) : {};
  const maxAutoRetries = parsedOpts.maxAutoRetries ?? DEFAULT_MAX_WORKER_AUTO_RETRIES;
  const now = new Date();
  const activeStatuses = [...ACTIVE_RENDER_JOB_STATUSES];

  const expiredRows = await prisma.videoRenderJob.findMany({
    where: {
      status: "PROCESSING",
      leaseExpiresAt: {
        not: null,
        lt: now,
      },
    },
    orderBy: [{ leaseExpiresAt: "asc" }],
    take: 25,
  });

  const requeuedJobIds: string[] = [];
  const failedJobIds: string[] = [];

  for (const row of expiredRows) {
    if (!row.leaseExpiresAt) continue;

    const failMsgBase = `Render worker${row.workerId ? ` (${row.workerId})` : ""} lease expired at ${row.leaseExpiresAt.toISOString()}.`;
    let shouldRequeue = row.retryCount < maxAutoRetries;
    let blockReason = "";

    if (!shouldRequeue) {
      blockReason = `Exceeded maximum automatic recovery attempts (${maxAutoRetries}).`;
    } else {
      const parsedSnapshot = renderJobSnapshotSchema.safeParse(row.snapshot);
      if (!parsedSnapshot.success) {
        shouldRequeue = false;
        blockReason = "Render snapshot failed schema validation.";
      } else {
        const assetsOk = await verifySnapshotAssetsResolvable(parsedSnapshot.data);
        if (!assetsOk.ok) {
          shouldRequeue = false;
          blockReason = assetsOk.error;
        }
      }
    }

    const failCheck = validateRenderJobTransition({
      currentStatus: "PROCESSING",
      currentProgress: row.progress,
      targetStatus: "FAILED",
      stage: "Worker lease expired",
      errorMessage: blockReason ? `${failMsgBase} ${blockReason}` : failMsgBase,
    });
    const requeueCheck = shouldRequeue
      ? validateRenderJobTransition({
          currentStatus: "FAILED",
          currentProgress: row.progress,
          targetStatus: "QUEUED",
          progress: 0,
          stage: "Re-queued after worker lease expiry",
        })
      : null;

    if (!failCheck.ok || (shouldRequeue && !requeueCheck?.ok)) {
      continue;
    }

    let staleOutputToDelete: { outputKey: string | null; provider: "local-private" | "spaces" } = {
      outputKey: null,
      provider: "local-private",
    };

    const outcome = await prisma.$transaction(async (tx) => {
      const fresh = await tx.videoRenderJob.findUnique({ where: { id: row.id } });
      if (
        !fresh ||
        fresh.status !== "PROCESSING" ||
        !fresh.leaseExpiresAt ||
        fresh.leaseExpiresAt.getTime() !== row.leaseExpiresAt!.getTime() ||
        fresh.leaseExpiresAt.getTime() >= now.getTime()
      ) {
        return null;
      }

      let canRequeueInTx = shouldRequeue && fresh.retryCount < maxAutoRetries;
      let finalReason = blockReason;

      if (canRequeueInTx) {
        const dup = await tx.videoRenderJob.findFirst({
          where: {
            id: { not: fresh.id },
            projectId: fresh.projectId,
            snapshotHash: fresh.snapshotHash,
            status: { in: activeStatuses },
          },
          select: { id: true },
        });
        if (dup) {
          canRequeueInTx = false;
          finalReason = `Duplicate active job (${dup.id}) already exists for the same snapshot.`;
        }
      }

      if (canRequeueInTx && requeueCheck?.ok) {
        staleOutputToDelete = extractStaleUncommittedOutputKey(fresh);
        const cleanedMeta = stripStaleUploadMetadataForRequeue(fresh.outputMetadata);

        const res = await tx.videoRenderJob.updateMany({
          where: {
            id: fresh.id,
            status: "PROCESSING",
            workerId: fresh.workerId,
            leaseExpiresAt: fresh.leaseExpiresAt,
          },
          data: {
            status: "QUEUED",
            progress: 0,
            stage: requeueCheck.nextStage,
            errorMessage: null,
            workerId: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            startedAt: null,
            completedAt: null,
            cancelledAt: null,
            outputStorageKey: null,
            ...(cleanedMeta !== undefined ? { outputMetadata: cleanedMeta } : {}),
            retryCount: { increment: 1 },
          },
        });
        if (res.count === 1) {
          await syncProjectStatusFromRenderJobs(tx, fresh.projectId, { kind: "RENDER_ACTIVE" });
          return "requeued";
        }
        return null;
      }

      const terminalMsg = `${failMsgBase} ${finalReason || "Manual retry required."}`.trim();
      const res = await tx.videoRenderJob.updateMany({
        where: {
          id: fresh.id,
          status: "PROCESSING",
          workerId: fresh.workerId,
          leaseExpiresAt: fresh.leaseExpiresAt,
        },
        data: {
          status: "FAILED",
          progress: fresh.progress,
          stage:
            fresh.retryCount >= maxAutoRetries
              ? "Lease expired (max retries reached)"
              : "Lease expired (recovery blocked)",
          errorMessage: terminalMsg,
          outputStorageKey: null,
          workerId: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: now,
        },
      });
      if (res.count === 1) {
        await syncProjectStatusFromRenderJobs(tx, fresh.projectId, { kind: "RENDER_FAILED" });
        return "failed";
      }
      return null;
    });

    if (outcome === "requeued") {
      if (staleOutputToDelete.outputKey) {
        await deleteStoredRenderVideoBestEffort({
          outputStorageKey: staleOutputToDelete.outputKey,
          projectId: row.projectId,
          jobId: row.id,
          provider: staleOutputToDelete.provider,
        });
      }
      requeuedJobIds.push(row.id);
    } else if (outcome === "failed") {
      failedJobIds.push(row.id);
    }
  }

  return {
    checkedCount: expiredRows.length,
    requeuedJobIds,
    failedJobIds,
  };
}

/**
 * Atomically claims the next eligible PENDING or QUEUED render job for a worker.
 * Two concurrent workers racing for the same job use optimistic conditional UPDATE guards
 * so at most one worker acquires the row and receives its immutable render snapshot.
 */
export async function claimNextRenderJobForWorker(rawInput: unknown): Promise<{
  claimed: boolean;
  job: RenderJobSummary | null;
  recoveredCount: number;
}> {
  const input = workerClaimJobSchema.parse(rawInput);
  const leaseDurationSec = input.leaseDurationSec ?? DEFAULT_WORKER_LEASE_SECONDS;

  let recoveredCount = 0;
  if (input.recoverExpiredLeases !== false) {
    const recovery = await recoverExpiredRenderJobs();
    recoveredCount = recovery.requeuedJobIds.length + recovery.failedJobIds.length;
  }

  const attemptedIds = new Set<string>();
  const MAX_CLAIM_ATTEMPTS = 12;

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const candidate = await tx.videoRenderJob.findFirst({
          where: {
            ...(attemptedIds.size > 0 ? { id: { notIn: Array.from(attemptedIds) } } : {}),
            status: { in: ["PENDING", "QUEUED"] },
            workerId: null,
          },
          orderBy: [{ createdAt: "asc" }],
        });

        if (!candidate) {
          return { claimed: false as const, job: null };
        }

        if (candidate.status === "PENDING") {
          const step1 = validateRenderJobTransition({
            currentStatus: "PENDING",
            currentProgress: candidate.progress,
            targetStatus: "QUEUED",
            progress: 0,
          });
          const step2 = validateRenderJobTransition({
            currentStatus: "QUEUED",
            currentProgress: 0,
            targetStatus: "PROCESSING",
            progress: 0,
            stage: "Claimed by render worker",
          });
          if (!step1.ok || !step2.ok) {
            attemptedIds.add(candidate.id);
            throw new ClaimRaceConflictError();
          }
        } else {
          const step = validateRenderJobTransition({
            currentStatus: candidate.status as RenderJobStatus,
            currentProgress: candidate.progress,
            targetStatus: "PROCESSING",
            progress: 0,
            stage: "Claimed by render worker",
          });
          if (!step.ok) {
            attemptedIds.add(candidate.id);
            throw new ClaimRaceConflictError();
          }
        }

        const parsedSnapshot = renderJobSnapshotSchema.safeParse(candidate.snapshot);
        if (!parsedSnapshot.success) {
          attemptedIds.add(candidate.id);
          const failRes = await tx.videoRenderJob.updateMany({
            where: {
              id: candidate.id,
              status: candidate.status,
              workerId: null,
            },
            data: {
              status: "FAILED",
              stage: "Invalid render snapshot",
              errorMessage: "Stored render snapshot failed schema validation.",
              workerId: null,
              leaseExpiresAt: null,
            },
          });
          if (failRes.count === 1) {
            await syncProjectStatusFromRenderJobs(tx, candidate.projectId, {
              kind: "RENDER_FAILED",
            });
          }
          throw new ClaimRaceConflictError();
        }

        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + leaseDurationSec * 1000);

        const res = await tx.videoRenderJob.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            workerId: null,
          },
          data: {
            status: "PROCESSING",
            progress: 0,
            stage: "Claimed by render worker",
            errorMessage: null,
            workerId: input.workerId,
            startedAt: candidate.startedAt ?? now,
            leaseExpiresAt,
            lastHeartbeatAt: now,
          },
        });

        if (res.count !== 1) {
          attemptedIds.add(candidate.id);
          throw new ClaimRaceConflictError();
        }

        await syncProjectStatusFromRenderJobs(tx, candidate.projectId, { kind: "RENDER_ACTIVE" });

        const claimedRow = await tx.videoRenderJob.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        return {
          claimed: true as const,
          job: serializeRenderJob(claimedRow),
        };
      });

      return {
        ...outcome,
        recoveredCount,
      };
    } catch (err) {
      if (isRetryableConcurrencyError(err) && attempt < MAX_CLAIM_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 5 + attempt * 5));
        continue;
      }
      if (isRetryableConcurrencyError(err)) {
        return {
          claimed: false,
          job: null,
          recoveredCount,
        };
      }
      throw err;
    }
  }

  return {
    claimed: false,
    job: null,
    recoveredCount,
  };
}

async function assertWorkerOwnsActiveProcessingJob(params: {
  tx: Prisma.TransactionClient;
  jobId: string;
  workerId: string;
  targetStatus: "PROCESSING" | "COMPLETED" | "FAILED";
  now: Date;
}) {
  const row = await params.tx.videoRenderJob.findUnique({
    where: { id: params.jobId },
  });

  if (!row) {
    throw new RenderJobWorkerError("Render job not found.", 404, "JOB_NOT_FOUND");
  }

  if (row.workerId && row.workerId !== params.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job is claimed by a different worker.",
      403,
      "WORKER_MISMATCH",
    );
  }

  if (row.status !== "PROCESSING") {
    if ((row.status === "PENDING" || row.status === "QUEUED") && !row.workerId) {
      throw new RenderJobWorkerError(
        "Forbidden: Worker cannot update or complete an unclaimed render job.",
        403,
        "UNCLAIMED_JOB",
      );
    }
    throw new RenderJobWorkerError(
      `Invalid render job status transition: ${row.status} -> ${params.targetStatus}.`,
      409,
      "INVALID_STATUS",
    );
  }

  if (!row.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job has no active worker assignment.",
      403,
      "UNCLAIMED_JOB",
    );
  }

  if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() < params.now.getTime()) {
    throw new RenderJobWorkerError(
      "Render worker lease has expired for this job.",
      409,
      "LEASE_EXPIRED",
    );
  }

  return row;
}

export async function updateRenderJobProgressForWorker(
  jobId: string,
  rawInput: unknown,
): Promise<RenderJobSummary> {
  if (!jobId?.trim()) {
    throw new RenderJobWorkerError("Missing render job ID.", 400, "INVALID_JOB_ID");
  }
  const input = workerProgressSchema.parse(rawInput);
  const leaseDurationSec = input.leaseDurationSec ?? DEFAULT_WORKER_LEASE_SECONDS;

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await assertWorkerOwnsActiveProcessingJob({
      tx,
      jobId,
      workerId: input.workerId,
      targetStatus: "PROCESSING",
      now,
    });

    const check = validateRenderJobTransition({
      currentStatus: "PROCESSING",
      currentProgress: row.progress,
      targetStatus: "PROCESSING",
      progress: input.progress,
      stage: input.stage !== undefined ? input.stage : row.stage,
    });

    if (!check.ok) {
      throw new RenderJobWorkerError(check.error, 409, "INVALID_PROGRESS");
    }

    const nextLeaseExpiresAt = new Date(now.getTime() + leaseDurationSec * 1000);
    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: row.id,
        status: "PROCESSING",
        workerId: input.workerId,
      },
      data: {
        progress: check.nextProgress,
        stage: check.nextStage,
        lastHeartbeatAt: now,
        leaseExpiresAt: nextLeaseExpiresAt,
      },
    });

    if (res.count !== 1) {
      throw new RenderJobWorkerError(
        "Render job changed concurrently during progress update.",
        409,
        "CONCURRENT_MODIFICATION",
      );
    }

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: row.id } });
  });

  return serializeRenderJob(updated);
}

export async function heartbeatRenderJobForWorker(
  jobId: string,
  rawInput: unknown,
): Promise<RenderJobSummary> {
  if (!jobId?.trim()) {
    throw new RenderJobWorkerError("Missing render job ID.", 400, "INVALID_JOB_ID");
  }
  const input = workerHeartbeatSchema.parse(rawInput);
  const leaseDurationSec = input.leaseDurationSec ?? DEFAULT_WORKER_LEASE_SECONDS;

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await assertWorkerOwnsActiveProcessingJob({
      tx,
      jobId,
      workerId: input.workerId,
      targetStatus: "PROCESSING",
      now,
    });

    const check = validateRenderJobTransition({
      currentStatus: "PROCESSING",
      currentProgress: row.progress,
      targetStatus: "PROCESSING",
      progress: input.progress ?? row.progress,
      stage: input.stage !== undefined ? input.stage : row.stage,
    });

    if (!check.ok) {
      throw new RenderJobWorkerError(check.error, 409, "INVALID_HEARTBEAT");
    }

    const nextLeaseExpiresAt = new Date(now.getTime() + leaseDurationSec * 1000);
    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: row.id,
        status: "PROCESSING",
        workerId: input.workerId,
      },
      data: {
        progress: check.nextProgress,
        stage: check.nextStage,
        lastHeartbeatAt: now,
        leaseExpiresAt: nextLeaseExpiresAt,
      },
    });

    if (res.count !== 1) {
      throw new RenderJobWorkerError(
        "Render job changed concurrently during worker heartbeat.",
        409,
        "CONCURRENT_MODIFICATION",
      );
    }

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: row.id } });
  });

  return serializeRenderJob(updated);
}

export async function completeRenderJobForWorker(
  jobId: string,
  rawInput: unknown,
): Promise<RenderJobSummary> {
  if (!jobId?.trim()) {
    throw new RenderJobWorkerError("Missing render job ID.", 400, "INVALID_JOB_ID");
  }
  const input = workerCompleteJobSchema.parse(rawInput);

  // Pre-load row outside DB transaction so authoritative storage verification (disk SHA-256 / Spaces HeadObject)
  // never holds open MySQL locks across I/O.
  const preRow = await prisma.videoRenderJob.findUnique({ where: { id: jobId } });
  if (!preRow) {
    throw new RenderJobWorkerError("Render job not found.", 404, "JOB_NOT_FOUND");
  }

  if (preRow.workerId && preRow.workerId !== input.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job is claimed by another worker.",
      403,
      "WORKER_MISMATCH",
    );
  }

  const parsedPreSnapshot = renderJobSnapshotSchema.safeParse(preRow.snapshot);
  if (!parsedPreSnapshot.success) {
    throw new RenderJobWorkerError(
      "Stored render snapshot is invalid; cannot verify completion output.",
      422,
      "INVALID_SNAPSHOT",
    );
  }
  if (parsedPreSnapshot.data.project.projectId !== preRow.projectId) {
    throw new RenderJobWorkerError(
      "Stored render snapshot project ID does not match the job record.",
      422,
      "SNAPSHOT_PROJECT_MISMATCH",
    );
  }

  const preKeyCheck = validateWorkerOutputStorageKey({
    outputStorageKey: input.outputStorageKey,
    projectId: preRow.projectId,
    jobId: preRow.id,
    expectedProvider: parsedPreSnapshot.data.outputDestination.provider,
  });
  if (!preKeyCheck.ok) {
    throw new RenderJobWorkerError(preKeyCheck.error, 422, "INVALID_OUTPUT_KEY");
  }

  const preMetaCheck = validateWorkerOutputMetadataMatchesSnapshot(
    input.outputMetadata,
    parsedPreSnapshot.data,
  );
  if (!preMetaCheck.ok) {
    throw new RenderJobWorkerError(preMetaCheck.error, 422, "INVALID_OUTPUT_METADATA");
  }

  // Idempotent replay handling for retries when /complete already succeeded earlier
  if (preRow.status === "COMPLETED") {
    const existingMeta = (preRow.outputMetadata as Record<string, unknown> | null) ?? {};
    const existingSha =
      typeof existingMeta.checksumSha256 === "string"
        ? existingMeta.checksumSha256.trim().toLowerCase()
        : null;
    const submittedSha = input.outputMetadata.checksumSha256?.trim().toLowerCase() ?? null;

    const matchesExistingCompletion =
      preRow.workerId === input.workerId &&
      preRow.outputStorageKey === preKeyCheck.normalizedKey &&
      existingMeta.aspectRatio === input.outputMetadata.aspectRatio &&
      existingMeta.width === input.outputMetadata.width &&
      existingMeta.height === input.outputMetadata.height &&
      existingMeta.fps === input.outputMetadata.fps &&
      existingMeta.sceneCount === input.outputMetadata.sceneCount &&
      existingMeta.fileSizeBytes === input.outputMetadata.fileSizeBytes &&
      (!existingSha || !submittedSha || existingSha === submittedSha);

    if (!matchesExistingCompletion) {
      throw new RenderJobWorkerError(
        "Render job is already completed with different output parameters.",
        409,
        "INVALID_TRANSITION",
      );
    }

    try {
      await verifyStoredRenderVideoObject({
        outputStorageKey: preKeyCheck.normalizedKey,
        projectId: preRow.projectId,
        jobId: preRow.id,
        expectedProvider: parsedPreSnapshot.data.outputDestination.provider,
        expectedSizeBytes: input.outputMetadata.fileSizeBytes,
        expectedSha256: existingSha ?? submittedSha,
      });
    } catch (err) {
      if (err instanceof RenderAssetStreamError) {
        throw new RenderJobWorkerError(err.message, err.statusCode, err.code);
      }
      throw err;
    }

    return serializeRenderJob(preRow);
  }

  // Verify job state before doing authoritative storage check (so cancelled / unclaimed / expired jobs get exact 403/409 codes)
  const preNow = new Date();
  if (preRow.status === "CANCELLED" || preRow.cancelledAt) {
    throw new RenderJobWorkerError(
      "Cannot transition render job because it has already been cancelled.",
      409,
      "JOB_CANCELLED",
    );
  }
  if ((preRow.status === "PENDING" || preRow.status === "QUEUED") && !preRow.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Worker cannot complete a job it has not claimed.",
      403,
      "UNCLAIMED_JOB",
    );
  }
  if (preRow.status !== "PROCESSING") {
    throw new RenderJobWorkerError(
      `Render job is not in PROCESSING status (current status: ${preRow.status}).`,
      409,
      "INVALID_STATUS",
    );
  }
  if (!preRow.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job has no active worker owner.",
      403,
      "UNCLAIMED_JOB",
    );
  }
  if (!preRow.leaseExpiresAt || preRow.leaseExpiresAt.getTime() <= preNow.getTime()) {
    throw new RenderJobWorkerError(
      "Worker lease has expired for this render job; recover or re-claim before updating.",
      409,
      "LEASE_EXPIRED",
    );
  }

  // Authoritative storage verification: never trust worker metadata without verifying the stored MP4 object
  const preMetaObj = (preRow.outputMetadata as Record<string, unknown> | null) ?? {};
  const recordedUploadSha =
    typeof preMetaObj.uploadedChecksumSha256 === "string"
      ? preMetaObj.uploadedChecksumSha256.trim().toLowerCase()
      : null;
  const requestedSha = input.outputMetadata.checksumSha256?.trim().toLowerCase() ?? null;

  if (recordedUploadSha && requestedSha && recordedUploadSha !== requestedSha) {
    throw new RenderJobWorkerError(
      "Completion checksumSha256 does not match the uploaded MP4 object digest.",
      422,
      "OUTPUT_CHECKSUM_MISMATCH",
    );
  }

  let verifiedStorage;
  try {
    verifiedStorage = await verifyStoredRenderVideoObject({
      outputStorageKey: preKeyCheck.normalizedKey,
      projectId: preRow.projectId,
      jobId: preRow.id,
      expectedProvider: parsedPreSnapshot.data.outputDestination.provider,
      expectedSizeBytes: input.outputMetadata.fileSizeBytes,
      expectedSha256: requestedSha ?? recordedUploadSha,
    });
  } catch (err) {
    if (err instanceof RenderAssetStreamError) {
      throw new RenderJobWorkerError(err.message, err.statusCode, err.code);
    }
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await assertWorkerOwnsActiveProcessingJob({
      tx,
      jobId,
      workerId: input.workerId,
      targetStatus: "COMPLETED",
      now,
    });

    const parsedSnapshot = renderJobSnapshotSchema.safeParse(row.snapshot);
    if (!parsedSnapshot.success) {
      throw new RenderJobWorkerError(
        "Stored render snapshot is invalid; cannot verify completion output.",
        422,
        "INVALID_SNAPSHOT",
      );
    }

    const check = validateRenderJobTransition({
      currentStatus: row.status as RenderJobStatus,
      currentProgress: row.progress,
      targetStatus: "COMPLETED",
      progress: 100,
      stage: input.stage ?? "Completed",
      outputStorageKey: input.outputStorageKey,
    });
    if (!check.ok) {
      throw new RenderJobWorkerError(check.error, 409, "INVALID_TRANSITION");
    }

    const keyCheck = validateWorkerOutputStorageKey({
      outputStorageKey: input.outputStorageKey,
      projectId: row.projectId,
      jobId: row.id,
      expectedProvider: parsedSnapshot.data.outputDestination.provider,
    });
    if (!keyCheck.ok) {
      throw new RenderJobWorkerError(keyCheck.error, 422, "INVALID_OUTPUT_KEY");
    }

    const metaCheck = validateWorkerOutputMetadataMatchesSnapshot(
      input.outputMetadata,
      parsedSnapshot.data,
    );
    if (!metaCheck.ok) {
      throw new RenderJobWorkerError(metaCheck.error, 422, "INVALID_OUTPUT_METADATA");
    }

    const existingOutputMeta = (row.outputMetadata as Record<string, unknown> | null) ?? {};
    const finalOutputMeta: RenderJobOutputMetadata = {
      targetOutputKey:
        typeof existingOutputMeta.targetOutputKey === "string"
          ? existingOutputMeta.targetOutputKey
          : buildPlannedOutputMetadata({
              projectId: row.projectId,
              jobId: row.id,
              aspectRatio: parsedSnapshot.data.renderSettings.aspectRatio,
              sceneCount: parsedSnapshot.data.scenes.length,
              totalDurationSec: parsedSnapshot.data.renderSettings.totalDurationSec,
            }).targetOutputKey,
      container: input.outputMetadata.container,
      aspectRatio: input.outputMetadata.aspectRatio,
      width: input.outputMetadata.width,
      height: input.outputMetadata.height,
      fps: input.outputMetadata.fps,
      sceneCount: input.outputMetadata.sceneCount,
      totalDurationSec: input.outputMetadata.totalDurationSec,
      workerPendingPartC3: false,
      fileSizeBytes: verifiedStorage.fileSizeBytes,
      renderedDurationSec: input.outputMetadata.renderedDurationSec,
      renderedAt: input.outputMetadata.renderedAt ?? now.toISOString(),
      checksumSha256: verifiedStorage.checksumSha256 ?? requestedSha ?? recordedUploadSha ?? null,
      etag: verifiedStorage.etag ?? input.outputMetadata.etag ?? null,
      videoCodec: input.outputMetadata.videoCodec ?? "h264",
      audioCodec:
        input.outputMetadata.audioCodec !== undefined ? input.outputMetadata.audioCodec : "aac",
      pixelFormat: input.outputMetadata.pixelFormat ?? "yuv420p",
      bitRate: input.outputMetadata.bitRate ?? null,
      storageProvider: parsedSnapshot.data.outputDestination.provider,
    };

    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: row.id,
        status: "PROCESSING",
        workerId: input.workerId,
      },
      data: {
        status: "COMPLETED",
        progress: 100,
        stage: check.nextStage,
        errorMessage: null,
        outputStorageKey: keyCheck.normalizedKey,
        outputMetadata: finalOutputMeta as unknown as Prisma.InputJsonValue,
        completedAt: now,
        lastHeartbeatAt: now,
        leaseExpiresAt: null,
      },
    });

    if (res.count !== 1) {
      throw new RenderJobWorkerError(
        "Render job changed concurrently during completion.",
        409,
        "CONCURRENT_MODIFICATION",
      );
    }

    await syncProjectStatusFromRenderJobs(tx, row.projectId, {
      kind: "RENDER_COMPLETED",
      completedAt: now,
    });

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: row.id } });
  });

  return serializeRenderJob(updated);
}

export async function failRenderJobForWorker(
  jobId: string,
  rawInput: unknown,
): Promise<RenderJobSummary> {
  if (!jobId?.trim()) {
    throw new RenderJobWorkerError("Missing render job ID.", 400, "INVALID_JOB_ID");
  }
  const input = workerFailJobSchema.parse(rawInput);

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const row = await assertWorkerOwnsActiveProcessingJob({
      tx,
      jobId,
      workerId: input.workerId,
      targetStatus: "FAILED",
      now,
    });

    const check = validateRenderJobTransition({
      currentStatus: row.status as RenderJobStatus,
      currentProgress: row.progress,
      targetStatus: "FAILED",
      stage: input.stage ?? "Render failed",
      errorMessage: input.errorMessage,
    });
    if (!check.ok) {
      throw new RenderJobWorkerError(check.error, 409, "INVALID_TRANSITION");
    }

    const res = await tx.videoRenderJob.updateMany({
      where: {
        id: row.id,
        status: "PROCESSING",
        workerId: input.workerId,
      },
      data: {
        status: "FAILED",
        stage: check.nextStage,
        errorMessage: input.errorMessage.trim(),
        outputStorageKey: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: now,
      },
    });

    if (res.count !== 1) {
      throw new RenderJobWorkerError(
        "Render job changed concurrently while reporting failure.",
        409,
        "CONCURRENT_MODIFICATION",
      );
    }

    await syncProjectStatusFromRenderJobs(tx, row.projectId, { kind: "RENDER_FAILED" });

    return tx.videoRenderJob.findUniqueOrThrow({ where: { id: row.id } });
  });

  return serializeRenderJob(updated);
}

/**
 * Authorizes a worker's read-only streaming request for a specific asset belonging
 * strictly to an actively claimed, non-expired PROCESSING render job's immutable snapshot.
 */
export async function authorizeWorkerJobAssetDownload(params: {
  jobId: string;
  assetId: string;
  workerId: string;
}): Promise<{
  jobId: string;
  projectId: string;
  asset: AuthorizedSnapshotAsset;
}> {
  const cleanJobId = params.jobId?.trim() ?? "";
  if (
    !cleanJobId ||
    cleanJobId.length > 128 ||
    cleanJobId.includes("..") ||
    /[\\/\0\s%]/.test(cleanJobId)
  ) {
    throw new RenderJobWorkerError("Invalid render job ID.", 400, "INVALID_JOB_ID");
  }

  const cleanAssetId = params.assetId?.trim() ?? "";
  if (!isValidSnapshotAssetId(cleanAssetId)) {
    throw new RenderJobWorkerError(
      "Invalid asset ID: only snapshot asset identifiers are accepted.",
      400,
      "INVALID_ASSET_ID",
    );
  }

  const parsedWorkerId = workerIdSchema.safeParse(params.workerId);
  if (!parsedWorkerId.success) {
    throw new RenderJobWorkerError(
      parsedWorkerId.error.issues[0]?.message ?? "Missing or invalid worker ID.",
      400,
      "INVALID_WORKER_ID",
    );
  }
  const cleanWorkerId = parsedWorkerId.data;

  const row = await prisma.videoRenderJob.findUnique({
    where: { id: cleanJobId },
    select: {
      id: true,
      projectId: true,
      status: true,
      workerId: true,
      leaseExpiresAt: true,
      cancelledAt: true,
      snapshot: true,
      project: {
        select: { id: true },
      },
    },
  });

  if (!row) {
    throw new RenderJobWorkerError("Render job not found.", 404, "JOB_NOT_FOUND");
  }

  if (row.workerId && row.workerId !== cleanWorkerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job is claimed by a different worker.",
      403,
      "WORKER_MISMATCH",
    );
  }

  if (row.status === "CANCELLED" || row.cancelledAt) {
    throw new RenderJobWorkerError(
      "Render job has been cancelled; asset access is revoked.",
      409,
      "JOB_CANCELLED",
    );
  }

  if ((row.status === "PENDING" || row.status === "QUEUED") && !row.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Worker cannot access assets for an unclaimed render job.",
      403,
      "UNCLAIMED_JOB",
    );
  }

  if (row.status !== "PROCESSING") {
    throw new RenderJobWorkerError(
      `Render job must be in PROCESSING status for asset access (current status: ${row.status}).`,
      409,
      "INVALID_STATUS",
    );
  }

  if (!row.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job has no active worker assignment.",
      403,
      "UNCLAIMED_JOB",
    );
  }

  const nowMs = Date.now();
  if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= nowMs) {
    throw new RenderJobWorkerError(
      "Render worker lease has expired or is missing for this job.",
      409,
      "LEASE_EXPIRED",
    );
  }

  if (!row.project) {
    throw new RenderJobWorkerError("Parent video project not found.", 404, "PROJECT_NOT_FOUND");
  }

  const parsedSnapshot = renderJobSnapshotSchema.safeParse(row.snapshot);
  if (!parsedSnapshot.success) {
    throw new RenderJobWorkerError(
      "Stored render snapshot is invalid; cannot resolve assets.",
      422,
      "INVALID_SNAPSHOT",
    );
  }

  if (parsedSnapshot.data.project.projectId !== row.projectId) {
    throw new RenderJobWorkerError(
      "Render snapshot project ID does not match the job record.",
      422,
      "SNAPSHOT_PROJECT_MISMATCH",
    );
  }

  const manifest = extractAuthorizedSnapshotAssetManifest(parsedSnapshot.data);
  if (!manifest.ok) {
    throw new RenderJobWorkerError(manifest.error, 422, manifest.code);
  }

  const asset = manifest.assetsById.get(cleanAssetId);
  if (!asset) {
    throw new RenderJobWorkerError(
      "Asset is not referenced by this render job's immutable snapshot.",
      404,
      "ASSET_NOT_IN_SNAPSHOT",
    );
  }

  return {
    jobId: row.id,
    projectId: row.projectId,
    asset,
  };
}

/**
 * Authorizes an active worker to upload the rendered MP4 output for a claimed PROCESSING job.
 * Allows idempotent verification lookup when the same worker retries after COMPLETED.
 */
export async function authorizeWorkerJobOutputUpload(params: {
  jobId: string;
  workerId: string;
}): Promise<{
  jobId: string;
  projectId: string;
  expectedProvider: "local-private" | "spaces";
  alreadyCompleted: boolean;
  existingOutputStorageKey: string | null;
  existingFileSizeBytes: number | null;
  existingChecksumSha256: string | null;
}> {
  const cleanJobId = params.jobId?.trim() ?? "";
  if (
    !cleanJobId ||
    cleanJobId.length > 128 ||
    cleanJobId.includes("..") ||
    /[\\/\0\s%]/.test(cleanJobId)
  ) {
    throw new RenderJobWorkerError("Invalid render job ID.", 400, "INVALID_JOB_ID");
  }

  const parsedWorkerId = workerIdSchema.safeParse(params.workerId);
  if (!parsedWorkerId.success) {
    throw new RenderJobWorkerError(
      parsedWorkerId.error.issues[0]?.message ?? "Missing or invalid worker ID.",
      400,
      "INVALID_WORKER_ID",
    );
  }
  const cleanWorkerId = parsedWorkerId.data;

  const row = await prisma.videoRenderJob.findUnique({
    where: { id: cleanJobId },
    select: {
      id: true,
      projectId: true,
      status: true,
      workerId: true,
      leaseExpiresAt: true,
      cancelledAt: true,
      outputStorageKey: true,
      outputMetadata: true,
      snapshot: true,
      project: { select: { id: true } },
    },
  });

  if (!row) {
    throw new RenderJobWorkerError("Render job not found.", 404, "JOB_NOT_FOUND");
  }

  if (row.workerId && row.workerId !== cleanWorkerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job is claimed by a different worker.",
      403,
      "WORKER_MISMATCH",
    );
  }

  if (row.status === "CANCELLED" || row.cancelledAt) {
    throw new RenderJobWorkerError(
      "Render job has been cancelled; output upload is rejected.",
      409,
      "JOB_CANCELLED",
    );
  }

  if ((row.status === "PENDING" || row.status === "QUEUED") && !row.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Worker cannot upload output for an unclaimed render job.",
      403,
      "UNCLAIMED_JOB",
    );
  }

  if (!row.project) {
    throw new RenderJobWorkerError("Parent video project not found.", 404, "PROJECT_NOT_FOUND");
  }

  const parsedSnapshot = renderJobSnapshotSchema.safeParse(row.snapshot);
  if (!parsedSnapshot.success) {
    throw new RenderJobWorkerError(
      "Stored render snapshot is invalid; cannot authorize output upload.",
      422,
      "INVALID_SNAPSHOT",
    );
  }

  if (parsedSnapshot.data.project.projectId !== row.projectId) {
    throw new RenderJobWorkerError(
      "Render snapshot project ID does not match the job record.",
      422,
      "SNAPSHOT_PROJECT_MISMATCH",
    );
  }

  const meta = (row.outputMetadata as Record<string, unknown> | null) ?? {};
  const existingFileSizeBytes =
    typeof meta.fileSizeBytes === "number"
      ? meta.fileSizeBytes
      : typeof meta.uploadedFileSizeBytes === "number"
        ? meta.uploadedFileSizeBytes
        : null;
  const existingChecksumSha256 =
    typeof meta.checksumSha256 === "string"
      ? meta.checksumSha256.trim().toLowerCase()
      : typeof meta.uploadedChecksumSha256 === "string"
        ? meta.uploadedChecksumSha256.trim().toLowerCase()
        : null;

  if (row.status === "COMPLETED") {
    if (row.workerId !== cleanWorkerId) {
      throw new RenderJobWorkerError(
        "Render job is already completed by another worker.",
        409,
        "INVALID_STATUS",
      );
    }
    return {
      jobId: row.id,
      projectId: row.projectId,
      expectedProvider: parsedSnapshot.data.outputDestination.provider,
      alreadyCompleted: true,
      existingOutputStorageKey: row.outputStorageKey ?? null,
      existingFileSizeBytes,
      existingChecksumSha256,
    };
  }

  if (row.status !== "PROCESSING") {
    throw new RenderJobWorkerError(
      `Render job must be in PROCESSING status for output upload (current status: ${row.status}).`,
      409,
      "INVALID_STATUS",
    );
  }

  if (!row.workerId) {
    throw new RenderJobWorkerError(
      "Forbidden: Render job has no active worker assignment.",
      403,
      "UNCLAIMED_JOB",
    );
  }

  if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now()) {
    throw new RenderJobWorkerError(
      "Render worker lease has expired or is missing for this job.",
      409,
      "LEASE_EXPIRED",
    );
  }

  return {
    jobId: row.id,
    projectId: row.projectId,
    expectedProvider: parsedSnapshot.data.outputDestination.provider,
    alreadyCompleted: false,
    existingOutputStorageKey: row.outputStorageKey ?? null,
    existingFileSizeBytes,
    existingChecksumSha256,
  };
}

/**
 * Confirms job ownership & non-cancelled active lease after output upload completes.
 * If job was cancelled or lease expired mid-upload, deletes the uncommitted output safely.
 */
export async function finalizeWorkerJobOutputUpload(params: {
  jobId: string;
  projectId: string;
  workerId: string;
  upload: UploadedRenderVideoResult;
}): Promise<void> {
  const now = new Date();
  let shouldCleanupUploaded = false;

  try {
    await prisma.$transaction(async (tx) => {
      const row = await tx.videoRenderJob.findUnique({ where: { id: params.jobId } });
      if (!row) {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError("Render job not found after upload.", 404, "JOB_NOT_FOUND");
      }

      if (row.workerId !== params.workerId) {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError(
          "Forbidden: Render job ownership changed during upload.",
          403,
          "WORKER_MISMATCH",
        );
      }

      if (row.status === "CANCELLED" || row.cancelledAt) {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError(
          "Render job was cancelled during upload; output discarded.",
          409,
          "JOB_CANCELLED",
        );
      }

      if (row.status === "COMPLETED") {
        // Idempotent: do NOT delete the completed job's output
        return;
      }

      if (row.status !== "PROCESSING") {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError(
          `Render job transitioned to ${row.status} during upload; output discarded.`,
          409,
          "INVALID_STATUS",
        );
      }

      if (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= now.getTime()) {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError(
          "Worker lease expired before upload completed; output discarded.",
          409,
          "LEASE_EXPIRED",
        );
      }

      const existingMeta = (row.outputMetadata as Record<string, unknown> | null) ?? {};
      const nextMeta = {
        ...existingMeta,
        targetOutputKey: params.upload.outputStorageKey,
        uploadedOutputKey: params.upload.outputStorageKey,
        uploadedFileSizeBytes: params.upload.fileSizeBytes,
        uploadedChecksumSha256: params.upload.checksumSha256,
        uploadedEtag: params.upload.etag,
        storageProvider: params.upload.provider,
        uploadedAt: now.toISOString(),
      };

      const res = await tx.videoRenderJob.updateMany({
        where: {
          id: row.id,
          status: "PROCESSING",
          workerId: params.workerId,
        },
        data: {
          lastHeartbeatAt: now,
          outputMetadata: nextMeta as unknown as Prisma.InputJsonValue,
        },
      });

      if (res.count !== 1) {
        shouldCleanupUploaded = true;
        throw new RenderJobWorkerError(
          "Render job changed concurrently during output upload.",
          409,
          "CONCURRENT_MODIFICATION",
        );
      }
    });
  } catch (err) {
    if (shouldCleanupUploaded) {
      await deleteStoredRenderVideoBestEffort({
        outputStorageKey: params.upload.outputStorageKey,
        projectId: params.projectId,
        jobId: params.jobId,
        provider: params.upload.provider,
      });
    }
    throw err;
  }
}
