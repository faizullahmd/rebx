import { describe, it } from "vitest";
import { checkFfmpegEnvironment } from "../../worker/video-renderer/src/ffmpeg";

/**
 * The AI Video Studio render tests run the real FFmpeg binary. Machines without FFmpeg on the PATH
 * (CI, a fresh laptop) skip them instead of failing the whole run; the unit tests around them still run.
 */
const ffmpegStatus = await checkFfmpegEnvironment().catch(() => null);

export const ffmpegAvailable = Boolean(
  ffmpegStatus?.readyForPartC32Rendering &&
    ffmpegStatus.ffmpeg.executablePath &&
    ffmpegStatus.ffprobe.executablePath,
);

export const describeWithFfmpeg = describe.skipIf(!ffmpegAvailable);
export const itWithFfmpeg = it.skipIf(!ffmpegAvailable);
