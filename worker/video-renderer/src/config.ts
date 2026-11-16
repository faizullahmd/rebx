import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { normalizeExecutablePathInput } from "./ffmpeg";

const WORKER_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,118}$/;

function optionalExecutablePathSchema(envVarName: string) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const normalized = normalizeExecutablePathInput(raw);
      if (!normalized.provided) {
        return undefined;
      }
      if (!normalized.valid) {
        ctx.addIssue({
          code: "custom",
          message: `${envVarName}: ${normalized.error}`,
        });
        return z.NEVER;
      }
      return normalized.value;
    });
}

function sanitizeDefaultWorkerId(): string {
  const host = os
    .hostname()
    .replace(/[^a-zA-Z0-9._:-]/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60);
  const candidate = `rebx-${host || "worker"}-${process.pid}`;
  return WORKER_ID_REGEX.test(candidate) ? candidate : `rebx-worker-${process.pid}`;
}

export const workerConfigSchema = z.object({
  workerSecret: z.string().trim().min(1, "RENDER_WORKER_SECRET is required."),
  apiBaseUrl: z
    .string()
    .trim()
    .url("RENDER_API_BASE_URL must be a valid http(s) URL.")
    .refine(
      (val) => /^https?:\/\//i.test(val),
      "RENDER_API_BASE_URL must start with http:// or https://",
    )
    .transform((val) => val.replace(/\/+$/, "")),
  workerId: z
    .string()
    .trim()
    .min(2, "RENDER_WORKER_ID must be at least 2 characters.")
    .max(120, "RENDER_WORKER_ID must be at most 120 characters.")
    .regex(
      WORKER_ID_REGEX,
      "RENDER_WORKER_ID may only contain letters, numbers, dots, underscores, colons, and hyphens.",
    ),
  pollIntervalMs: z.coerce
    .number()
    .int("RENDER_POLL_INTERVAL_MS must be an integer.")
    .min(200, "RENDER_POLL_INTERVAL_MS must be at least 200ms.")
    .max(300000, "RENDER_POLL_INTERVAL_MS cannot exceed 300000ms."),
  requestTimeoutMs: z.coerce
    .number()
    .int("RENDER_REQUEST_TIMEOUT_MS must be an integer.")
    .min(50, "RENDER_REQUEST_TIMEOUT_MS must be at least 50ms.")
    .max(120000, "RENDER_REQUEST_TIMEOUT_MS cannot exceed 120000ms."),
  leaseDurationSec: z.coerce
    .number()
    .int("RENDER_LEASE_DURATION_SEC must be an integer.")
    .min(30, "RENDER_LEASE_DURATION_SEC must be at least 30s.")
    .max(3600, "RENDER_LEASE_DURATION_SEC cannot exceed 3600s."),
  processingEnabled: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return "false";
      if (typeof val === "boolean") return val ? "true" : "false";
      if (typeof val === "string") {
        const trimmed = val.trim().toLowerCase();
        return trimmed === "" ? "false" : trimmed;
      }
      return val;
    },
    z
      .enum(["true", "false"], {
        error: 'RENDER_WORKER_PROCESSING_ENABLED must be "true" or "false".',
      })
      .transform((v) => v === "true"),
  ),
  ffmpegPath: optionalExecutablePathSchema("FFMPEG_PATH"),
  ffprobePath: optionalExecutablePathSchema("FFPROBE_PATH"),
  ffmpegProbeTimeoutMs: z.coerce
    .number()
    .int("FFMPEG_PROBE_TIMEOUT_MS must be an integer.")
    .min(100, "FFMPEG_PROBE_TIMEOUT_MS must be at least 100ms.")
    .max(60000, "FFMPEG_PROBE_TIMEOUT_MS cannot exceed 60000ms."),
  ffmpegRenderTimeoutMs: z.coerce
    .number()
    .int("RENDER_FFMPEG_TIMEOUT_MS must be an integer.")
    .min(1000, "RENDER_FFMPEG_TIMEOUT_MS must be at least 1000ms.")
    .max(1800000, "RENDER_FFMPEG_TIMEOUT_MS cannot exceed 1800000ms."),
  heartbeatIntervalMs: z.coerce
    .number()
    .int("RENDER_HEARTBEAT_INTERVAL_MS must be an integer.")
    .min(500, "RENDER_HEARTBEAT_INTERVAL_MS must be at least 500ms.")
    .max(300000, "RENDER_HEARTBEAT_INTERVAL_MS cannot exceed 300000ms."),
  tempDir: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const trimmed = raw?.trim() ?? "";
      if (!trimmed) {
        return path.join(os.tmpdir(), "rebx-video-worker");
      }
      const unquoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ? trimmed.slice(1, -1).trim()
          : trimmed;
      if (!unquoted) {
        return path.join(os.tmpdir(), "rebx-video-worker");
      }
      if (/[\0\r\n]/.test(unquoted)) {
        ctx.addIssue({
          code: "custom",
          message: "RENDER_WORKER_TEMP_DIR contains invalid control characters.",
        });
        return z.NEVER;
      }
      return path.resolve(unquoted);
    }),
});

export type WorkerConfig = z.output<typeof workerConfigSchema>;

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  return workerConfigSchema.parse({
    workerSecret: env.RENDER_WORKER_SECRET ?? "",
    apiBaseUrl: env.RENDER_API_BASE_URL ?? "http://localhost:3000",
    workerId: env.RENDER_WORKER_ID?.trim() || sanitizeDefaultWorkerId(),
    pollIntervalMs: env.RENDER_POLL_INTERVAL_MS ?? "5000",
    requestTimeoutMs: env.RENDER_REQUEST_TIMEOUT_MS ?? "15000",
    leaseDurationSec: env.RENDER_LEASE_DURATION_SEC ?? "300",
    processingEnabled: env.RENDER_WORKER_PROCESSING_ENABLED,
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    ffmpegProbeTimeoutMs: env.FFMPEG_PROBE_TIMEOUT_MS?.trim() || "4000",
    ffmpegRenderTimeoutMs: env.RENDER_FFMPEG_TIMEOUT_MS?.trim() || "300000",
    heartbeatIntervalMs: env.RENDER_HEARTBEAT_INTERVAL_MS?.trim() || "30000",
    tempDir: env.RENDER_WORKER_TEMP_DIR,
  });
}

