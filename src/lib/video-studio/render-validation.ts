import {
  ASPECT_RATIOS,
  ASPECT_RATIO_CONFIG,
  CONTENT_CATEGORIES,
  LANGUAGES,
  PROJECT_STATUSES,
  SARVAM_MAX_NARRATION_CHARS,
  TONES,
  DEFAULT_WATERMARK_CONFIG,
  watermarkConfigSchema,
  sceneAudioMetadataSchema,
  sceneCameraMotionSchema,
  versionedProjectJsonSchema,
  type AspectRatio,
  type ContentCategory,
  type Language,
  type ProjectStatus,
  type RenderJobOutputMetadata,
  type RenderJobSnapshot,
  type RenderJobStatus,
  type RenderSnapshotAudioAsset,
  type RenderSnapshotImageAsset,
  type RenderValidationIssue,
  type RenderValidationReport,
  type SceneAudioMetadata,
  type SceneCameraMotion,
  type Tone,
  type VersionedProjectJson,
  type WatermarkConfig,
} from "./schemas";
import { hashNarrationText } from "./script-utils";

export function getEquivalentImageRefVariants(rawRef: string): string[] {
  const clean = rawRef?.trim().split("?")[0].split("#")[0] ?? "";
  if (!clean) return [];

  let filename: string | null = null;
  if (clean.startsWith("/api/admin/video-studio/image/")) {
    filename = clean.slice("/api/admin/video-studio/image/".length);
  } else if (clean.startsWith("local-private-image:")) {
    filename = clean.slice("local-private-image:".length);
  } else if (clean.startsWith("/uploads/video-studio/")) {
    filename = clean.slice("/uploads/video-studio/".length);
  }

  if (
    filename &&
    filename !== "." &&
    filename !== ".." &&
    !/[\\/\0]/.test(filename) &&
    !filename.includes("..")
  ) {
    return Array.from(
      new Set([
        clean,
        `/api/admin/video-studio/image/${filename}`,
        `local-private-image:${filename}`,
        `/uploads/video-studio/${filename}`,
      ]),
    );
  }

  return [clean];
}

/* ---------- Controlled State Machine & Progress Invariants ---------- */

export const ALLOWED_RENDER_JOB_TRANSITIONS: Record<RenderJobStatus, readonly RenderJobStatus[]> = {
  PENDING: ["QUEUED", "CANCELLED"],
  QUEUED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  CANCELLED: [],
};

export function isActiveRenderJobStatus(status: RenderJobStatus): boolean {
  return status === "PENDING" || status === "QUEUED" || status === "PROCESSING";
}

export function canCancelRenderJob(status: RenderJobStatus): boolean {
  return status === "PENDING" || status === "QUEUED";
}

export function canRetryRenderJob(status: RenderJobStatus): boolean {
  return status === "FAILED";
}

export function canTransitionRenderJobStatus(from: RenderJobStatus, to: RenderJobStatus): boolean {
  return ALLOWED_RENDER_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateRenderJobProgressValue(
  progress: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof progress !== "number" || !Number.isFinite(progress) || !Number.isInteger(progress)) {
    return { ok: false, error: "Render progress must be a whole integer between 0 and 100." };
  }
  if (progress < 0 || progress > 100) {
    return { ok: false, error: `Invalid render progress (${progress}%). Progress must stay between 0 and 100.` };
  }
  return { ok: true, value: progress };
}

