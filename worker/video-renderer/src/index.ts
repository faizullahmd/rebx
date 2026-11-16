import { ZodError } from "zod";
import { RenderWorkerApiClient } from "./client";
import { loadWorkerConfig } from "./config";
import { loadOptionalRepoEnvFiles } from "./env";
import { checkFfmpegEnvironment } from "./ffmpeg";
import { createWorkerLogger } from "./logger";
import { VideoRenderWorker } from "./worker";

async function main() {
  loadOptionalRepoEnvFiles();

  let config;
  try {
    config = loadWorkerConfig(process.env);
  } catch (err) {
    if (err instanceof ZodError) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "error",
          service: "rebx-video-renderer",
          message: "Invalid worker configuration",
          issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        }),
      );
      process.exit(1);
    }
    throw err;
  }

  const logger = createWorkerLogger({
    workerId: config.workerId,
    secrets: [config.workerSecret],
  });

  if (config.workerSecret.length < 16) {
    logger.warn("RENDER_WORKER_SECRET is shorter than 16 characters; use a strong random secret in production.");
  }

  const ffmpegStatus = await checkFfmpegEnvironment({
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    timeoutMs: config.ffmpegProbeTimeoutMs,
    secrets: [config.workerSecret],
  });

  logger.info("Checked local FFmpeg/FFprobe availability", {
    platform: ffmpegStatus.platform,
    readyForPartC32Rendering: ffmpegStatus.readyForPartC32Rendering,
    ffmpegAvailable: ffmpegStatus.ffmpeg.available,
    ffmpegSource: ffmpegStatus.ffmpeg.source,
    ffmpegPath: ffmpegStatus.ffmpeg.executablePath,
    ffmpegVersion: ffmpegStatus.ffmpeg.version,
    ffmpegErrorCode: ffmpegStatus.ffmpeg.errorCode,
    ffmpegError: ffmpegStatus.ffmpeg.error,
    ffprobeAvailable: ffmpegStatus.ffprobe.available,
    ffprobeSource: ffmpegStatus.ffprobe.source,
    ffprobePath: ffmpegStatus.ffprobe.executablePath,
    ffprobeVersion: ffmpegStatus.ffprobe.version,
    ffprobeErrorCode: ffmpegStatus.ffprobe.errorCode,
    ffprobeError: ffmpegStatus.ffprobe.error,
    note: "Part C3.3 end-to-end MP4 rendering, private storage upload, and verified job completion ready.",
  });

  const client = new RenderWorkerApiClient({
    apiBaseUrl: config.apiBaseUrl,
    workerSecret: config.workerSecret,
    workerId: config.workerId,
    requestTimeoutMs: config.requestTimeoutMs,
    leaseDurationSec: config.leaseDurationSec,
    logger,
  });

  const worker = new VideoRenderWorker({
    client,
    logger,
    pollIntervalMs: config.pollIntervalMs,
    processingEnabled: config.processingEnabled,
    ffmpegStatus,
    tempDir: config.tempDir,
    ffmpegTimeoutMs: config.ffmpegRenderTimeoutMs,
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    leaseDurationSec: config.leaseDurationSec,
  });

  logger.debug("Worker filesystem staging configured", {
    tempDir: config.tempDir,
  });

  let shutdownStarted = false;
  const handleSignal = (signal: string) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info("Received shutdown signal", { signal });
    worker
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  await worker.start();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "rebx-video-renderer",
      message: "Worker crashed during startup",
      error: err instanceof Error ? err.message : "Unknown error",
    }),
  );
  process.exit(1);
});
