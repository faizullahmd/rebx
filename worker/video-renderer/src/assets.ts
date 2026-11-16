import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkerLogger } from "./logger";
import {
  workerRenderSnapshotSchema,
  type WorkerClaimedJob,
  type WorkerRenderSnapshot,
} from "./schemas";

export const WORKER_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const WORKER_MAX_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

export const WORKER_SNAPSHOT_ASSET_ID_REGEX = /^(img|aud)_[a-f0-9]{24}$/;

export type WorkerImageFormat = "jpg" | "png" | "webp";
export type WorkerAudioFormat = "mp3" | "wav" | "ogg" | "webm";
export type WorkerAssetFormat = WorkerImageFormat | WorkerAudioFormat;

export type WorkerAssetErrorCode =
  | "INVALID_SNAPSHOT"
  | "MISSING_REQUIRED_ASSET"
  | "INVALID_ASSET_REFERENCE"
  | "PROVIDER_MISMATCH"
  | "INVALID_CONTENT_TYPE"
  | "ASSET_TOO_LARGE"
  | "INVALID_FILE_SIGNATURE"
  | "INCOMPLETE_DOWNLOAD"
  | "WORKSPACE_PATH_ERROR";

export class WorkerAssetValidationError extends Error {
  code: WorkerAssetErrorCode;

  constructor(code: WorkerAssetErrorCode, message: string) {
    super(message);
    this.name = "WorkerAssetValidationError";
    this.code = code;
  }
}

export type PlannedSnapshotAsset =
  | {
      assetId: string;
      kind: "image";
      provider: "local" | "spaces";
      resolvedRef: string;
      format: WorkerImageFormat;
      expectedMimeType: string;
      maxBytes: number;
      sceneIds: string[];
      sceneOrders: number[];
    }
  | {
      assetId: string;
      kind: "audio";
      provider: "local-private" | "spaces";
      resolvedRef: string;
      format: WorkerAudioFormat;
      expectedMimeType: string;
      maxBytes: number;
      sceneIds: string[];
      sceneOrders: number[];
    };

export type PlannedSceneBinding = {
  sceneId: string;
  order: number;
  title: string;
  durationSec: number;
  imageAssetId: string;
  audioAssetId: string;
};

export type PlannedSnapshotAssets = {
  snapshot: WorkerRenderSnapshot;
  uniqueAssets: PlannedSnapshotAsset[];
  assetsById: Map<string, PlannedSnapshotAsset>;
  sceneBindings: PlannedSceneBinding[];
  deduplicatedCount: number;
};

export type DownloadedAssetFile = {
  assetId: string;
  kind: "image" | "audio";
  format: WorkerAssetFormat;
  contentType: string;
  filePath: string;
  fileSizeBytes: number;
};

export type JobTempWorkspace = {
  jobId: string;
  baseTempDir: string;
  workspaceDir: string;
  assetsDir: string;
  intermediatesDir: string;
  outputDir: string;
  allocateSafeAssetPath: (params: {
    index: number;
    assetId: string;
    format: WorkerAssetFormat;
  }) => string;
  allocateIntermediateScenePath: (params: {
    sceneOrder: number;
    ext?: "mkv" | "mp4";
  }) => string;
  allocateOutputMp4Path: (jobId?: string) => string;
  ensureRenderDirectories: () => Promise<{ intermediatesDir: string; outputDir: string }>;
  cleanupIntermediates: () => Promise<void>;
  cleanup: () => Promise<void>;
  isCleanedUp: () => boolean;
};

export type AssetDownloadTransport = {
  downloadJobAsset: (params: {
    jobId: string;
    asset: PlannedSnapshotAsset;
    targetFilePath: string;
    maxBytes?: number;
    timeoutMs?: number;
  }) => Promise<DownloadedAssetFile>;
};