export function validateRenderJobTransition(params: {
  currentStatus: RenderJobStatus;
  currentProgress: number;
  targetStatus: RenderJobStatus;
  progress?: number;
  stage?: string | null;
  errorMessage?: string | null;
  outputStorageKey?: string | null;
}):
  | { ok: true; nextProgress: number; nextStage: string | null }
  | { ok: false; error: string } {
  const { currentStatus, currentProgress, targetStatus } = params;

  const isProgressHeartbeat = currentStatus === "PROCESSING" && targetStatus === "PROCESSING";
  if (!isProgressHeartbeat && !canTransitionRenderJobStatus(currentStatus, targetStatus)) {
    return {
      ok: false,
      error: `Invalid render job status transition: ${currentStatus} -> ${targetStatus}.`,
    };
  }

  let nextProgress = params.progress ?? currentProgress;
  if (targetStatus === "PENDING" || targetStatus === "QUEUED") {
    if (params.progress !== undefined && params.progress !== 0) {
      return {
        ok: false,
        error: `Render job progress must be 0% when entering ${targetStatus}.`,
      };
    }
    nextProgress = 0;
  }

  const progressCheck = validateRenderJobProgressValue(nextProgress);
  if (!progressCheck.ok) {
    return progressCheck;
  }

  if (isProgressHeartbeat && progressCheck.value < currentProgress) {
    return {
      ok: false,
      error: `Invalid progress update (${progressCheck.value}%): progress cannot regress below ${currentProgress}%.`,
    };
  }

  if (targetStatus === "COMPLETED") {
    if (progressCheck.value !== 100) {
      return {
        ok: false,
        error: "Completing a render job requires progress to be 100%.",
      };
    }
    if (!params.outputStorageKey?.trim()) {
      return {
        ok: false,
        error: "Completing a render job requires a valid outputStorageKey.",
      };
    }
  }

  if (targetStatus === "FAILED" && !params.errorMessage?.trim()) {
    return {
      ok: false,
      error: "Marking a render job FAILED requires a descriptive errorMessage.",
    };
  }

  const nextStage = params.stage !== undefined ? params.stage?.trim() || null : defaultStageForStatus(targetStatus);
  return {
    ok: true,
    nextProgress: progressCheck.value,
    nextStage,
  };
}

export function defaultStageForStatus(status: RenderJobStatus): string {
  switch (status) {
    case "PENDING":
      return "Awaiting render worker (Part C3)";
    case "QUEUED":
      return "Queued for render worker";
    case "PROCESSING":
      return "Rendering video scenes";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Render failed";
    case "CANCELLED":
      return "Cancelled";
  }
}

/* ---------- Project & Scene Pre-Render Validation ---------- */

export type RenderValidationSceneInput = {
  id: string;
  order: number;
  title: string;
  narration: string;
  imagePrompt?: string | null;
  imageUrl: string | null;
  duration: number;
  locked?: boolean;
  audio?: SceneAudioMetadata | unknown | null;
  cameraMotion?: SceneCameraMotion | unknown | null;
};

export type RenderValidationProjectInput = {
  id: string;
  schemaVersion?: string;
  title: string;
  topic?: string | null;
  targetAudience?: string | null;
  category: string;
  status: string;
  aspectRatio: string;
  language: string;
  tone: string;
  desiredDuration: number;
  defaultCameraMotion?: SceneCameraMotion | unknown | null;
  watermark?: WatermarkConfig | unknown | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  scenes: RenderValidationSceneInput[];
};

export function mapRawProjectStatusForJson(rawStatus: string): ProjectStatus | null {
  const mapped = rawStatus === "APPROVED" ? "COMPLETED" : rawStatus;
  if ((PROJECT_STATUSES as readonly string[]).includes(mapped)) {
    return mapped as ProjectStatus;
  }
  return null;
}

