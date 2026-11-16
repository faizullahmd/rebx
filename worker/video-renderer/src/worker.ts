import type { RenderWorkerApiClient } from "./client";
import type { FfmpegEnvironmentStatus } from "./ffmpeg";
import type { WorkerLogger } from "./logger";
import { processClaimedRenderJob, type JobProcessResult } from "./processor";

export type PollCycleResult =
  | { status: "stopping" }
  | { status: "idle"; reason?: "empty_queue" | "processing_disabled" }
  | { status: "processed"; result: JobProcessResult }
  | { status: "error"; error: string };

export class VideoRenderWorker {
  private readonly client: RenderWorkerApiClient;
  private readonly logger: WorkerLogger;
  private readonly pollIntervalMs: number;
  private readonly processingEnabled: boolean;
  private readonly ffmpegStatus?: FfmpegEnvironmentStatus;
  private readonly tempDir?: string;
  private readonly ffmpegTimeoutMs?: number;
  private readonly heartbeatIntervalMs?: number;
  private readonly leaseDurationSec?: number;
  private readonly jobHandler: (
    params: Parameters<typeof processClaimedRenderJob>[0],
  ) => Promise<JobProcessResult>;

  private running = false;
  private stopping = false;
  private inFlightPromise: Promise<unknown> | null = null;
  private inFlightAbortController: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private sleepCancel: (() => void) | null = null;

  constructor(opts: {
    client: RenderWorkerApiClient;
    logger: WorkerLogger;
    pollIntervalMs: number;
    processingEnabled?: boolean;
    ffmpegStatus?: FfmpegEnvironmentStatus;
    tempDir?: string;
    ffmpegTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    leaseDurationSec?: number;
    jobHandler?: typeof processClaimedRenderJob;
  }) {
    this.client = opts.client;
    this.logger = opts.logger;
    this.pollIntervalMs = opts.pollIntervalMs;
    this.processingEnabled = opts.processingEnabled ?? false;
    this.ffmpegStatus = opts.ffmpegStatus;
    this.tempDir = opts.tempDir;
    this.ffmpegTimeoutMs = opts.ffmpegTimeoutMs;
    this.heartbeatIntervalMs = opts.heartbeatIntervalMs;
    this.leaseDurationSec = opts.leaseDurationSec;
    this.jobHandler = opts.jobHandler ?? processClaimedRenderJob;
  }

  abortInFlightJob(): void {
    if (this.inFlightAbortController && !this.inFlightAbortController.signal.aborted) {
      this.inFlightAbortController.abort();
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  isStopping(): boolean {
    return this.stopping;
  }

  isProcessingEnabled(): boolean {
    return this.processingEnabled;
  }

  async runOnce(): Promise<PollCycleResult> {
    if (this.stopping) {
      return { status: "stopping" };
    }

    if (!this.processingEnabled) {
      this.logger.info(
        "Render processing is disabled (RENDER_WORKER_PROCESSING_ENABLED=false); worker remaining idle without claiming jobs",
        { processingEnabled: false },
      );
      return { status: "idle", reason: "processing_disabled" };
    }

    try {
      const claim = await this.client.claimNextJob();
      if (!claim.claimed || !claim.job) {
        this.logger.debug("No pending render jobs available; worker idle", {
          recoveredCount: claim.recoveredCount,
        });
        return { status: "idle", reason: "empty_queue" };
      }

      const job = claim.job;
      this.logger.info("Claimed render job from REBX queue", {
        jobId: job.id,
        projectId: job.projectId,
        retryCount: job.retryCount,
      });

      const jobAbort = new AbortController();
      this.inFlightAbortController = jobAbort;

      const work = this.jobHandler({
        job,
        client: this.client,
        logger: this.logger,
        ffmpegStatus: this.ffmpegStatus,
        tempDir: this.tempDir,
        ffmpegTimeoutMs: this.ffmpegTimeoutMs,
        heartbeatIntervalMs: this.heartbeatIntervalMs,
        leaseDurationSec: this.leaseDurationSec,
        signal: jobAbort.signal,
      });
      this.inFlightPromise = work;

      try {
        const result = await work;
        return { status: "processed", result };
      } finally {
        this.inFlightPromise = null;
        this.inFlightAbortController = null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected worker polling error";
      this.logger.error("Worker poll cycle failed", { error: msg });
      return { status: "error", error: msg };
    }
  }

  private waitForNextPoll(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.sleepCancel = null;
        resolve();
      }, this.pollIntervalMs);

      this.sleepCancel = () => {
        clearTimeout(timer);
        this.sleepCancel = null;
        resolve();
      };
    });
  }

  start(): Promise<void> {
    if (this.running) {
      return this.loopPromise ?? Promise.resolve();
    }

    this.running = true;
    this.stopping = false;

    this.logger.info("REBX video renderer worker started", {
      pollIntervalMs: this.pollIntervalMs,
      processingEnabled: this.processingEnabled,
      ffmpegAvailable: this.ffmpegStatus?.ffmpeg.available ?? null,
      ffprobeAvailable: this.ffmpegStatus?.ffprobe.available ?? null,
    });

    if (!this.processingEnabled) {
      this.logger.info(
        "Render processing is disabled (RENDER_WORKER_PROCESSING_ENABLED=false); worker will stay idle and will not claim or mutate render jobs",
        { processingEnabled: false },
      );
    }

    this.loopPromise = (async () => {
      while (!this.stopping) {
        const cycle = await this.runOnce();
        if (this.stopping) break;

        // When a job was processed and another might already be waiting, do a brief yield or normal poll
        if (cycle.status === "idle" || cycle.status === "error") {
          await this.waitForNextPoll();
        } else {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      this.running = false;
      this.logger.info("REBX video renderer worker loop exited cleanly");
    })();

    return this.loopPromise;
  }

  async stop(): Promise<void> {
    if (!this.running && !this.inFlightPromise) {
      this.stopping = true;
      return;
    }

    this.logger.info("Graceful shutdown requested; stopping new job claims", {
      hasInFlightJob: Boolean(this.inFlightPromise),
    });

    this.stopping = true;
    this.sleepCancel?.();
    this.abortInFlightJob();

    if (this.inFlightPromise) {
      try {
        await this.inFlightPromise;
      } catch {
        // Error already logged inside job handler / runOnce
      }
    }

    if (this.loopPromise) {
      await this.loopPromise;
    }
    this.running = false;
  }
}