export type StagedJobAssetsResult = {
  jobId: string;
  projectId: string;
  snapshot: WorkerRenderSnapshot;
  workspaceDir: string;
  intermediatesDir: string;
  outputDir: string;
  allocateIntermediateScenePath: JobTempWorkspace["allocateIntermediateScenePath"];
  allocateOutputMp4Path: JobTempWorkspace["allocateOutputMp4Path"];
  ensureRenderDirectories: JobTempWorkspace["ensureRenderDirectories"];
  cleanupIntermediates: JobTempWorkspace["cleanupIntermediates"];
  downloadedByAssetId: Map<string, DownloadedAssetFile>;
  scenes: Array<{
    sceneId: string;
    order: number;
    title: string;
    durationSec: number;
    imageAssetId: string;
    audioAssetId: string;
    imageFilePath: string;
    audioFilePath: string;
    imageBytes: number;
    audioBytes: number;
  }>;
  stats: {
    totalSceneAssetRefs: number;
    uniqueDownloads: number;
    deduplicatedReuses: number;
    totalDownloadedBytes: number;
  };
  cleanup: () => Promise<void>;
};

function extractLocalImageFilenameFromRef(ref: string): string | null {
  let rawName: string | null = null;
  if (ref.startsWith("local-private-image:")) {
    rawName = ref.slice("local-private-image:".length);
  } else if (ref.startsWith("/api/admin/video-studio/image/")) {
    rawName = ref.slice("/api/admin/video-studio/image/".length);
  } else if (ref.startsWith("/uploads/video-studio/")) {
    rawName = ref.slice("/uploads/video-studio/".length);
  } else if (ref.startsWith("local-private:")) {
    rawName = ref.slice("local-private:".length);
  }
  if (!rawName || /[?#]/.test(rawName)) return null;
  const base = path.posix.basename(rawName);
  if (!base || rawName !== base || base === "." || base === "..") {
    return null;
  }
  return base;
}

function isSafeRefString(raw: string): boolean {
  const val = raw.trim();
  if (!val) return false;
  if (/[\0\r\n\\]/.test(val)) return false;
  if (val.includes("..")) return false;
  if (/^(blob|data):/i.test(val)) return false;
  return true;
}

function inferImageFormatFromRef(
  ref: string,
): { format: WorkerImageFormat; mimeType: string } | null {
  const clean = ref.trim().split("?")[0].split("#")[0];
  if (!clean) return null;
  const ext = path.posix.extname(clean).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return { format: "jpg", mimeType: "image/jpeg" };
  }
  if (ext === ".png") {
    return { format: "png", mimeType: "image/png" };
  }
  if (ext === ".webp") {
    return { format: "webp", mimeType: "image/webp" };
  }
  return null;
}

function getAllowedContentTypes(format: WorkerAssetFormat): readonly string[] {
  switch (format) {
    case "jpg":
      return ["image/jpeg", "image/jpg"];
    case "png":
      return ["image/png"];
    case "webp":
      return ["image/webp"];
    case "mp3":
      return ["audio/mpeg", "audio/mp3"];
    case "wav":
      return ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"];
    case "ogg":
      return ["audio/ogg", "application/ogg"];
    case "webm":
      return ["audio/webm"];
  }
}

export function deriveWorkerSnapshotAssetId(
  params:
    | { kind: "image"; provider: "local" | "spaces"; canonicalRef: string }
    | { kind: "audio"; provider: "local-private" | "spaces"; canonicalRef: string },
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([params.kind, params.provider, params.canonicalRef]), "utf8")
    .digest("hex");
  const prefix = params.kind === "image" ? "img" : "aud";
  return `${prefix}_${digest.slice(0, 24)}`;
}

/**
 * Validates the claimed job's immutable render snapshot before any HTTP asset downloads occur.
 * Enforces REBX's scene asset rules (required scene image + required scene voiceover track),
 * prevents cross-provider mixing, rejects unsafe references, and deduplicates shared assets.
 * Never mutates the input snapshot.
 */