export function buildStrictVersionedProjectJson(
  project: RenderValidationProjectInput,
): { ok: true; value: VersionedProjectJson } | { ok: false; error: string } {
  if (!(ASPECT_RATIOS as readonly string[]).includes(project.aspectRatio)) {
    return {
      ok: false,
      error: `Unsupported aspect ratio "${project.aspectRatio}". Supported aspect ratios are ${ASPECT_RATIOS.join(", ")}.`,
    };
  }
  const aspectRatio = project.aspectRatio as AspectRatio;
  const ratioConfig = ASPECT_RATIO_CONFIG[aspectRatio];

  const mappedStatus = mapRawProjectStatusForJson(project.status);
  if (!mappedStatus) {
    return { ok: false, error: `Unsupported project status "${project.status}".` };
  }

  if (!(CONTENT_CATEGORIES as readonly string[]).includes(project.category)) {
    return { ok: false, error: `Unsupported content category "${project.category}".` };
  }
  if (!(LANGUAGES as readonly string[]).includes(project.language)) {
    return { ok: false, error: `Unsupported language "${project.language}".` };
  }
  if (!(TONES as readonly string[]).includes(project.tone)) {
    return { ok: false, error: `Unsupported tone "${project.tone}".` };
  }

  const totalCalculatedDuration = project.scenes.reduce(
    (sum, s) => sum + (Number.isFinite(s.duration) ? s.duration : 0),
    0,
  );

  const parsedDefaultMotion = project.defaultCameraMotion
    ? sceneCameraMotionSchema.safeParse(project.defaultCameraMotion)
    : null;

  const parsedWatermark = project.watermark
    ? watermarkConfigSchema.safeParse(project.watermark)
    : null;

  const candidate: VersionedProjectJson = {
    schemaVersion: "1.0.0",
    projectId: project.id,
    title: project.title,
    category: project.category as ContentCategory,
    status: mappedStatus,
    videoSettings: {
      aspectRatio,
      dimensions: ratioConfig.dimensions,
      width: ratioConfig.width,
      height: ratioConfig.height,
      desiredDuration: project.desiredDuration,
      totalCalculatedDuration,
      ...(parsedDefaultMotion?.success ? { defaultCameraMotion: parsedDefaultMotion.data } : {}),
      watermark: parsedWatermark?.success ? parsedWatermark.data : DEFAULT_WATERMARK_CONFIG,
    },
    targetAudience: project.targetAudience ?? "",
    language: project.language as Language,
    tone: project.tone as Tone,
    topic: project.topic ?? "",
    scenes: project.scenes.map((s) => {
      const parsedAudio = s.audio ? sceneAudioMetadataSchema.safeParse(s.audio) : null;
      const parsedMotion = s.cameraMotion ? sceneCameraMotionSchema.safeParse(s.cameraMotion) : null;
      return {
        id: s.id,
        order: s.order,
        title: s.title,
        narration: s.narration ?? "",
        imagePrompt: s.imagePrompt ?? "",
        imageUrl: s.imageUrl ?? null,
        duration: s.duration,
        locked: Boolean(s.locked),
        ...(parsedAudio?.success ? { audio: parsedAudio.data } : {}),
        ...(parsedMotion?.success ? { cameraMotion: parsedMotion.data } : {}),
      };
    }),
    createdAt: (project.createdAt ? new Date(project.createdAt) : new Date()).toISOString(),
    updatedAt: (project.updatedAt ? new Date(project.updatedAt) : new Date()).toISOString(),
  };

  const parsed = versionedProjectJsonSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? ` (${first.path.join(".")})` : "";
    return {
      ok: false,
      error: `Project JSON failed schema validation${path}: ${first?.message ?? "Invalid structure."}`,
    };
  }

  return { ok: true, value: parsed.data as VersionedProjectJson };
}

