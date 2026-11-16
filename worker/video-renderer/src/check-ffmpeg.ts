import { loadOptionalRepoEnvFiles } from "./env";
import { checkFfmpegEnvironment } from "./ffmpeg";

const COMMON_SECRET_ENV_KEYS = [
  "RENDER_WORKER_SECRET",
  "SARVAM_API_KEY",
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "AUTH_SECRET",
  "RESEND_API_KEY",
  "SPACES_KEY",
  "SPACES_SECRET",
  "CRON_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
] as const;

function parseOptionalProbeTimeoutMs(raw?: string): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 100 || n > 60_000) {
    throw new Error("FFMPEG_PROBE_TIMEOUT_MS must be an integer between 100 and 60000.");
  }
  return n;
}

async function main() {
  loadOptionalRepoEnvFiles();

  const secretsToRedact = COMMON_SECRET_ENV_KEYS.map((key) => process.env[key]).filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );

  const timeoutMs = parseOptionalProbeTimeoutMs(process.env.FFMPEG_PROBE_TIMEOUT_MS);
  const status = await checkFfmpegEnvironment({
    ffmpegPath: process.env.FFMPEG_PATH,
    ffprobePath: process.env.FFPROBE_PATH,
    timeoutMs,
    secrets: secretsToRedact,
  });

  console.log(JSON.stringify(status, null, 2));

  if (process.argv.includes("--strict") && !status.readyForPartC32Rendering) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("FFmpeg environment probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
