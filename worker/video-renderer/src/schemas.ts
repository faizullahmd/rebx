import { z } from "zod";

export const workerSnapshotSceneSchema = z.object({
  sceneId: z.string().trim().min(1),
  order: z.number().int().min(1),
  title: z.string().trim().min(1),
  narration: z.string(),
  durationSec: z.number().int().min(2).max(60),
  transition: z.unknown().optional(),
  cameraMotion: z.unknown().optional(),
  image: z.object({
    sourceUrl: z.string().trim().min(1),
    provider: z.enum(["local", "spaces"]),
    resolvedPathOrKey: z.string().trim().min(1),
  }),
  audio: z.object({
    storageKey: z.string().trim().min(1),
    provider: z.enum(["local-private", "spaces"]),
    resolvedKey: z.string().trim().min(1),
    format: z.enum(["mp3", "wav", "ogg", "webm"]),
    mimeType: z.string().trim().min(1),
    durationSec: z.number().positive(),
    model: z.string().trim().min(1),
    voice: z.string().nullable(),
    languageCode: z.string().nullable(),
    narrationHash: z.string().nullable(),
  }),
});

export const workerRenderSnapshotSchema = z.object({
  snapshotVersion: z.literal("1.0.0"),
  capturedAt: z.string().min(1),
  project: z.object({
    schemaVersion: z.literal("1.0.0"),
    projectId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    language: z.string().min(1),
    tone: z.string().min(1),
    watermark: z.unknown().optional(),
  }),
  renderSettings: z.object({
    aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    dimensions: z.string().min(1),
    fps: z.literal(30),
    outputFormat: z.literal("mp4"),
    videoCodec: z.literal("h264"),
    audioCodec: z.literal("aac"),
    totalDurationSec: z.number().int().positive(),
    transition: z.unknown().optional(),
    transitionDurationSec: z.unknown().optional(),
    defaultCameraMotion: z.unknown().optional(),
    watermark: z.unknown().optional(),
  }),
  scenes: z.array(workerSnapshotSceneSchema).min(1),
  outputDestination: z.object({
    provider: z.enum(["local-private", "spaces"]),
    storageKeyPrefix: z.string().trim().min(1),
    format: z.literal("mp4"),
  }),
});

export type WorkerRenderSnapshot = z.output<typeof workerRenderSnapshotSchema>;

export const workerRenderJobPayloadSchema = z.object({
  id: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  status: z.string().trim().min(1),
  progress: z.number().int().min(0).max(100),
  stage: z.string().nullable(),
  errorMessage: z.string().nullable(),
  snapshotHash: z.string().trim().min(1),
  outputStorageKey: z.string().nullable().optional(),
  retryCount: z.number().int().min(0),
  workerId: z.string().nullable(),
  leaseExpiresAt: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable().optional(),
  snapshot: z.unknown(),
});

export type WorkerClaimedJob = z.output<typeof workerRenderJobPayloadSchema>;

export const workerClaimApiResponseSchema = z.object({
  ok: z.literal(true),
  claimed: z.boolean(),
  recoveredCount: z.number().int().min(0).optional().default(0),
  job: workerRenderJobPayloadSchema.nullable(),
});

export const workerJobUpdateApiResponseSchema = z.object({
  ok: z.literal(true),
  job: workerRenderJobPayloadSchema,
});

export const workerJobOutputUploadApiResponseSchema = z.object({
  ok: z.literal(true),
  idempotentReuse: z.boolean().optional(),
  upload: z.object({
    outputStorageKey: z.string().trim().min(1),
    provider: z.enum(["local-private", "spaces"]),
    fileSizeBytes: z.number().int().positive(),
    checksumSha256: z.string().trim().regex(/^[a-f0-9]{64}$/i),
    etag: z.string().nullable().optional(),
  }),
});