export function validateProjectForRender(
  project: RenderValidationProjectInput,
  assetIssues: RenderValidationIssue[] = [],
): {
  report: RenderValidationReport;
  versionedJson: VersionedProjectJson | null;
} {
  const errors: RenderValidationIssue[] = [];
  const warnings: RenderValidationIssue[] = [];

  if (!project.id?.trim()) {
    errors.push({ code: "MISSING_PROJECT_ID", level: "error", message: "Project ID is missing." });
  }
  if (!project.title?.trim()) {
    errors.push({ code: "MISSING_TITLE", level: "error", message: "Project title cannot be empty." });
  }
  if (project.schemaVersion && project.schemaVersion !== "1.0.0") {
    errors.push({
      code: "UNSUPPORTED_SCHEMA_VERSION",
      level: "error",
      message: `Unsupported schemaVersion "${project.schemaVersion}". Expected "1.0.0".`,
    });
  }

  const validRatio = (ASPECT_RATIOS as readonly string[]).includes(project.aspectRatio);
  const ratioConfig = validRatio ? ASPECT_RATIO_CONFIG[project.aspectRatio as AspectRatio] : null;
  if (!validRatio) {
    errors.push({
      code: "INVALID_ASPECT_RATIO",
      level: "error",
      message: `Unsupported aspect ratio "${project.aspectRatio}". Choose 16:9, 9:16, or 1:1.`,
    });
  }

  if (project.scenes.length === 0) {
    errors.push({
      code: "NO_SCENES",
      level: "error",
      message: "Project must contain at least one scene before creating a render job.",
    });
  }

  // Validate contiguous 1..N ordering without mutating scene rows
  const seenOrders = new Set<number>();
  let orderErrorAdded = false;
  project.scenes.forEach((s, idx) => {
    const expectedOrder = idx + 1;
    if (!Number.isInteger(s.order) || s.order < 1 || seenOrders.has(s.order) || s.order !== expectedOrder) {
      if (!orderErrorAdded) {
        errors.push({
          code: "INVALID_SCENE_ORDER",
          level: "error",
          message: `Scenes have invalid ordering (expected sequential 1..${project.scenes.length}, found Scene "${s.title || expectedOrder}" at position ${idx + 1} with order ${s.order}). Save draft to normalize scene ordering.`,
          sceneId: s.id,
          sceneOrder: s.order,
        });
        orderErrorAdded = true;
      }
    }
    seenOrders.add(s.order);
  });

  let missingImageCount = 0;
  let missingAudioCount = 0;
  let staleAudioCount = 0;
  let totalDurationSec = 0;

  project.scenes.forEach((s, idx) => {
    const displayNum = Number.isInteger(s.order) && s.order > 0 ? s.order : idx + 1;
    const label = s.title?.trim() ? `Scene ${displayNum} ("${s.title.trim()}")` : `Scene ${displayNum}`;

    if (!s.title?.trim()) {
      errors.push({
        code: "MISSING_SCENE_TITLE",
        level: "error",
        message: `${label} is missing a title.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    }

    if (!Number.isInteger(s.duration) || s.duration < 2 || s.duration > 60) {
      errors.push({
        code: "INVALID_SCENE_DURATION",
        level: "error",
        message: `${label} has invalid duration (${s.duration}s). Scene duration must be between 2s and 60s.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    } else {
      totalDurationSec += s.duration;
    }

    const cleanImageUrl = s.imageUrl?.trim() ?? "";
    if (!cleanImageUrl) {
      missingImageCount++;
      errors.push({
        code: "MISSING_SCENE_IMAGE",
        level: "error",
        message: `${label} requires an uploaded scene image.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    } else if (/^(blob|data):/i.test(cleanImageUrl)) {
      missingImageCount++;
      errors.push({
        code: "INVALID_SCENE_IMAGE",
        level: "error",
        message: `${label} has a temporary browser image URL instead of a stored asset.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    }

    const cleanNarration = s.narration?.trim() ?? "";
    if (!cleanNarration) {
      errors.push({
        code: "MISSING_SCENE_NARRATION",
        level: "error",
        message: `${label} requires narration text for voiceover rendering.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    } else if (cleanNarration.length > SARVAM_MAX_NARRATION_CHARS) {
      errors.push({
        code: "NARRATION_TOO_LONG",
        level: "error",
        message: `${label} narration exceeds ${SARVAM_MAX_NARRATION_CHARS} characters.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    }

    if (!s.audio) {
      missingAudioCount++;
      errors.push({
        code: "MISSING_SCENE_AUDIO",
        level: "error",
        message: `${label} is missing voiceover audio. Generate Sarvam AI voiceover or upload an audio track.`,
        sceneId: s.id,
        sceneOrder: displayNum,
      });
    } else {
      const parsedAudio = sceneAudioMetadataSchema.safeParse(s.audio);
      if (!parsedAudio.success) {
        missingAudioCount++;
        errors.push({
          code: "INVALID_SCENE_AUDIO",
          level: "error",
          message: `${label} has invalid voiceover audio metadata.`,
          sceneId: s.id,
          sceneOrder: displayNum,
        });
      } else if (parsedAudio.data.status !== "ready") {
        missingAudioCount++;
        errors.push({
          code: "AUDIO_NOT_READY",
          level: "error",
          message: `${label} voiceover status is "${parsedAudio.data.status}". Regenerate or upload valid audio.`,
          sceneId: s.id,
          sceneOrder: displayNum,
        });
      } else if (!parsedAudio.data.storageKey.trim() || parsedAudio.data.durationSec <= 0) {
        missingAudioCount++;
        errors.push({
          code: "INVALID_SCENE_AUDIO",
          level: "error",
          message: `${label} voiceover is missing a valid storage key or duration.`,
          sceneId: s.id,
          sceneOrder: displayNum,
        });
      } else {
        if (
          cleanNarration &&
          parsedAudio.data.narrationHash &&
          parsedAudio.data.narrationHash !== hashNarrationText(cleanNarration)
        ) {
          staleAudioCount++;
          warnings.push({
            code: "STALE_SCENE_AUDIO",
            level: "warning",
            message: `${label} narration was edited after voiceover generation; consider regenerating audio.`,
            sceneId: s.id,
            sceneOrder: displayNum,
          });
        }
        if (Number.isInteger(s.duration) && parsedAudio.data.durationSec > s.duration + 1) {
          warnings.push({
            code: "AUDIO_LONGER_THAN_SCENE",
            level: "warning",
            message: `${label} voiceover (${parsedAudio.data.durationSec.toFixed(1)}s) is longer than scene duration (${s.duration}s).`,
            sceneId: s.id,
            sceneOrder: displayNum,
          });
        }
      }
    }
  });

  // Strict VersionedProjectJson Zod check
  let versionedJson: VersionedProjectJson | null = null;
  if (validRatio && project.scenes.length > 0 && errors.length === 0) {
    const strictJson = buildStrictVersionedProjectJson(project);
    if (!strictJson.ok) {
      errors.push({
        code: "INVALID_PROJECT_JSON",
        level: "error",
        message: strictJson.error,
      });
    } else {
      versionedJson = strictJson.value;
    }
  } else if (validRatio && project.scenes.length > 0) {
    // Still surface schema-level mismatches such as bad category/language/desiredDuration
    const strictJson = buildStrictVersionedProjectJson(project);
    if (!strictJson.ok && !errors.some((e) => e.message === strictJson.error)) {
      const topCode = strictJson.error.includes("category")
        ? "INVALID_CATEGORY"
        : strictJson.error.includes("language")
          ? "INVALID_LANGUAGE"
          : strictJson.error.includes("tone")
            ? "INVALID_TONE"
            : "INVALID_PROJECT_JSON";
      if (topCode !== "INVALID_PROJECT_JSON") {
        errors.push({ code: topCode, level: "error", message: strictJson.error });
      }
    }
  }

  for (const issue of assetIssues) {
    if (issue.level === "error") {
      errors.push(issue);
    } else {
      warnings.push(issue);
    }
  }

  return {
    report: {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        sceneCount: project.scenes.length,
        totalDurationSec,
        aspectRatio: project.aspectRatio,
        dimensions: ratioConfig?.dimensions ?? null,
        missingImageCount,
        missingAudioCount,
        staleAudioCount,
      },
    },
    versionedJson,
  };
}

/* ---------- Snapshot & Future Worker Metadata Builders ---------- */

export const MAX_RENDER_OUTPUT_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB

/**
 * Validates that the initial bytes of an uploaded or stored render output match
 * an ISO Base Media File Format (`ftyp` box) MP4 container signature.
 */
export function hasValidMp4ContainerSignature(header: Uint8Array | Buffer): boolean {
  if (!header || header.byteLength < 12) return false;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const boxSize = view.getUint32(0, false);
  // Box size is either >= 8 and <= 256 for standard ftyp boxes, or 1 (64-bit extended size)
  if (boxSize !== 1 && (boxSize < 8 || boxSize > 256)) {
    return false;
  }
  // Bytes 4..7 must be ASCII "ftyp" (0x66 0x74 0x79 0x70)
  if (
    header[4] !== 0x66 ||
    header[5] !== 0x74 ||
    header[6] !== 0x79 ||
    header[7] !== 0x70
  ) {
    return false;
  }
  // Major brand (bytes 8..11) must be printable ASCII (e.g., isom, iso2, mp41, mp42, avc1, M4V )
  for (let i = 8; i < 12; i++) {
    const b = header[i];
    if (b < 0x20 || b > 0x7e) return false;
  }
  return true;
}

export function buildRenderOutputTargetKey(projectId: string, jobId: string): string {
  return `video-studio/${projectId}/renders/render_${jobId}.mp4`;
}

export function buildRenderLocalPrivateOutputKey(jobId: string): string {
  return `local-private:render_${jobId}.mp4`;
}

/**
 * Validates that a worker-supplied outputStorageKey strictly matches the deterministic
 * target output key authorized for this render job and storage provider.
 */
export function validateWorkerOutputStorageKey(params: {
  outputStorageKey: string;
  projectId: string;
  jobId: string;
  expectedProvider: "local-private" | "spaces";
}): { ok: true; normalizedKey: string } | { ok: false; error: string } {
  const key = params.outputStorageKey?.trim() ?? "";
  if (!key) {
    return { ok: false, error: "Completed render job requires a non-empty outputStorageKey." };
  }
  if (key.includes("..") || /[\\\0\s]/.test(key) || /^https?:\/\//i.test(key)) {
    return {
      ok: false,
      error: "Invalid outputStorageKey format: URLs, whitespace, and path traversal are not allowed.",
    };
  }

  const canonicalKey = buildRenderOutputTargetKey(params.projectId, params.jobId);
  if (key === canonicalKey) {
    return { ok: true, normalizedKey: key };
  }

  if (
    params.expectedProvider === "local-private" &&
    key === buildRenderLocalPrivateOutputKey(params.jobId)
  ) {
    return { ok: true, normalizedKey: key };
  }

  return {
    ok: false,
    error: `Rejected unauthorized outputStorageKey "${key}". Expected "${canonicalKey}"${
      params.expectedProvider === "local-private"
        ? ` or "${buildRenderLocalPrivateOutputKey(params.jobId)}"`
        : ""
    }.`,
  };
}

export function validateWorkerOutputMetadataMatchesSnapshot(
  metadata: {
    container: "mp4";
    aspectRatio: AspectRatio;
    width: number;
    height: number;
    fps: number;
    sceneCount: number;
    totalDurationSec: number;
    fileSizeBytes: number;
    renderedDurationSec: number;
  },
  snapshot: RenderJobSnapshot,
): { ok: true } | { ok: false; error: string } {
  if (metadata.aspectRatio !== snapshot.renderSettings.aspectRatio) {
    return {
      ok: false,
      error: `Output aspectRatio mismatch: expected ${snapshot.renderSettings.aspectRatio}, got ${metadata.aspectRatio}.`,
    };
  }
  if (
    metadata.width !== snapshot.renderSettings.width ||
    metadata.height !== snapshot.renderSettings.height
  ) {
    return {
      ok: false,
      error: `Output dimensions mismatch: expected ${snapshot.renderSettings.width}x${snapshot.renderSettings.height}, got ${metadata.width}x${metadata.height}.`,
    };
  }
  if (metadata.fps !== snapshot.renderSettings.fps) {
    return {
      ok: false,
      error: `Output FPS mismatch: expected ${snapshot.renderSettings.fps}, got ${metadata.fps}.`,
    };
  }
  if (metadata.sceneCount !== snapshot.scenes.length) {
    return {
      ok: false,
      error: `Output sceneCount mismatch: expected ${snapshot.scenes.length}, got ${metadata.sceneCount}.`,
    };
  }
  if (!Number.isFinite(metadata.fileSizeBytes) || metadata.fileSizeBytes <= 0) {
    return { ok: false, error: "Completed render output must report a positive fileSizeBytes." };
  }
  if (!Number.isFinite(metadata.renderedDurationSec) || metadata.renderedDurationSec <= 0) {
    return { ok: false, error: "Completed render output must report a positive renderedDurationSec." };
  }
  return { ok: true };
}

export function buildPlannedOutputMetadata(params: {
  projectId: string;
  jobId: string;
  aspectRatio: AspectRatio;
  sceneCount: number;
  totalDurationSec: number;
}): RenderJobOutputMetadata {
  const ratioConfig = ASPECT_RATIO_CONFIG[params.aspectRatio];
  return {
    targetOutputKey: buildRenderOutputTargetKey(params.projectId, params.jobId),
    container: "mp4",
    aspectRatio: params.aspectRatio,
    width: ratioConfig.width,
    height: ratioConfig.height,
    fps: 30,
    sceneCount: params.sceneCount,
    totalDurationSec: params.totalDurationSec,
    workerPendingPartC3: true,
    fileSizeBytes: null,
    renderedDurationSec: null,
    renderedAt: null,
  };
}

export function buildRenderJobSnapshot(params: {
  versionedJson: VersionedProjectJson;
  resolvedScenes: {
    sceneId: string;
    order: number;
    title: string;
    narration: string;
    durationSec: number;
    image: RenderSnapshotImageAsset;
    audio: RenderSnapshotAudioAsset;
    cameraMotion?: SceneCameraMotion | null;
  }[];
  storageProvider: "local" | "spaces";
  capturedAt?: string;
  defaultCameraMotion?: SceneCameraMotion | null;
}): RenderJobSnapshot {
  const aspectRatio = params.versionedJson.videoSettings.aspectRatio;
  const ratioConfig = ASPECT_RATIO_CONFIG[aspectRatio];
  const totalDurationSec = params.resolvedScenes.reduce((sum, s) => sum + s.durationSec, 0);

  return {
    snapshotVersion: "1.0.0",
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    project: params.versionedJson,
    renderSettings: {
      aspectRatio,
      width: ratioConfig.width,
      height: ratioConfig.height,
      dimensions: ratioConfig.dimensions,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      totalDurationSec,
      ...(params.defaultCameraMotion || params.versionedJson.videoSettings.defaultCameraMotion
        ? {
            defaultCameraMotion:
              params.defaultCameraMotion ?? params.versionedJson.videoSettings.defaultCameraMotion,
          }
        : {}),
      watermark: params.versionedJson.videoSettings.watermark ?? DEFAULT_WATERMARK_CONFIG,
    },
    scenes: params.resolvedScenes.map((s) => ({
      sceneId: s.sceneId,
      order: s.order,
      title: s.title,
      narration: s.narration,
      durationSec: s.durationSec,
      image: s.image,
      audio: s.audio,
      ...(s.cameraMotion ? { cameraMotion: s.cameraMotion } : {}),
    })),
    outputDestination: {
      provider: params.storageProvider === "spaces" ? "spaces" : "local-private",
      storageKeyPrefix: `video-studio/${params.versionedJson.projectId}/renders`,
      format: "mp4",
    },
  };
}

/**
 * Deterministic canonical payload for SHA-256 deduplication across repeated render clicks
 * when the project content, scene ordering, assets, and settings have not changed.
 */
export function buildCanonicalSnapshotFingerprintPayload(snapshot: RenderJobSnapshot): string {
  return JSON.stringify({
    snapshotVersion: snapshot.snapshotVersion,
    schemaVersion: snapshot.project.schemaVersion,
    projectId: snapshot.project.projectId,
    title: snapshot.project.title,
    category: snapshot.project.category,
    targetAudience: snapshot.project.targetAudience ?? "",
    language: snapshot.project.language,
    tone: snapshot.project.tone,
    aspectRatio: snapshot.renderSettings.aspectRatio,
    width: snapshot.renderSettings.width,
    height: snapshot.renderSettings.height,
    fps: snapshot.renderSettings.fps,
    outputFormat: snapshot.renderSettings.outputFormat,
    outputProvider: snapshot.outputDestination.provider,
    defaultCameraMotion: snapshot.renderSettings.defaultCameraMotion ?? null,
    watermark: snapshot.renderSettings.watermark ?? null,
    scenes: snapshot.scenes.map((s) => ({
      sceneId: s.sceneId,
      order: s.order,
      title: s.title,
      narration: s.narration,
      durationSec: s.durationSec,
      imageUrl: s.image.sourceUrl,
      imageResolved: s.image.resolvedPathOrKey,
      audioKey: s.audio.storageKey,
      audioResolved: s.audio.resolvedKey,
      audioFormat: s.audio.format,
      audioDurationSec: s.audio.durationSec,
      audioNarrationHash: s.audio.narrationHash,
      cameraMotion: s.cameraMotion ?? null,
    })),
  });
}

/**
 * Extracts all image URLs/keys and private audio storage keys referenced by an immutable render snapshot.
 * Used by asset cleanup routines to ensure editing a draft never deletes files needed by active render jobs.
 */
export function extractAssetReferencesFromRenderSnapshot(snapshot: unknown): {
  imageRefs: Set<string>;
  audioKeys: Set<string>;
} {
  const imageRefs = new Set<string>();
  const audioKeys = new Set<string>();

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { imageRefs, audioKeys };
  }

  const snap = snapshot as {
    scenes?: unknown;
    project?: { scenes?: unknown };
  };

  if (Array.isArray(snap.scenes)) {
    for (const s of snap.scenes) {
      if (!s || typeof s !== "object") continue;
      const item = s as {
        image?: { sourceUrl?: unknown; resolvedPathOrKey?: unknown };
        audio?: { storageKey?: unknown; resolvedKey?: unknown };
      };
      if (typeof item.image?.sourceUrl === "string" && item.image.sourceUrl.trim()) {
        imageRefs.add(item.image.sourceUrl.trim());
      }
      if (typeof item.image?.resolvedPathOrKey === "string" && item.image.resolvedPathOrKey.trim()) {
        imageRefs.add(item.image.resolvedPathOrKey.trim());
      }
      if (typeof item.audio?.storageKey === "string" && item.audio.storageKey.trim()) {
        audioKeys.add(item.audio.storageKey.trim());
      }
      if (typeof item.audio?.resolvedKey === "string" && item.audio.resolvedKey.trim()) {
        audioKeys.add(item.audio.resolvedKey.trim());
      }
    }
  }

  if (Array.isArray(snap.project?.scenes)) {
    for (const s of snap.project.scenes) {
      if (!s || typeof s !== "object") continue;
      const item = s as { imageUrl?: unknown; audio?: { storageKey?: unknown } };
      if (typeof item.imageUrl === "string" && item.imageUrl.trim()) {
        imageRefs.add(item.imageUrl.trim());
      }
      if (typeof item.audio?.storageKey === "string" && item.audio.storageKey.trim()) {
        audioKeys.add(item.audio.storageKey.trim());
      }
    }
  }

  return { imageRefs, audioKeys };
}