export function validateAndPlanSnapshotAssets(
  rawSnapshot: unknown,
  opts?: {
    maxImageBytes?: number;
    maxAudioBytes?: number;
  },
): PlannedSnapshotAssets {
  const maxImageBytes = opts?.maxImageBytes ?? WORKER_MAX_IMAGE_BYTES;
  const maxAudioBytes = opts?.maxAudioBytes ?? WORKER_MAX_AUDIO_BYTES;

  const parsed = workerRenderSnapshotSchema.safeParse(rawSnapshot);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const pathLabel = firstIssue?.path.join(".") || "snapshot";
    const msg = firstIssue?.message ?? "Invalid render snapshot structure.";
    const code: WorkerAssetErrorCode =
      pathLabel.includes(".image") || pathLabel.includes(".audio")
        ? "MISSING_REQUIRED_ASSET"
        : "INVALID_SNAPSHOT";
    throw new WorkerAssetValidationError(
      code,
      `Render snapshot validation failed (${pathLabel}): ${msg}`,
    );
  }

  const snapshot = parsed.data;
  const expectedProviderFamily = snapshot.outputDestination.provider === "spaces" ? "spaces" : "local";

  const seenSceneIds = new Set<string>();
  const seenOrders = new Set<number>();
  const assetsById = new Map<string, PlannedSnapshotAsset>();
  const uniqueAssets: PlannedSnapshotAsset[] = [];
  const sceneBindings: PlannedSceneBinding[] = [];

  for (const scene of snapshot.scenes) {
    if (seenSceneIds.has(scene.sceneId)) {
      throw new WorkerAssetValidationError(
        "INVALID_SNAPSHOT",
        `Duplicate sceneId "${scene.sceneId}" in render snapshot.`,
      );
    }
    seenSceneIds.add(scene.sceneId);

    if (seenOrders.has(scene.order)) {
      throw new WorkerAssetValidationError(
        "INVALID_SNAPSHOT",
        `Duplicate scene order ${scene.order} in render snapshot.`,
      );
    }
    seenOrders.add(scene.order);

    // 1. Validate scene image asset (required for every scene in REBX render jobs)
    const imgResolved = scene.image.resolvedPathOrKey.trim();
    const imgSourceUrl = scene.image.sourceUrl.trim();
    if (!isSafeRefString(imgResolved) || !isSafeRefString(imgSourceUrl)) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} image contains unsafe path characters.`,
      );
    }

    const imgFamily = scene.image.provider === "spaces" ? "spaces" : "local";
    if (imgFamily !== expectedProviderFamily) {
      throw new WorkerAssetValidationError(
        "PROVIDER_MISMATCH",
        `Scene ${scene.order} image provider "${scene.image.provider}" conflicts with outputDestination "${snapshot.outputDestination.provider}".`,
      );
    }

    if (scene.image.provider === "local") {
      if (/^https?:\/\//i.test(imgResolved) || /^https?:\/\//i.test(imgSourceUrl)) {
        throw new WorkerAssetValidationError(
          "INVALID_ASSET_REFERENCE",
          `Scene ${scene.order} local image cannot reference an external HTTP URL.`,
        );
      }
      const resolvedFilename = extractLocalImageFilenameFromRef(imgResolved);
      if (!resolvedFilename) {
        throw new WorkerAssetValidationError(
          "INVALID_ASSET_REFERENCE",
          `Scene ${scene.order} local image must resolve inside video-studio storage.`,
        );
      }
      const sourceFilename = extractLocalImageFilenameFromRef(imgSourceUrl);
      if (!sourceFilename || sourceFilename !== resolvedFilename) {
        throw new WorkerAssetValidationError(
          "INVALID_ASSET_REFERENCE",
          `Scene ${scene.order} local image sourceUrl mismatches resolvedPathOrKey.`,
        );
      }
    } else if (
      /^https?:\/\//i.test(imgResolved) ||
      imgResolved.startsWith("/") ||
      imgResolved.startsWith("local-private:") ||
      imgResolved.startsWith("local-private-image:")
    ) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} Spaces image key must be a relative object key.`,
      );
    }

    const inferredImg = inferImageFormatFromRef(imgResolved);
    if (!inferredImg) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} image must be JPG, PNG, or WebP.`,
      );
    }

    // 2. Validate scene voiceover audio asset (required for every scene per render-validation.ts)
    const audResolved = scene.audio.resolvedKey.trim();
    const audStorageKey = scene.audio.storageKey.trim();
    if (!isSafeRefString(audResolved) || !isSafeRefString(audStorageKey)) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} audio contains unsafe path characters.`,
      );
    }

    const audFamily = scene.audio.provider === "spaces" ? "spaces" : "local";
    if (audFamily !== expectedProviderFamily) {
      throw new WorkerAssetValidationError(
        "PROVIDER_MISMATCH",
        `Scene ${scene.order} audio provider "${scene.audio.provider}" conflicts with outputDestination "${snapshot.outputDestination.provider}".`,
      );
    }

    if (scene.audio.provider === "local-private") {
      if (!audResolved.startsWith("local-private:")) {
        throw new WorkerAssetValidationError(
          "INVALID_ASSET_REFERENCE",
          `Scene ${scene.order} private local audio key must start with local-private:.`,
        );
      }
      const rawName = audResolved.slice("local-private:".length);
      const base = path.posix.basename(rawName);
      if (!base || rawName !== base || audStorageKey !== audResolved) {
        throw new WorkerAssetValidationError(
          "INVALID_ASSET_REFERENCE",
          `Scene ${scene.order} private local audio key is invalid.`,
        );
      }
    } else if (
      /^https?:\/\//i.test(audResolved) ||
      audResolved.startsWith("/") ||
      audResolved.startsWith("local-private:")
    ) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} Spaces audio key must be a relative object key.`,
      );
    }

    const audExt = path.posix.extname(audResolved.split("?")[0].split("#")[0]).toLowerCase();
    if (audExt !== `.${scene.audio.format}`) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        `Scene ${scene.order} audio key extension (${audExt || "none"}) does not match format "${scene.audio.format}".`,
      );
    }

    const cleanAudioMime = scene.audio.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!getAllowedContentTypes(scene.audio.format).includes(cleanAudioMime)) {
      throw new WorkerAssetValidationError(
        "INVALID_CONTENT_TYPE",
        `Scene ${scene.order} audio MIME type "${scene.audio.mimeType}" is invalid for format "${scene.audio.format}".`,
      );
    }

    const imageAssetId = deriveWorkerSnapshotAssetId({
      kind: "image",
      provider: scene.image.provider,
      canonicalRef: imgResolved,
    });
    const existingImg = assetsById.get(imageAssetId);
    if (existingImg && existingImg.kind === "image") {
      existingImg.sceneIds.push(scene.sceneId);
      existingImg.sceneOrders.push(scene.order);
    } else {
      const plannedImg: PlannedSnapshotAsset = {
        assetId: imageAssetId,
        kind: "image",
        provider: scene.image.provider,
        resolvedRef: imgResolved,
        format: inferredImg.format,
        expectedMimeType: inferredImg.mimeType,
        maxBytes: maxImageBytes,
        sceneIds: [scene.sceneId],
        sceneOrders: [scene.order],
      };
      assetsById.set(imageAssetId, plannedImg);
      uniqueAssets.push(plannedImg);
    }

    const audioAssetId = deriveWorkerSnapshotAssetId({
      kind: "audio",
      provider: scene.audio.provider,
      canonicalRef: audResolved,
    });
    const existingAud = assetsById.get(audioAssetId);
    if (existingAud && existingAud.kind === "audio") {
      existingAud.sceneIds.push(scene.sceneId);
      existingAud.sceneOrders.push(scene.order);
    } else {
      const plannedAud: PlannedSnapshotAsset = {
        assetId: audioAssetId,
        kind: "audio",
        provider: scene.audio.provider,
        resolvedRef: audResolved,
        format: scene.audio.format,
        expectedMimeType: cleanAudioMime,
        maxBytes: maxAudioBytes,
        sceneIds: [scene.sceneId],
        sceneOrders: [scene.order],
      };
      assetsById.set(audioAssetId, plannedAud);
      uniqueAssets.push(plannedAud);
    }

    sceneBindings.push({
      sceneId: scene.sceneId,
      order: scene.order,
      title: scene.title,
      durationSec: scene.durationSec,
      imageAssetId,
      audioAssetId,
    });
  }

  const totalRefs = snapshot.scenes.length * 2;
  return {
    snapshot,
    uniqueAssets,
    assetsById,
    sceneBindings,
    deduplicatedCount: totalRefs - uniqueAssets.length,
  };
}

export function validateAssetContentType(
  contentTypeHeader: string | null | undefined,
  asset: Pick<PlannedSnapshotAsset, "kind" | "format" | "assetId">,
): { ok: true; mimeType: string } | { ok: false; error: string } {
  const cleanMime = (contentTypeHeader ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!cleanMime) {
    return {
      ok: false,
      error: `Missing Content-Type header for ${asset.kind} asset (${asset.assetId}).`,
    };
  }
  const allowed = getAllowedContentTypes(asset.format);
  if (!allowed.includes(cleanMime)) {
    return {
      ok: false,
      error: `Unexpected Content-Type "${cleanMime}" for ${asset.format} ${asset.kind} asset (${asset.assetId}); expected ${allowed.join(" or ")}.`,
    };
  }
  return { ok: true, mimeType: cleanMime };
}

export function verifyAssetBinarySignature(
  header: Uint8Array,
  format: WorkerAssetFormat,
): boolean {
  if (!header || header.length < 3) return false;
  const buf = Buffer.isBuffer(header)
    ? header
    : Buffer.from(header.buffer, header.byteOffset, header.byteLength);

  switch (format) {
    case "jpg":
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

    case "png":
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );

    case "webp":
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      );

    case "wav":
      return (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WAVE"
      );

    case "mp3": {
      if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
        return true;
      }
      const limit = Math.min(buf.length - 1, 512);
      for (let i = 0; i < limit; i++) {
        if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0 && (buf[i + 1] & 0x06) !== 0x00) {
          return true;
        }
      }
      return false;
    }

    case "ogg":
      return buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS";

    case "webm":
      return (
        buf.length >= 4 &&
        buf[0] === 0x1a &&
        buf[1] === 0x45 &&
        buf[2] === 0xdf &&
        buf[3] === 0xa3
      );
  }
}

export async function createJobTempWorkspace(params: {
  jobId: string;
  baseTempDir?: string;
}): Promise<JobTempWorkspace> {
  const cleanJobId = params.jobId.trim();
  const baseTempDir = path.resolve(
    params.baseTempDir?.trim() || path.join(os.tmpdir(), "rebx-video-worker"),
  );
  await fsPromises.mkdir(baseTempDir, { recursive: true });

  const safeSlug = cleanJobId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "job";
  const shortHash = createHash("sha256").update(cleanJobId, "utf8").digest("hex").slice(0, 8);
  const workspaceDir = await fsPromises.mkdtemp(
    path.join(baseTempDir, `job_${safeSlug}_${shortHash}_`),
  );
  const assetsDir = path.join(workspaceDir, "assets");
  const intermediatesDir = path.join(workspaceDir, "intermediates");
  const outputDir = path.join(workspaceDir, "output");
  await fsPromises.mkdir(assetsDir, { recursive: true });

  let cleaned = false;

  const ensureWithinDir = (parentDir: string, candidatePath: string): string => {
    const resolvedTarget = path.resolve(candidatePath);
    const resolvedRoot = path.resolve(parentDir);
    const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (!resolvedTarget.startsWith(prefix)) {
      throw new WorkerAssetValidationError(
        "WORKSPACE_PATH_ERROR",
        "Generated asset path escaped workspace directory.",
      );
    }
    return resolvedTarget;
  };

  const allocateSafeAssetPath = (req: {
    index: number;
    assetId: string;
    format: WorkerAssetFormat;
  }): string => {
    if (!WORKER_SNAPSHOT_ASSET_ID_REGEX.test(req.assetId)) {
      throw new WorkerAssetValidationError(
        "WORKSPACE_PATH_ERROR",
        "Refused to generate workspace path for invalid assetId.",
      );
    }
    const paddedIdx = String(Math.max(1, req.index + 1)).padStart(2, "0");
    const safeFilename = `asset_${paddedIdx}_${req.assetId}.${req.format}`;
    return ensureWithinDir(assetsDir, path.join(assetsDir, safeFilename));
  };

  const allocateIntermediateScenePath = (req: {
    sceneOrder: number;
    ext?: "mkv" | "mp4";
  }): string => {
    const orderNum = Number.isInteger(req.sceneOrder) && req.sceneOrder >= 1 ? req.sceneOrder : 1;
    const ext = req.ext === "mp4" ? "mp4" : "mkv";
    const padded = String(orderNum).padStart(3, "0");
    return ensureWithinDir(intermediatesDir, path.join(intermediatesDir, `scene_${padded}.${ext}`));
  };

  const allocateOutputMp4Path = (customJobId?: string): string => {
    const raw = (customJobId ?? cleanJobId).trim() || "job";
    const slug = raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "job";
    const hash = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 8);
    return ensureWithinDir(outputDir, path.join(outputDir, `render_${slug}_${hash}.mp4`));
  };

  const ensureRenderDirectories = async () => {
    await fsPromises.mkdir(intermediatesDir, { recursive: true });
    await fsPromises.mkdir(outputDir, { recursive: true });
    return { intermediatesDir, outputDir };
  };

  const cleanupIntermediates = async () => {
    await fsPromises.rm(intermediatesDir, { recursive: true, force: true }).catch(() => {});
  };

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await fsPromises.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  };

  return {
    jobId: cleanJobId,
    baseTempDir,
    workspaceDir,
    assetsDir,
    intermediatesDir,
    outputDir,
    allocateSafeAssetPath,
    allocateIntermediateScenePath,
    allocateOutputMp4Path,
    ensureRenderDirectories,
    cleanupIntermediates,
    cleanup,
    isCleanedUp: () => cleaned,
  };
}

export function createJobAssetDownloader(params: {
  jobId: string;
  workspace: JobTempWorkspace;
  transport: AssetDownloadTransport;
  downloadTimeoutMs?: number;
}) {
  const inFlightByAssetId = new Map<string, Promise<DownloadedAssetFile>>();
  const downloadedByAssetId = new Map<string, DownloadedAssetFile>();

  const downloadOnce = (asset: PlannedSnapshotAsset, index: number): Promise<DownloadedAssetFile> => {
    const existingCompleted = downloadedByAssetId.get(asset.assetId);
    if (existingCompleted) {
      return Promise.resolve(existingCompleted);
    }
    const existingFlight = inFlightByAssetId.get(asset.assetId);
    if (existingFlight) {
      return existingFlight;
    }

    const targetFilePath = params.workspace.allocateSafeAssetPath({
      index,
      assetId: asset.assetId,
      format: asset.format,
    });

    const promise = params.transport
      .downloadJobAsset({
        jobId: params.jobId,
        asset,
        targetFilePath,
        maxBytes: asset.maxBytes,
        timeoutMs: params.downloadTimeoutMs,
      })
      .then((downloaded) => {
        downloadedByAssetId.set(asset.assetId, downloaded);
        return downloaded;
      })
      .finally(() => {
        inFlightByAssetId.delete(asset.assetId);
      });

    inFlightByAssetId.set(asset.assetId, promise);
    return promise;
  };

  return {
    downloadOnce,
    downloadedByAssetId,
  };
}

/**
 * Validates the job snapshot, provisions an isolated per-job temp workspace, downloads
 * unique media assets via the authenticated endpoint (coalescing duplicate requests and
 * deduplicating shared scene assets), and automatically cleans up the temp workspace if any step fails.
 */
export async function stageJobAssetsToTempWorkspace(params: {
  job: WorkerClaimedJob;
  transport: AssetDownloadTransport;
  logger: WorkerLogger;
  tempDir?: string;
  maxImageBytes?: number;
  maxAudioBytes?: number;
  downloadTimeoutMs?: number;
}): Promise<StagedJobAssetsResult> {
  const { job, transport, logger } = params;
  const plan = validateAndPlanSnapshotAssets(job.snapshot, {
    maxImageBytes: params.maxImageBytes,
    maxAudioBytes: params.maxAudioBytes,
  });

  if (plan.snapshot.project.projectId !== job.projectId) {
    throw new WorkerAssetValidationError(
      "INVALID_SNAPSHOT",
      "Claimed job snapshot projectId does not match job.projectId.",
    );
  }

  const workspace = await createJobTempWorkspace({
    jobId: job.id,
    baseTempDir: params.tempDir,
  });

  const downloader = createJobAssetDownloader({
    jobId: job.id,
    workspace,
    transport,
    downloadTimeoutMs: params.downloadTimeoutMs,
  });

  try {
    logger.info("Staging verified snapshot assets into temporary worker workspace", {
      jobId: job.id,
      projectId: job.projectId,
      uniqueAssetCount: plan.uniqueAssets.length,
      deduplicatedCount: plan.deduplicatedCount,
    });

    const results: DownloadedAssetFile[] = [];
    for (let i = 0; i < plan.uniqueAssets.length; i++) {
      const asset = plan.uniqueAssets[i];
      const downloaded = await downloader.downloadOnce(asset, i);
      results.push(downloaded);
      logger.debug("Downloaded and verified job asset", {
        jobId: job.id,
        assetId: asset.assetId,
        kind: asset.kind,
        format: asset.format,
        fileSizeBytes: downloaded.fileSizeBytes,
      });
    }

    const totalDownloadedBytes = results.reduce((sum, r) => sum + r.fileSizeBytes, 0);

    const scenes = plan.sceneBindings.map((binding) => {
      const imgFile = downloader.downloadedByAssetId.get(binding.imageAssetId);
      const audFile = downloader.downloadedByAssetId.get(binding.audioAssetId);
      if (!imgFile || !audFile) {
        throw new WorkerAssetValidationError(
          "MISSING_REQUIRED_ASSET",
          `Staged files missing for Scene ${binding.order}.`,
        );
      }
      return {
        sceneId: binding.sceneId,
        order: binding.order,
        title: binding.title,
        durationSec: binding.durationSec,
        imageAssetId: binding.imageAssetId,
        audioAssetId: binding.audioAssetId,
        imageFilePath: imgFile.filePath,
        audioFilePath: audFile.filePath,
        imageBytes: imgFile.fileSizeBytes,
        audioBytes: audFile.fileSizeBytes,
      };
    });

    return {
      jobId: job.id,
      projectId: job.projectId,
      snapshot: plan.snapshot,
      workspaceDir: workspace.workspaceDir,
      intermediatesDir: workspace.intermediatesDir,
      outputDir: workspace.outputDir,
      allocateIntermediateScenePath: workspace.allocateIntermediateScenePath,
      allocateOutputMp4Path: workspace.allocateOutputMp4Path,
      ensureRenderDirectories: workspace.ensureRenderDirectories,
      cleanupIntermediates: workspace.cleanupIntermediates,
      downloadedByAssetId: downloader.downloadedByAssetId,
      scenes,
      stats: {
        totalSceneAssetRefs: plan.snapshot.scenes.length * 2,
        uniqueDownloads: results.length,
        deduplicatedReuses: plan.deduplicatedCount,
        totalDownloadedBytes,
      },
      cleanup: workspace.cleanup,
    };
  } catch (err) {
    await workspace.cleanup();
    throw err;
  }
}
