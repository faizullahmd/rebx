import "server-only";
import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { PassThrough, Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  buildSpacesPublicUrl,
  createSpacesClient,
  describeStorageError,
  extractSpacesObjectKey,
  getRequiredSpacesConfig,
  getSpacesConfigOptional,
} from "@/lib/storage";
import type {
  RenderJobSnapshot,
  RenderSnapshotAudioAsset,
  RenderSnapshotImageAsset,
  RenderValidationIssue,
  SceneAudioMetadata,
} from "@/lib/video-studio/schemas";
import {
  MAX_RENDER_OUTPUT_VIDEO_BYTES,
  buildRenderLocalPrivateOutputKey,
  buildRenderOutputTargetKey,
  hasValidMp4ContainerSignature,
  validateWorkerOutputStorageKey,
} from "@/lib/video-studio/render-validation";
import {
  MAX_RENDER_IMAGE_BYTES,
  inferImageFormatFromRef,
  type AuthorizedSnapshotAsset,
} from "@/lib/video-studio/snapshot-assets";
import {
  ADMIN_SCENE_IMAGE_ROUTE_PREFIX,
  LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX,
  buildAdminSceneImagePreviewUrl,
} from "@/lib/video-studio/script-utils";

export { prisma };

/** Admin guard returning numeric user id */
export async function requireAdmin(): Promise<{ id: number }> {
  const user = await requireRole("ADMIN");
  return { id: user.id };
}

/**
 * Determines whether to use DigitalOcean Spaces or the local filesystem.
 *
 * Rules:
 * - In production (NODE_ENV === "production"), ALWAYS uses "spaces".
 *   Setting STORAGE_PROVIDER="local" or "filesystem" in production throws an explicit
 *   configuration error to prevent accidental ephemeral disk storage.
 * - Outside production (development / test): defaults to "local" when unset,
 *   or honors explicit "local" / "spaces".
 */
export function getStorageProvider(): "spaces" | "local" {
  const explicit = process.env.STORAGE_PROVIDER?.toLowerCase().trim();
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    if (explicit === "local" || explicit === "filesystem") {
      throw new Error(
        `Invalid storage configuration: STORAGE_PROVIDER="${explicit}" is not allowed in production. ` +
          `Remove STORAGE_PROVIDER or set STORAGE_PROVIDER="spaces" and configure DigitalOcean Spaces credentials.`,
      );
    }
    if (explicit && explicit !== "spaces" && explicit !== "s3") {
      throw new Error(
        `Invalid storage configuration: unsupported STORAGE_PROVIDER="${explicit}" in production. Use "spaces".`,
      );
    }
    return "spaces";
  }

  if (!explicit || explicit === "local" || explicit === "filesystem") {
    return "local";
  }
  if (explicit === "spaces" || explicit === "s3") {
    return "spaces";
  }

  throw new Error(
    `Invalid storage configuration: unsupported STORAGE_PROVIDER="${explicit}". Expected "local" or "spaces".`,
  );
}

/**
 * Validates that the active storage provider is usable without returning secret values.
 */
export function assertStorageConfigured(): { provider: "spaces" | "local" } {
  const provider = getStorageProvider();
  if (provider === "spaces") {
    getRequiredSpacesConfig();
  }
  return { provider };
}

export const LOCAL_PRIVATE_ASSET_PREFIX = "local-private:";
export const LOCAL_PRIVATE_IMAGE_PREFIX = "local-private-image:";

export function getLegacyPublicVideoStudioDir(pathMod: typeof import("path")): string {
  return pathMod.join(process.cwd(), "public", "uploads", "video-studio");
}

export function getPrivateVideoStudioDir(pathMod: typeof import("path")): string {
  return pathMod.join(process.cwd(), "storage", "video-studio");
}

export function getPrivateVideoStudioImagesDir(pathMod: typeof import("path")): string {
  return pathMod.join(process.cwd(), "storage", "video-studio", "images");
}

export function sanitizeLocalFilename(key: string, pathMod: typeof import("path")): string {
  const base = pathMod.posix.basename(key.replace(/\\/g, "/")).trim();
  if (!base || base === "." || base === ".." || /[\\/\0]/.test(base)) {
    throw new Error("Invalid storage asset filename.");
  }
  return base;
}

function extractRawLocalImageName(cleanRef: string): string | null {
  if (cleanRef.startsWith(LOCAL_PRIVATE_IMAGE_PREFIX)) {
    return cleanRef.slice(LOCAL_PRIVATE_IMAGE_PREFIX.length);
  }
  if (cleanRef.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)) {
    return cleanRef.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length);
  }
  if (cleanRef.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)) {
    return cleanRef.slice(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX.length);
  }
  return null;
}

/**
 * Uploads a studio asset buffer using the configured storage provider:
 * - Local development: stores privately outside `public/` under `storage/video-studio/images/`
 *   and returns the admin-authenticated preview route URL `/api/admin/video-studio/image/{file}`.
 * - DigitalOcean Spaces: uploads to the configured Space and returns its Spaces/CDN URL.
 */
export async function uploadStudioBuffer(params: {
  buffer: Buffer;
  contentType: string;
  key: string;
  cacheControl?: string;
}): Promise<string> {
  const provider = getStorageProvider();

  if (provider === "spaces") {
    const config = getRequiredSpacesConfig();
    const client = createSpacesClient(config);

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: params.key.replace(/^\/+/, ""),
          Body: params.buffer,
          ContentType: params.contentType,
          ACL: "public-read",
          CacheControl: params.cacheControl ?? "public, max-age=31536000, immutable",
        }),
      );
    } catch (err) {
      throw new Error(`DigitalOcean Spaces upload failed (${describeStorageError(err)})`);
    }

    return buildSpacesPublicUrl(params.key, config);
  }

  // Local private filesystem storage outside Next.js `public/`
  const fs = await import("fs/promises");
  const path = await import("path");
  const privateImagesDir = getPrivateVideoStudioImagesDir(path);
  await fs.mkdir(privateImagesDir, { recursive: true });

  const filename = sanitizeLocalFilename(params.key, path);
  const filePath = path.join(privateImagesDir, filename);
  if (!filePath.startsWith(privateImagesDir + path.sep)) {
    throw new Error("Invalid local storage path.");
  }

  try {
    await fs.writeFile(filePath, params.buffer);
  } catch (err) {
    await fs.unlink(filePath).catch(() => {});
    throw err;
  }

  return buildAdminSceneImagePreviewUrl(filename);
}

/**
 * Uploads a scene image and returns its authenticated preview route or Spaces URL.
 *
 * - In local development: saves privately to storage/video-studio/images/ and returns /api/admin/video-studio/image/{file}
 * - In production: uploads to DigitalOcean Spaces and returns the CDN/Spaces URL.
 * - In production, if Spaces is not configured, throws a clear configuration error instead of silently falling back.
 */
export async function uploadSceneImage(file: File, key: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadStudioBuffer({
    buffer,
    contentType: file.type,
    key,
    cacheControl: "public, max-age=31536000, immutable",
  });
}

/**
 * Uploads a private studio asset buffer (such as scene voiceover audio) using the
 * configured storage provider without placing private assets in a public directory in production:
 * - In local development: stores outside `public/` under storage/video-studio/ and returns `local-private:<filename>`.
 * - In production: uploads to DigitalOcean Spaces with `ACL: "private"` and returns the Spaces object key.
 */
export async function uploadPrivateStudioAsset(params: {
  buffer: Buffer;
  contentType: string;
  key: string;
  cacheControl?: string;
}): Promise<string> {
  const provider = getStorageProvider();

  if (provider === "spaces") {
    const config = getRequiredSpacesConfig();
    const client = createSpacesClient(config);
    const normalizedKey = params.key.replace(/^\/+/, "");

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: normalizedKey,
          Body: params.buffer,
          ContentType: params.contentType,
          ACL: "private",
          CacheControl: params.cacheControl ?? "private, max-age=31536000",
        }),
      );
    } catch (err) {
      throw new Error(`DigitalOcean Spaces private upload failed (${describeStorageError(err)})`);
    }

    return normalizedKey;
  }

  // Local private filesystem storage outside `public/`
  const fs = await import("fs/promises");
  const path = await import("path");
  const privateDir = getPrivateVideoStudioDir(path);
  await fs.mkdir(privateDir, { recursive: true });

  const filename = sanitizeLocalFilename(params.key, path);
  const filePath = path.join(privateDir, filename);
  if (!filePath.startsWith(privateDir + path.sep)) {
    throw new Error("Invalid local private storage path.");
  }

  try {
    await fs.writeFile(filePath, params.buffer);
  } catch (err) {
    await fs.unlink(filePath).catch(() => {});
    throw err;
  }

  return `${LOCAL_PRIVATE_ASSET_PREFIX}${filename}`;
}

/**
 * Reads a private studio asset stored via `uploadPrivateStudioAsset`.
 * Only server-side admin routes or server workers should call this.
 */
export async function readPrivateStudioAsset(storageKey: string): Promise<Buffer> {
  const cleanKey = storageKey?.trim();
  if (!cleanKey) {
    throw new Error("Missing private asset storage key.");
  }

  if (cleanKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const rawName = cleanKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    const filename = sanitizeLocalFilename(rawName, path);
    if (rawName !== filename) {
      throw new Error("Invalid private asset storage key.");
    }
    const privateDir = getPrivateVideoStudioDir(path);
    const filePath = path.join(privateDir, filename);
    if (!filePath.startsWith(privateDir + path.sep)) {
      throw new Error("Invalid private asset storage path.");
    }
    return fs.readFile(filePath);
  }

  const provider = getStorageProvider();
  const config = provider === "spaces" ? getRequiredSpacesConfig() : getSpacesConfigOptional();
  if (!config) {
    throw new Error("DigitalOcean Spaces is not configured for reading private studio assets.");
  }

  const objectKey = extractSpacesObjectKey(cleanKey, config);
  if (!objectKey) {
    throw new Error("Invalid private studio asset key.");
  }

  const client = createSpacesClient(config);
  try {
    const res = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
    );
    if (!res.Body) {
      throw new Error("Empty response body from DigitalOcean Spaces.");
    }
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    throw new Error(`Failed to read private studio asset (${describeStorageError(err)})`);
  }
}

/**
 * Deletes a scene image or private studio asset from storage (local private filesystem or DigitalOcean Spaces).
 * Supports private local images (/api/admin/video-studio/image/, local-private-image:, legacy /uploads/video-studio/),
 * local-private: files, standard DO Spaces URLs, custom CDN URLs, and raw Spaces keys.
 */
export async function deleteSceneImage(imageUrlOrKey: string): Promise<void> {
  if (!imageUrlOrKey?.trim()) return;

  const cleanInput = imageUrlOrKey.trim().split("?")[0].split("#")[0];

  // Local private filesystem deletion (strictly within storage/video-studio/)
  if (cleanInput.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const rawName = cleanInput.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    const filename = path.posix.basename(rawName);
    if (!filename || filename === "." || filename === ".." || rawName !== filename || /[\\/\0]/.test(filename)) {
      throw new Error("Invalid local private asset path.");
    }
    const privateDir = getPrivateVideoStudioDir(path);
    const filePath = path.join(privateDir, filename);
    if (!filePath.startsWith(privateDir + path.sep)) {
      throw new Error("Invalid local private asset path.");
    }
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") return;
      throw err;
    }
    return;
  }

  // Local private scene image deletion (strictly within storage/video-studio/images/)
  const rawImageName = extractRawLocalImageName(cleanInput);
  if (rawImageName !== null) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filename = path.posix.basename(rawImageName);
    if (
      !filename ||
      filename === "." ||
      filename === ".." ||
      rawImageName !== filename ||
      rawImageName.includes("..") ||
      /[\\/\0]/.test(filename)
    ) {
      throw new Error("Invalid local asset path.");
    }
    const privateImagesDir = getPrivateVideoStudioImagesDir(path);
    const filePath = path.join(privateImagesDir, filename);
    if (!filePath.startsWith(privateImagesDir + path.sep)) {
      throw new Error("Invalid local asset path.");
    }
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") return;
      throw err;
    }
    return;
  }

  const provider = getStorageProvider();

  // Local private rendered video deletion (strictly within storage/video-studio/<projectId>/renders/)
  const localRenderMatch = /^video-studio\/([a-zA-Z0-9_-]+)\/renders\/(render_[a-zA-Z0-9_-]+\.mp4)$/.exec(cleanInput);
  if (localRenderMatch && provider === "local") {
    const fs = await import("fs/promises");
    const path = await import("path");
    const privateRoot = getPrivateVideoStudioDir(path);
    const filePath = path.join(privateRoot, localRenderMatch[1], "renders", localRenderMatch[2]);
    if (!filePath.startsWith(privateRoot + path.sep)) {
      throw new Error("Invalid local render output path.");
    }
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT") return;
      throw err;
    }
    return;
  }

  const config = provider === "spaces" ? getRequiredSpacesConfig() : getSpacesConfigOptional();
  if (!config) return;

  const key = extractSpacesObjectKey(cleanInput, config);
  if (!key) return;

  const client = createSpacesClient(config);
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
      }),
    );
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
      return;
    }
    throw new Error(`DigitalOcean Spaces delete failed (${describeStorageError(err)})`);
  }
}

export const deleteStudioAsset = deleteSceneImage;

/* ---------- Part C2: Render Input Asset Resolution ---------- */

export async function resolveRenderSceneImageAsset(
  imageUrl: string,
): Promise<{ ok: true; asset: RenderSnapshotImageAsset } | { ok: false; error: string }> {
  const raw = imageUrl?.trim();
  if (!raw) {
    return { ok: false, error: "Scene image URL is empty." };
  }

  const clean = raw.split("?")[0].split("#")[0];
  if (/^(blob|data):/i.test(clean)) {
    return { ok: false, error: "Temporary browser image URLs cannot be rendered." };
  }

  const provider = getStorageProvider();

  const rawLocalImageName = extractRawLocalImageName(clean);
  if (rawLocalImageName !== null) {
    if (provider === "spaces") {
      return {
        ok: false,
        error: "Local filesystem image path cannot be resolved when storage provider is Spaces.",
      };
    }

    const fs = await import("fs/promises");
    const path = await import("path");
    let filename: string;
    try {
      filename = sanitizeLocalFilename(rawLocalImageName, path);
    } catch {
      return { ok: false, error: "Invalid local scene image path." };
    }
    if (rawLocalImageName !== filename || rawLocalImageName.includes("..")) {
      return { ok: false, error: "Invalid local scene image path." };
    }
    if (!inferImageFormatFromRef(filename)) {
      return { ok: false, error: `Scene image "${filename}" must have a JPG, PNG, or WebP extension.` };
    }

    const privateImagesDir = getPrivateVideoStudioImagesDir(path);
    let rootReal: string;
    try {
      rootReal = await fs.realpath(privateImagesDir);
    } catch {
      return { ok: false, error: `Scene image file "${filename}" does not exist in storage.` };
    }

    const filePath = path.join(rootReal, filename);
    if (!isPathInsideRoot(rootReal, filePath, path)) {
      return { ok: false, error: "Invalid local scene image path." };
    }

    try {
      const lstat = await fs.lstat(filePath);
      if (lstat.isSymbolicLink() || !lstat.isFile() || lstat.size <= 0) {
        return { ok: false, error: `Scene image file "${filename}" is empty or unreadable.` };
      }
      const realFile = await fs.realpath(filePath);
      if (!isPathInsideRoot(rootReal, realFile, path)) {
        return { ok: false, error: "Invalid local scene image path." };
      }
    } catch {
      return { ok: false, error: `Scene image file "${filename}" does not exist in storage.` };
    }

    return {
      ok: true,
      asset: {
        sourceUrl: clean,
        provider: "local",
        resolvedPathOrKey: `${LOCAL_PRIVATE_IMAGE_PREFIX}${filename}`,
      },
    };
  }

  const config = provider === "spaces" ? getRequiredSpacesConfig() : getSpacesConfigOptional();
  if (!config) {
    return {
      ok: false,
      error: `Scene image "${clean}" could not be resolved in local storage (and DigitalOcean Spaces is not configured).`,
    };
  }

  const objectKey = extractSpacesObjectKey(clean, config);
  if (!objectKey || objectKey.includes("..") || /[\\\0]/.test(objectKey)) {
    return {
      ok: false,
      error: `Scene image URL "${clean}" does not resolve to an owned storage asset.`,
    };
  }

  return {
    ok: true,
    asset: {
      sourceUrl: clean,
      provider: "spaces",
      resolvedPathOrKey: objectKey,
    },
  };
}

export async function resolveRenderSceneAudioAsset(
  audioMeta: SceneAudioMetadata,
): Promise<{ ok: true; asset: RenderSnapshotAudioAsset } | { ok: false; error: string }> {
  const cleanKey = audioMeta.storageKey?.trim();
  if (!cleanKey) {
    return { ok: false, error: "Scene voiceover storage key is empty." };
  }

  if (audioMeta.status !== "ready") {
    return { ok: false, error: `Scene voiceover audio status is "${audioMeta.status}".` };
  }

  const provider = getStorageProvider();

  if (cleanKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
    if (provider === "spaces") {
      return {
        ok: false,
        error: "Private local audio asset cannot be resolved when storage provider is Spaces.",
      };
    }

    const fs = await import("fs/promises");
    const path = await import("path");
    const rawName = cleanKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    let filename: string;
    try {
      filename = sanitizeLocalFilename(rawName, path);
    } catch {
      return { ok: false, error: "Invalid private audio asset key." };
    }
    if (rawName !== filename) {
      return { ok: false, error: "Invalid private audio asset key." };
    }

    const privateDir = getPrivateVideoStudioDir(path);
    const filePath = path.join(privateDir, filename);
    if (!filePath.startsWith(privateDir + path.sep)) {
      return { ok: false, error: "Invalid private audio asset path." };
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) {
        return { ok: false, error: `Voiceover audio file "${filename}" is empty or unreadable.` };
      }
    } catch {
      return { ok: false, error: `Voiceover audio file "${filename}" does not exist in private storage.` };
    }

    return {
      ok: true,
      asset: {
        storageKey: cleanKey,
        provider: "local-private",
        resolvedKey: cleanKey,
        format: audioMeta.format,
        mimeType: audioMeta.mimeType,
        durationSec: audioMeta.durationSec,
        model: audioMeta.model,
        voice: audioMeta.voice ?? null,
        languageCode: audioMeta.languageCode ?? null,
        narrationHash: audioMeta.narrationHash ?? null,
      },
    };
  }

  const config = provider === "spaces" ? getRequiredSpacesConfig() : getSpacesConfigOptional();
  if (!config) {
    return {
      ok: false,
      error: "DigitalOcean Spaces is not configured to resolve private voiceover assets.",
    };
  }

  const objectKey = extractSpacesObjectKey(cleanKey, config);
  if (!objectKey || objectKey.includes("..") || /[\\\0]/.test(objectKey)) {
    return {
      ok: false,
      error: `Private voiceover key "${cleanKey}" does not resolve to an owned storage asset.`,
    };
  }

  return {
    ok: true,
    asset: {
      storageKey: cleanKey,
      provider: "spaces",
      resolvedKey: objectKey,
      format: audioMeta.format,
      mimeType: audioMeta.mimeType,
      durationSec: audioMeta.durationSec,
      model: audioMeta.model,
      voice: audioMeta.voice ?? null,
      languageCode: audioMeta.languageCode ?? null,
      narrationHash: audioMeta.narrationHash ?? null,
    },
  };
}

export async function resolveRenderAssetsForScenes(
  scenes: {
    id: string;
    order: number;
    title: string;
    imageUrl: string | null;
    audio: SceneAudioMetadata | null;
  }[],
): Promise<{
  issues: RenderValidationIssue[];
  resolvedBySceneId: Map<string, { image: RenderSnapshotImageAsset; audio: RenderSnapshotAudioAsset }>;
}> {
  const issues: RenderValidationIssue[] = [];
  const resolvedBySceneId = new Map<
    string,
    { image: RenderSnapshotImageAsset; audio: RenderSnapshotAudioAsset }
  >();

  for (let idx = 0; idx < scenes.length; idx++) {
    const s = scenes[idx];
    const displayNum = Number.isInteger(s.order) && s.order > 0 ? s.order : idx + 1;
    const label = s.title?.trim() ? `Scene ${displayNum} ("${s.title.trim()}")` : `Scene ${displayNum}`;

    let resolvedImage: RenderSnapshotImageAsset | null = null;
    let resolvedAudio: RenderSnapshotAudioAsset | null = null;

    if (s.imageUrl?.trim()) {
      const imgRes = await resolveRenderSceneImageAsset(s.imageUrl);
      if (!imgRes.ok) {
        issues.push({
          code: "UNRESOLVABLE_IMAGE_ASSET",
          level: "error",
          message: `${label}: ${imgRes.error}`,
          sceneId: s.id,
          sceneOrder: displayNum,
        });
      } else {
        resolvedImage = imgRes.asset;
      }
    }

    if (s.audio && s.audio.status === "ready" && s.audio.storageKey?.trim()) {
      const audioRes = await resolveRenderSceneAudioAsset(s.audio);
      if (!audioRes.ok) {
        issues.push({
          code: "UNRESOLVABLE_AUDIO_ASSET",
          level: "error",
          message: `${label}: ${audioRes.error}`,
          sceneId: s.id,
          sceneOrder: displayNum,
        });
      } else {
        resolvedAudio = audioRes.asset;
      }
    }

    if (resolvedImage && resolvedAudio) {
      resolvedBySceneId.set(s.id, { image: resolvedImage, audio: resolvedAudio });
    }
  }

  return { issues, resolvedBySceneId };
}

export async function verifySnapshotAssetsResolvable(
  snapshot: RenderJobSnapshot,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const scene of snapshot.scenes) {
    const imgRes = await resolveRenderSceneImageAsset(scene.image.sourceUrl);
    if (!imgRes.ok) {
      return {
        ok: false,
        error: `Cannot retry render job because Scene ${scene.order} ("${scene.title}") image is unavailable: ${imgRes.error}`,
      };
    }

    const audioRes = await resolveRenderSceneAudioAsset({
      audioUrl: `/api/admin/video-studio/audio?projectId=${snapshot.project.projectId}&sceneId=${scene.sceneId}`,
      storageKey: scene.audio.storageKey,
      format: scene.audio.format,
      mimeType: scene.audio.mimeType,
      durationSec: scene.audio.durationSec,
      model: scene.audio.model,
      voice: scene.audio.voice,
      languageCode: scene.audio.languageCode,
      narrationHash: scene.audio.narrationHash ?? undefined,
      status: "ready",
      generatedAt: snapshot.capturedAt,
    });
    if (!audioRes.ok) {
      return {
        ok: false,
        error: `Cannot retry render job because Scene ${scene.order} ("${scene.title}") audio is unavailable: ${audioRes.error}`,
      };
    }
  }

  return { ok: true };
}

/* ---------- Part C3.2.3: Secure Streaming Asset Reader for Render Worker ---------- */

export class RenderAssetStreamError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "RenderAssetStreamError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type OpenedSnapshotAssetStream = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number | null;
  safeFilename: string;
};

function isPathInsideRoot(
  rootReal: string,
  targetReal: string,
  pathMod: typeof import("path"),
): boolean {
  const normRoot = process.platform === "win32" ? rootReal.toLowerCase() : rootReal;
  const normTarget = process.platform === "win32" ? targetReal.toLowerCase() : targetReal;
  const prefix = normRoot.endsWith(pathMod.sep) ? normRoot : normRoot + pathMod.sep;
  return normTarget.startsWith(prefix);
}

function nodeReadableToWebStream(
  nodeStream: Readable,
  abortSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  let closed = false;
  let onAbort: (() => void) | null = null;

  const cleanupListeners = () => {
    if (abortSignal && onAbort) {
      abortSignal.removeEventListener("abort", onAbort);
      onAbort = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (!closed) {
          closed = true;
          controller.error(new Error("Asset stream aborted by client."));
        }
        nodeStream.destroy();
        cleanupListeners();
      };

      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      nodeStream.on("data", (chunk: Buffer | Uint8Array | string) => {
        if (closed) return;
        const bytes =
          typeof chunk === "string"
            ? Buffer.from(chunk, "utf8")
            : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          nodeStream.pause();
        }
      });

      nodeStream.once("end", () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
        cleanupListeners();
      });

      nodeStream.once("error", (err) => {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
        cleanupListeners();
      });
    },
    pull() {
      if (!closed) {
        nodeStream.resume();
      }
    },
    cancel() {
      closed = true;
      cleanupListeners();
      nodeStream.destroy();
    },
  });
}

function wrapBoundedByteStream(
  source: ReadableStream<Uint8Array>,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let totalRead = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      totalRead += value.byteLength;
      if (totalRead > maxBytes) {
        await reader.cancel().catch(() => {});
        controller.error(
          new RenderAssetStreamError(
            413,
            "ASSET_TOO_LARGE",
            `Asset stream exceeded maximum allowed size (${maxBytes} bytes).`,
          ),
        );
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
}

function s3BodyToWebStream(body: unknown, abortSignal?: AbortSignal): ReadableStream<Uint8Array> {
  if (!body || typeof body !== "object") {
    throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Spaces asset response body is empty.");
  }

  const candidate = body as {
    getReader?: unknown;
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToByteArray?: () => Promise<Uint8Array>;
    on?: unknown;
    pipe?: unknown;
  };

  if (typeof candidate.getReader === "function") {
    return body as ReadableStream<Uint8Array>;
  }

  if (typeof candidate.transformToWebStream === "function") {
    return candidate.transformToWebStream();
  }

  if (body instanceof Readable || (typeof candidate.on === "function" && typeof candidate.pipe === "function")) {
    return nodeReadableToWebStream(body as Readable, abortSignal);
  }

  if (typeof candidate.transformToByteArray === "function") {
    let consumed = false;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (consumed) {
          controller.close();
          return;
        }
        consumed = true;
        try {
          const bytes = await candidate.transformToByteArray!();
          if (bytes.byteLength > 0) {
            controller.enqueue(new Uint8Array(bytes));
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });
  }

  throw new RenderAssetStreamError(502, "UNSUPPORTED_STORAGE_STREAM", "Unsupported Spaces response stream.");
}

function destroyS3BodySafely(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const candidate = body as { destroy?: () => void; cancel?: () => Promise<void> };
  try {
    if (typeof candidate.destroy === "function") {
      candidate.destroy();
    } else if (typeof candidate.cancel === "function") {
      void candidate.cancel().catch(() => {});
    }
  } catch {
    // Ignore cleanup errors on rejected streams
  }
}

async function openVerifiedLocalFileStream(params: {
  baseDir: string;
  rawName: string;
  contentType: string;
  maxBytes: number;
  safeFilename: string;
  signal?: AbortSignal;
}): Promise<OpenedSnapshotAssetStream> {
  const fsPromises = await import("node:fs/promises");
  const fsSync = await import("node:fs");
  const pathMod = await import("node:path");

  let filename: string;
  try {
    filename = sanitizeLocalFilename(params.rawName, pathMod);
  } catch {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Invalid local asset filename.");
  }
  if (params.rawName !== filename || params.rawName.includes("..")) {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Local asset path traversal is forbidden.");
  }

  let rootReal: string;
  try {
    rootReal = await fsPromises.realpath(params.baseDir);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Asset does not exist in local storage.");
    }
    throw new RenderAssetStreamError(500, "STORAGE_READ_FAILED", "Failed to access local asset storage directory.");
  }

  const candidatePath = pathMod.join(rootReal, filename);
  if (!isPathInsideRoot(rootReal, candidatePath, pathMod)) {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Asset path escaped local storage root.");
  }

  let stat: import("node:fs").Stats;
  try {
    stat = await fsPromises.lstat(candidatePath);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Requested local asset file was not found.");
    }
    throw new RenderAssetStreamError(500, "STORAGE_READ_FAILED", "Failed to inspect local asset file.");
  }

  if (stat.isSymbolicLink()) {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Symlink asset files are not permitted.");
  }
  if (!stat.isFile()) {
    throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Requested local asset is not a regular file.");
  }

  let fileReal: string;
  try {
    fileReal = await fsPromises.realpath(candidatePath);
  } catch {
    throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Requested local asset file could not be resolved.");
  }
  if (!isPathInsideRoot(rootReal, fileReal, pathMod)) {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Resolved asset path escaped local storage root.");
  }

  if (stat.size <= 0) {
    throw new RenderAssetStreamError(422, "EMPTY_ASSET", "Asset file in storage is empty.");
  }
  if (stat.size > params.maxBytes) {
    throw new RenderAssetStreamError(
      413,
      "ASSET_TOO_LARGE",
      `Asset size (${stat.size} bytes) exceeds maximum allowed limit (${params.maxBytes} bytes).`,
    );
  }

  const nodeStream = fsSync.createReadStream(fileReal);
  const boundedStream = wrapBoundedByteStream(
    nodeReadableToWebStream(nodeStream, params.signal),
    params.maxBytes,
  );

  return {
    stream: boundedStream,
    contentType: params.contentType,
    contentLength: stat.size,
    safeFilename: params.safeFilename,
  };
}

/**
 * Streams a private local scene image from storage/video-studio/images/ for authenticated ADMIN previews.
 */
export async function openPrivateSceneImagePreviewStream(params: {
  rawFilename: string;
  signal?: AbortSignal;
}): Promise<OpenedSnapshotAssetStream> {
  if (getStorageProvider() !== "local") {
    throw new RenderAssetStreamError(
      404,
      "LOCAL_STORAGE_INACTIVE",
      "Local private image preview is unavailable when DigitalOcean Spaces is active.",
    );
  }

  const raw = params.rawFilename?.trim() ?? "";
  if (
    !raw ||
    raw === "." ||
    raw === ".." ||
    raw.includes("..") ||
    /[\\/\0?#]/.test(raw) ||
    !/^[a-zA-Z0-9._-]+$/.test(raw)
  ) {
    throw new RenderAssetStreamError(400, "INVALID_IMAGE_FILENAME", "Invalid scene image filename.");
  }

  const inferred = inferImageFormatFromRef(raw);
  if (!inferred) {
    throw new RenderAssetStreamError(
      400,
      "UNSUPPORTED_IMAGE_FORMAT",
      "Only JPG, PNG, and WebP scene images can be previewed.",
    );
  }

  const pathMod = await import("node:path");
  return openVerifiedLocalFileStream({
    baseDir: getPrivateVideoStudioImagesDir(pathMod),
    rawName: raw,
    contentType: inferred.mimeType,
    maxBytes: MAX_RENDER_IMAGE_BYTES,
    safeFilename: raw,
    signal: params.signal,
  });
}

/**
 * Streams a snapshot-authorized media asset from the active authoritative storage provider
 * without silently falling back between local filesystem and DigitalOcean Spaces, without
 * leaking server filesystem paths or storage secrets, and without loading full files into RAM.
 */
export async function openSnapshotAssetStream(params: {
  asset: AuthorizedSnapshotAsset;
  signal?: AbortSignal;
}): Promise<OpenedSnapshotAssetStream> {
  const { asset } = params;
  const activeProvider = getStorageProvider();

  if (asset.provider === "local" || asset.provider === "local-private") {
    if (activeProvider !== "local") {
      throw new RenderAssetStreamError(
        422,
        "STORAGE_PROVIDER_MISMATCH",
        "Storage provider mismatch: local snapshot asset cannot be accessed while STORAGE_PROVIDER is set to Spaces.",
      );
    }

    const pathMod = await import("node:path");

    let baseDir: string;
    let rawName: string;

    if (asset.kind === "image") {
      const rawImageName = extractRawLocalImageName(asset.resolvedRef);
      if (rawImageName !== null) {
        baseDir = getPrivateVideoStudioImagesDir(pathMod);
        rawName = rawImageName;
      } else if (asset.resolvedRef.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
        baseDir = getPrivateVideoStudioDir(pathMod);
        rawName = asset.resolvedRef.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      } else {
        throw new RenderAssetStreamError(
          403,
          "INVALID_ASSET_REFERENCE",
          "Snapshot asset does not reference an authorized local video-studio path.",
        );
      }
    } else if (asset.resolvedRef.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      baseDir = getPrivateVideoStudioDir(pathMod);
      rawName = asset.resolvedRef.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    } else {
      throw new RenderAssetStreamError(
        403,
        "INVALID_ASSET_REFERENCE",
        "Snapshot asset does not reference an authorized local video-studio path.",
      );
    }

    return openVerifiedLocalFileStream({
      baseDir,
      rawName,
      contentType: asset.mimeType,
      maxBytes: asset.maxBytes,
      safeFilename: asset.safeFilename,
      signal: params.signal,
    });
  }

  // DigitalOcean Spaces private object streaming via server-side credentials
  if (activeProvider !== "spaces") {
    throw new RenderAssetStreamError(
      422,
      "STORAGE_PROVIDER_MISMATCH",
      "Storage provider mismatch: DigitalOcean Spaces snapshot asset cannot be accessed while STORAGE_PROVIDER is local.",
    );
  }

  const config = getRequiredSpacesConfig();
  if (
    /^https?:\/\//i.test(asset.resolvedRef) ||
    asset.resolvedRef.startsWith("/") ||
    asset.resolvedRef.includes("..") ||
    /[\\\0]/.test(asset.resolvedRef)
  ) {
    throw new RenderAssetStreamError(
      403,
      "INVALID_ASSET_REFERENCE",
      "Spaces snapshot asset key is not an authorized relative object key.",
    );
  }

  const extractedKey = extractSpacesObjectKey(asset.resolvedRef, config);
  if (!extractedKey || extractedKey !== asset.resolvedRef.replace(/^\/+/, "")) {
    throw new RenderAssetStreamError(
      403,
      "INVALID_ASSET_REFERENCE",
      "Spaces snapshot asset key could not be verified against the configured bucket.",
    );
  }

  const client = createSpacesClient(config);
  type SpacesGetObjectResult = {
    Body?: unknown;
    ContentLength?: number;
    ContentType?: string;
  };
  let res: SpacesGetObjectResult;
  try {
    res = (await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: extractedKey,
      }),
      params.signal ? { abortSignal: params.signal } : undefined,
    )) as unknown as SpacesGetObjectResult;
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "AbortError") {
      throw new RenderAssetStreamError(499, "REQUEST_ABORTED", "Asset transfer aborted by client.");
    }
    if (
      e?.name === "NoSuchKey" ||
      e?.Code === "NoSuchKey" ||
      e?.name === "NotFound" ||
      e?.$metadata?.httpStatusCode === 404
    ) {
      throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Asset object does not exist in private Spaces storage.");
    }
    throw new RenderAssetStreamError(
      502,
      "STORAGE_READ_FAILED",
      `Failed to read private Spaces asset (${describeStorageError(err)}).`,
    );
  }

  if (!res?.Body) {
    throw new RenderAssetStreamError(404, "ASSET_NOT_FOUND", "Asset object body is missing in private Spaces storage.");
  }

  const rawLength = res.ContentLength;
  if (typeof rawLength === "number") {
    if (!Number.isFinite(rawLength) || rawLength <= 0) {
      destroyS3BodySafely(res.Body);
      throw new RenderAssetStreamError(422, "EMPTY_ASSET", "Asset object in private Spaces storage is empty.");
    }
    if (rawLength > asset.maxBytes) {
      destroyS3BodySafely(res.Body);
      throw new RenderAssetStreamError(
        413,
        "ASSET_TOO_LARGE",
        `Spaces asset size (${rawLength} bytes) exceeds maximum allowed limit (${asset.maxBytes} bytes).`,
      );
    }
  }

  const rawS3Type = typeof res.ContentType === "string" ? res.ContentType.split(";")[0]?.trim().toLowerCase() ?? "" : "";
  if (
    rawS3Type &&
    rawS3Type !== "application/octet-stream" &&
    rawS3Type !== "binary/octet-stream"
  ) {
    const expectedCategory = asset.kind === "image" ? "image/" : "audio/";
    const allowedOgg = asset.kind === "audio" && asset.format === "ogg" && rawS3Type === "application/ogg";
    if (!rawS3Type.startsWith(expectedCategory) && !allowedOgg) {
      destroyS3BodySafely(res.Body);
      throw new RenderAssetStreamError(
        422,
        "INVALID_ASSET_MEDIA_TYPE",
        `Unexpected storage Content-Type "${rawS3Type}" for ${asset.kind} asset.`,
      );
    }
  }

  const webStream = wrapBoundedByteStream(
    s3BodyToWebStream(res.Body, params.signal),
    asset.maxBytes,
  );

  return {
    stream: webStream,
    contentType: asset.mimeType,
    contentLength: typeof rawLength === "number" && rawLength > 0 ? rawLength : null,
    safeFilename: asset.safeFilename,
  };
}

/* ---------- Part C3.3: Private Rendered MP4 Storage, Verification & Admin Streaming ---------- */

const SAFE_STORAGE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export type UploadedRenderVideoResult = {
  outputStorageKey: string;
  provider: "local-private" | "spaces";
  fileSizeBytes: number;
  checksumSha256: string;
  etag: string | null;
};

export type VerifiedStoredRenderVideoResult = {
  exists: true;
  outputStorageKey: string;
  provider: "local-private" | "spaces";
  fileSizeBytes: number;
  checksumSha256: string | null;
  etag: string | null;
};

export type OpenedAdminRenderVideoStream = {
  stream: ReadableStream<Uint8Array>;
  status: 200 | 206;
  contentType: "video/mp4";
  contentLength: number;
  totalSize: number;
  contentRange: string | null;
};

function assertSafeStorageSegment(value: string, label: string): string {
  const clean = value?.trim() ?? "";
  if (!SAFE_STORAGE_ID_REGEX.test(clean)) {
    throw new RenderAssetStreamError(400, "INVALID_STORAGE_IDENTIFIER", `Invalid ${label} for render storage.`);
  }
  return clean;
}

async function resolveLocalRenderOutputTarget(params: {
  outputStorageKey: string;
  projectId: string;
  jobId: string;
  ensureDir?: boolean;
}): Promise<{
  normalizedKey: string;
  targetDir: string;
  targetFilePath: string;
  filename: string;
}> {
  const safeProjectId = assertSafeStorageSegment(params.projectId, "projectId");
  const safeJobId = assertSafeStorageSegment(params.jobId, "jobId");

  const keyCheck = validateWorkerOutputStorageKey({
    outputStorageKey: params.outputStorageKey,
    projectId: safeProjectId,
    jobId: safeJobId,
    expectedProvider: "local-private",
  });
  if (!keyCheck.ok) {
    throw new RenderAssetStreamError(422, "INVALID_OUTPUT_KEY", keyCheck.error);
  }

  const fsPromises = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const privateStudioRoot = getPrivateVideoStudioDir(pathMod);

  let targetDir: string;
  let filename: string;

  if (keyCheck.normalizedKey === buildRenderLocalPrivateOutputKey(safeJobId)) {
    targetDir = privateStudioRoot;
    filename = `render_${safeJobId}.mp4`;
  } else {
    targetDir = pathMod.join(privateStudioRoot, safeProjectId, "renders");
    filename = `render_${safeJobId}.mp4`;
  }

  if (params.ensureDir) {
    await fsPromises.mkdir(targetDir, { recursive: true });
  }

  const candidatePath = pathMod.join(targetDir, filename);
  if (!isPathInsideRoot(privateStudioRoot, candidatePath, pathMod)) {
    throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Resolved render output path escaped private storage.");
  }

  return {
    normalizedKey: keyCheck.normalizedKey,
    targetDir,
    targetFilePath: candidatePath,
    filename,
  };
}

function writeNodeStreamChunk(ws: import("node:fs").WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      ws.off("drain", onDrain);
      reject(err);
    };
    const onDrain = () => {
      ws.off("error", onError);
      resolve();
    };
    ws.once("error", onError);
    const ok = ws.write(chunk);
    if (ok) {
      ws.off("error", onError);
      resolve();
    } else {
      ws.once("drain", onDrain);
    }
  });
}

function finishNodeWriteStream(ws: import("node:fs").WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinish = () => {
      ws.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      ws.off("finish", onFinish);
      reject(err);
    };
    ws.once("finish", onFinish);
    ws.once("error", onError);
    ws.end();
  });
}

function destroyNodeWriteStreamSafe(ws: import("node:fs").WriteStream): Promise<void> {
  if (ws.closed) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      ws.off("close", done);
      ws.off("error", onError);
      resolve();
    };
    const onError = () => {
      // Wait briefly for 'close' so the OS file descriptor (especially on Windows) is released before unlink;
      // fall back if 'close' does not follow shortly (e.g., error occurred before fd opened).
      setTimeout(done, 50);
    };
    const t = setTimeout(done, 2000);
    ws.once("close", done);
    ws.once("error", onError);
    if (!ws.destroyed) {
      ws.destroy();
    }
  });
}

async function readStreamChunkWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) {
    return reader.read();
  }
  if (signal.aborted) {
    throw new RenderAssetStreamError(499, "UPLOAD_ABORTED", "Render MP4 upload aborted.");
  }

  let onAbort: (() => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new RenderAssetStreamError(499, "UPLOAD_ABORTED", "Render MP4 upload aborted."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([reader.read(), abortPromise]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Verifies an uploaded or stored render MP4 in the active authoritative private storage provider:
 * - Ensures provider matches snapshot expectation (no silent fallback)
 * - Confirms object exists, is a regular non-empty file/object within size limits
 * - Validates MP4 ISO BMFF (`ftyp`) container signature
 * - Confirms exact byte size and SHA-256 digest when supplied
 */
export async function verifyStoredRenderVideoObject(params: {
  outputStorageKey: string;
  projectId: string;
  jobId: string;
  expectedProvider: "local-private" | "spaces";
  expectedSizeBytes?: number | null;
  expectedSha256?: string | null;
}): Promise<VerifiedStoredRenderVideoResult> {
  const safeProjectId = assertSafeStorageSegment(params.projectId, "projectId");
  const safeJobId = assertSafeStorageSegment(params.jobId, "jobId");

  const keyCheck = validateWorkerOutputStorageKey({
    outputStorageKey: params.outputStorageKey,
    projectId: safeProjectId,
    jobId: safeJobId,
    expectedProvider: params.expectedProvider,
  });
  if (!keyCheck.ok) {
    throw new RenderAssetStreamError(422, "INVALID_OUTPUT_KEY", keyCheck.error);
  }

  const activeProvider = getStorageProvider();
  const normalizedExpectedSha = params.expectedSha256?.trim().toLowerCase() || null;

  if (params.expectedProvider === "local-private") {
    if (activeProvider !== "local") {
      throw new RenderAssetStreamError(
        422,
        "STORAGE_PROVIDER_MISMATCH",
        "Storage provider mismatch: local-private render output cannot be verified when STORAGE_PROVIDER is Spaces.",
      );
    }

    const fsPromises = await import("node:fs/promises");
    const fsSync = await import("node:fs");
    const pathMod = await import("node:path");
    const privateRoot = getPrivateVideoStudioDir(pathMod);
    const resolved = await resolveLocalRenderOutputTarget({
      outputStorageKey: keyCheck.normalizedKey,
      projectId: safeProjectId,
      jobId: safeJobId,
    });

    let stat: import("node:fs").Stats;
    try {
      stat = await fsPromises.lstat(resolved.targetFilePath);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new RenderAssetStreamError(
          422,
          "OUTPUT_NOT_FOUND",
          "Rendered MP4 file was not found in private local storage.",
        );
      }
      throw new RenderAssetStreamError(500, "STORAGE_READ_FAILED", "Failed to inspect rendered MP4 in local storage.");
    }

    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new RenderAssetStreamError(422, "INVALID_OUTPUT_FILE", "Rendered MP4 path must be a regular non-symlink file.");
    }

    let rootReal: string;
    let fileReal: string;
    try {
      rootReal = await fsPromises.realpath(privateRoot);
      fileReal = await fsPromises.realpath(resolved.targetFilePath);
    } catch {
      throw new RenderAssetStreamError(422, "OUTPUT_NOT_FOUND", "Rendered MP4 path could not be resolved in private storage.");
    }
    if (!isPathInsideRoot(rootReal, fileReal, pathMod)) {
      throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Rendered MP4 path escaped private storage root.");
    }

    if (stat.size <= 0) {
      throw new RenderAssetStreamError(422, "EMPTY_OUTPUT_FILE", "Rendered MP4 file in storage is empty (0 bytes).");
    }
    if (stat.size > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
      throw new RenderAssetStreamError(
        413,
        "OUTPUT_TOO_LARGE",
        `Rendered MP4 file (${stat.size} bytes) exceeds maximum allowed size (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
      );
    }
    if (params.expectedSizeBytes != null && stat.size !== params.expectedSizeBytes) {
      throw new RenderAssetStreamError(
        422,
        "OUTPUT_SIZE_MISMATCH",
        `Stored MP4 byte size (${stat.size}) does not match reported fileSizeBytes (${params.expectedSizeBytes}).`,
      );
    }

    // Stream file through SHA-256 + verify MP4 ISO BMFF (`ftyp`) header without loading into RAM
    const hasher = createHash("sha256");
    const headerChunks: Buffer[] = [];
    let headerCaptured = 0;

    await new Promise<void>((resolve, reject) => {
      const rs = fsSync.createReadStream(fileReal);
      rs.on("data", (chunk: Buffer | string) => {
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        hasher.update(buf);
        if (headerCaptured < 64) {
          const needed = Math.min(64 - headerCaptured, buf.length);
          headerChunks.push(buf.subarray(0, needed));
          headerCaptured += needed;
        }
      });
      rs.once("end", resolve);
      rs.once("error", reject);
    });

    const headerBuf = Buffer.concat(headerChunks);
    if (!hasValidMp4ContainerSignature(headerBuf)) {
      throw new RenderAssetStreamError(
        422,
        "INVALID_MP4_CONTAINER",
        "Stored output file failed MP4 container header signature validation.",
      );
    }

    const actualSha256 = hasher.digest("hex");
    if (normalizedExpectedSha && actualSha256 !== normalizedExpectedSha) {
      throw new RenderAssetStreamError(
        422,
        "OUTPUT_CHECKSUM_MISMATCH",
        "Stored MP4 SHA-256 checksum does not match expected digest.",
      );
    }

    return {
      exists: true,
      outputStorageKey: keyCheck.normalizedKey,
      provider: "local-private",
      fileSizeBytes: stat.size,
      checksumSha256: actualSha256,
      etag: null,
    };
  }

  // DigitalOcean Spaces authoritative verification
  if (activeProvider !== "spaces") {
    throw new RenderAssetStreamError(
      422,
      "STORAGE_PROVIDER_MISMATCH",
      "Storage provider mismatch: DigitalOcean Spaces render output cannot be verified when STORAGE_PROVIDER is local.",
    );
  }

  const config = getRequiredSpacesConfig();
  const client = createSpacesClient(config);
  const objectKey = keyCheck.normalizedKey;

  type SpacesHeadResult = {
    ContentLength?: number;
    ContentType?: string;
    ETag?: string;
    Metadata?: Record<string, string>;
  };

  let head: SpacesHeadResult;
  try {
    head = (await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
    )) as unknown as SpacesHeadResult;
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (
      e?.name === "NotFound" ||
      e?.name === "NoSuchKey" ||
      e?.Code === "NotFound" ||
      e?.Code === "NoSuchKey" ||
      e?.$metadata?.httpStatusCode === 404
    ) {
      throw new RenderAssetStreamError(
        422,
        "OUTPUT_NOT_FOUND",
        "Rendered MP4 object was not found in private DigitalOcean Spaces storage.",
      );
    }
    throw new RenderAssetStreamError(
      502,
      "STORAGE_READ_FAILED",
      `Failed to verify rendered MP4 in Spaces (${describeStorageError(err)}).`,
    );
  }

  const storedSize = typeof head?.ContentLength === "number" ? head.ContentLength : 0;
  if (!Number.isFinite(storedSize) || storedSize <= 0) {
    throw new RenderAssetStreamError(422, "EMPTY_OUTPUT_FILE", "Rendered MP4 object in Spaces is empty.");
  }
  if (storedSize > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
    throw new RenderAssetStreamError(
      413,
      "OUTPUT_TOO_LARGE",
      `Rendered MP4 object in Spaces (${storedSize} bytes) exceeds maximum allowed size (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
    );
  }
  if (params.expectedSizeBytes != null && storedSize !== params.expectedSizeBytes) {
    throw new RenderAssetStreamError(
      422,
      "OUTPUT_SIZE_MISMATCH",
      `Stored Spaces MP4 byte size (${storedSize}) does not match reported fileSizeBytes (${params.expectedSizeBytes}).`,
    );
  }

  const meta = head?.Metadata ?? {};
  const metaJobId = meta["rebx-job-id"] ?? meta["REBX-JOB-ID"];
  if (metaJobId && metaJobId !== safeJobId) {
    throw new RenderAssetStreamError(422, "OUTPUT_JOB_MISMATCH", "Stored Spaces object metadata belongs to a different render job.");
  }
  const metaProjectId = meta["rebx-project-id"] ?? meta["REBX-PROJECT-ID"];
  if (metaProjectId && metaProjectId !== safeProjectId) {
    throw new RenderAssetStreamError(
      422,
      "OUTPUT_PROJECT_MISMATCH",
      "Stored Spaces object metadata belongs to a different project.",
    );
  }

  const storedSha = (meta["rebx-sha256"] ?? meta["REBX-SHA256"])?.trim().toLowerCase() || null;
  if (normalizedExpectedSha && storedSha && storedSha !== normalizedExpectedSha) {
    throw new RenderAssetStreamError(
      422,
      "OUTPUT_CHECKSUM_MISMATCH",
      "Stored Spaces MP4 SHA-256 metadata does not match expected digest.",
    );
  }

  const rawEtag = typeof head?.ETag === "string" ? head.ETag.replace(/^"+|"+$/g, "").trim() : "";

  return {
    exists: true,
    outputStorageKey: objectKey,
    provider: "spaces",
    fileSizeBytes: storedSize,
    checksumSha256: storedSha ?? normalizedExpectedSha ?? null,
    etag: rawEtag || null,
  };
}

/**
 * Best-effort cleanup of an uncommitted or aborted rendered MP4 in private storage.
 */
export async function deleteStoredRenderVideoBestEffort(params: {
  outputStorageKey: string;
  projectId: string;
  jobId: string;
  provider: "local-private" | "spaces";
}): Promise<void> {
  try {
    const keyCheck = validateWorkerOutputStorageKey({
      outputStorageKey: params.outputStorageKey,
      projectId: params.projectId,
      jobId: params.jobId,
      expectedProvider: params.provider,
    });
    if (!keyCheck.ok) return;

    if (params.provider === "local-private") {
      if (getStorageProvider() !== "local") return;
      const fsPromises = await import("node:fs/promises");
      const resolved = await resolveLocalRenderOutputTarget({
        outputStorageKey: keyCheck.normalizedKey,
        projectId: params.projectId,
        jobId: params.jobId,
      });
      await fsPromises.unlink(resolved.targetFilePath).catch(() => {});
      return;
    }

    if (getStorageProvider() !== "spaces") return;
    const config = getSpacesConfigOptional();
    if (!config) return;
    const client = createSpacesClient(config);
    await client
      .send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: keyCheck.normalizedKey,
        }),
      )
      .catch(() => {});
  } catch {
    // Best-effort cleanup only
  }
}

/**
 * Best-effort cleanup of local project render directory (`storage/video-studio/<projectId>/renders`
 * and its parent `<projectId>` dir if empty) after project deletion.
 */
export async function cleanupLocalProjectRenderDirBestEffort(projectId: string): Promise<void> {
  try {
    if (getStorageProvider() !== "local") return;
    const safeProjectId = assertSafeStorageSegment(projectId, "projectId");
    const fsPromises = await import("node:fs/promises");
    const pathMod = await import("node:path");
    const privateRoot = getPrivateVideoStudioDir(pathMod);
    const projectDir = pathMod.join(privateRoot, safeProjectId);
    const rendersDir = pathMod.join(projectDir, "renders");

    if (!isPathInsideRoot(pathMod.resolve(privateRoot), pathMod.resolve(projectDir), pathMod)) {
      return;
    }

    const entries = await fsPromises.readdir(rendersDir).catch(() => []);
    for (const entry of entries) {
      if (/^render_[a-zA-Z0-9_-]+\.mp4(?:\..+\.part)?$/.test(entry)) {
        await fsPromises.unlink(pathMod.join(rendersDir, entry)).catch(() => {});
      }
    }

    await fsPromises.rmdir(rendersDir).catch(() => {});
    await fsPromises.rmdir(projectDir).catch(() => {});
  } catch {
    // Best-effort cleanup only
  }
}

/**
 * Streams a rendered MP4 upload into the active private storage provider (`local-private` or `spaces`),
 * validating MP4 container signature, byte length, and SHA-256 digest without buffering full videos in RAM.
 */
export async function uploadPrivateRenderVideoStream(params: {
  projectId: string;
  jobId: string;
  expectedProvider: "local-private" | "spaces";
  stream: ReadableStream<Uint8Array>;
  contentLength: number | null;
  expectedSha256?: string | null;
  signal?: AbortSignal;
}): Promise<UploadedRenderVideoResult> {
  const safeProjectId = assertSafeStorageSegment(params.projectId, "projectId");
  const safeJobId = assertSafeStorageSegment(params.jobId, "jobId");
  const activeProvider = getStorageProvider();

  if (params.expectedProvider === "spaces" && activeProvider !== "spaces") {
    throw new RenderAssetStreamError(
      422,
      "STORAGE_PROVIDER_MISMATCH",
      "Storage provider mismatch: render snapshot targets DigitalOcean Spaces but STORAGE_PROVIDER is local.",
    );
  }
  if (params.expectedProvider === "local-private" && activeProvider !== "local") {
    throw new RenderAssetStreamError(
      422,
      "STORAGE_PROVIDER_MISMATCH",
      "Storage provider mismatch: render snapshot targets local-private storage but STORAGE_PROVIDER is Spaces.",
    );
  }

  if (params.contentLength !== null) {
    if (!Number.isInteger(params.contentLength) || params.contentLength <= 0) {
      throw new RenderAssetStreamError(400, "INVALID_CONTENT_LENGTH", "Render MP4 upload must have a positive Content-Length.");
    }
    if (params.contentLength > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
      throw new RenderAssetStreamError(
        413,
        "OUTPUT_TOO_LARGE",
        `Render MP4 upload (${params.contentLength} bytes) exceeds maximum limit (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
      );
    }
  }

  const normalizedExpectedSha = params.expectedSha256?.trim().toLowerCase() || null;
  if (normalizedExpectedSha && !/^[a-f0-9]{64}$/.test(normalizedExpectedSha)) {
    throw new RenderAssetStreamError(400, "INVALID_CHECKSUM_HEADER", "X-REBX-Content-SHA256 must be a valid 64-character hex digest.");
  }

  const canonicalKey = buildRenderOutputTargetKey(safeProjectId, safeJobId);

  // Local private filesystem streaming upload with atomic `.part` commit
  if (activeProvider === "local") {
    const fsPromises = await import("node:fs/promises");
    const fsSync = await import("node:fs");
    const pathMod = await import("node:path");

    const resolved = await resolveLocalRenderOutputTarget({
      outputStorageKey: canonicalKey,
      projectId: safeProjectId,
      jobId: safeJobId,
      ensureDir: true,
    });

    const partPath = pathMod.join(
      resolved.targetDir,
      `${resolved.filename}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.part`,
    );

    const ws = fsSync.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
    let writeErr: Error | null = null;
    ws.on("error", (err) => {
      writeErr = err instanceof Error ? err : new Error("Local storage write stream error.");
    });

    const reader = params.stream.getReader();
    const hasher = createHash("sha256");
    const headerChunks: Buffer[] = [];
    let headerBytes = 0;
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await readStreamChunkWithAbort(reader, params.signal);
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
          throw new RenderAssetStreamError(
            413,
            "OUTPUT_TOO_LARGE",
            `Render MP4 upload exceeded maximum allowed size (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
          );
        }

        hasher.update(value);
        if (headerBytes < 64) {
          const needed = Math.min(64 - headerBytes, value.byteLength);
          headerChunks.push(Buffer.from(value.buffer, value.byteOffset, needed));
          headerBytes += needed;
        }

        if (writeErr) throw writeErr;
        await writeNodeStreamChunk(ws, value);
      }

      if (writeErr) throw writeErr;
      await finishNodeWriteStream(ws);

      if (totalBytes <= 0) {
        throw new RenderAssetStreamError(422, "EMPTY_UPLOAD", "Uploaded MP4 stream was empty (0 bytes).");
      }
      if (params.contentLength !== null && totalBytes !== params.contentLength) {
        throw new RenderAssetStreamError(
          422,
          "INCOMPLETE_UPLOAD",
          `Uploaded MP4 stream was interrupted (${totalBytes} of ${params.contentLength} bytes received).`,
        );
      }

      const headerBuf = Buffer.concat(headerChunks);
      if (!hasValidMp4ContainerSignature(headerBuf)) {
        throw new RenderAssetStreamError(
          422,
          "INVALID_MP4_CONTAINER",
          "Uploaded file failed MP4 container header validation.",
        );
      }

      const actualSha256 = hasher.digest("hex");
      if (normalizedExpectedSha && actualSha256 !== normalizedExpectedSha) {
        throw new RenderAssetStreamError(
          422,
          "CHECKSUM_MISMATCH",
          "Uploaded MP4 SHA-256 digest did not match X-REBX-Content-SHA256.",
        );
      }

      await fsPromises.rename(partPath, resolved.targetFilePath);

      const verified = await verifyStoredRenderVideoObject({
        outputStorageKey: canonicalKey,
        projectId: safeProjectId,
        jobId: safeJobId,
        expectedProvider: "local-private",
        expectedSizeBytes: totalBytes,
        expectedSha256: actualSha256,
      });

      return {
        outputStorageKey: canonicalKey,
        provider: "local-private",
        fileSizeBytes: verified.fileSizeBytes,
        checksumSha256: actualSha256,
        etag: null,
      };
    } catch (err) {
      await reader.cancel().catch(() => {});
      await destroyNodeWriteStreamSafe(ws);
      try {
        await fsPromises.unlink(partPath);
      } catch {
        // Retry once after a brief yield in case Windows delayed releasing the closed descriptor
        await new Promise((resolve) => setTimeout(resolve, 40));
        await fsPromises.unlink(partPath).catch(() => {});
      }
      if (err instanceof RenderAssetStreamError) throw err;
      throw new RenderAssetStreamError(
        500,
        "STORAGE_UPLOAD_FAILED",
        "Failed to store rendered MP4 in private local storage.",
      );
    }
  }

  // DigitalOcean Spaces private streaming upload (`ACL: "private"`, never `public-read`)
  const config = getRequiredSpacesConfig();
  const client = createSpacesClient(config);
  const reader = params.stream.getReader();
  const hasher = createHash("sha256");
  const headerChunks: Buffer[] = [];
  let headerBytes = 0;
  let totalBytes = 0;

  // When Content-Length is known, stream end-to-end via PassThrough without loading full MP4 into RAM
  if (params.contentLength !== null) {
    const passThrough = new PassThrough();
    let putSettled = false;

    const putPromise = client
      .send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: canonicalKey,
          Body: passThrough,
          ContentLength: params.contentLength,
          ContentType: "video/mp4",
          ACL: "private",
          CacheControl: "private, no-store",
          Metadata: {
            "rebx-project-id": safeProjectId,
            "rebx-job-id": safeJobId,
            ...(normalizedExpectedSha ? { "rebx-sha256": normalizedExpectedSha } : {}),
          },
        }),
        params.signal ? { abortSignal: params.signal } : undefined,
      )
      .finally(() => {
        putSettled = true;
        passThrough.resume();
      });

    try {
      while (true) {
        const { done, value } = await readStreamChunkWithAbort(reader, params.signal);
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        totalBytes += value.byteLength;
        if (totalBytes > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
          throw new RenderAssetStreamError(
            413,
            "OUTPUT_TOO_LARGE",
            `Render MP4 upload exceeded maximum allowed size (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
          );
        }

        hasher.update(value);
        if (headerBytes < 64) {
          const needed = Math.min(64 - headerBytes, value.byteLength);
          headerChunks.push(Buffer.from(value.buffer, value.byteOffset, needed));
          headerBytes += needed;
        }

        if (!passThrough.destroyed) {
          const canContinue = passThrough.write(value);
          if (!canContinue && !putSettled) {
            await new Promise<void>((resolve) => {
              const onReady = () => {
                passThrough.off("drain", onReady);
                passThrough.off("close", onReady);
                passThrough.off("error", onReady);
                resolve();
              };
              passThrough.once("drain", onReady);
              passThrough.once("close", onReady);
              passThrough.once("error", onReady);
            });
          }
        }
      }

      if (totalBytes !== params.contentLength) {
        const incompleteErr = new RenderAssetStreamError(
          422,
          "INCOMPLETE_UPLOAD",
          `Uploaded MP4 stream was interrupted (${totalBytes} of ${params.contentLength} bytes received).`,
        );
        passThrough.destroy(incompleteErr);
        await putPromise.catch(() => {});
        await deleteStoredRenderVideoBestEffort({
          outputStorageKey: canonicalKey,
          projectId: safeProjectId,
          jobId: safeJobId,
          provider: "spaces",
        });
        throw incompleteErr;
      }

      passThrough.end();
      const putRes = (await putPromise) as unknown as { ETag?: string };

      const headerBuf = Buffer.concat(headerChunks);
      if (!hasValidMp4ContainerSignature(headerBuf)) {
        await deleteStoredRenderVideoBestEffort({
          outputStorageKey: canonicalKey,
          projectId: safeProjectId,
          jobId: safeJobId,
          provider: "spaces",
        });
        throw new RenderAssetStreamError(
          422,
          "INVALID_MP4_CONTAINER",
          "Uploaded file failed MP4 container header validation.",
        );
      }

      const actualSha256 = hasher.digest("hex");
      if (normalizedExpectedSha && actualSha256 !== normalizedExpectedSha) {
        await deleteStoredRenderVideoBestEffort({
          outputStorageKey: canonicalKey,
          projectId: safeProjectId,
          jobId: safeJobId,
          provider: "spaces",
        });
        throw new RenderAssetStreamError(
          422,
          "CHECKSUM_MISMATCH",
          "Uploaded MP4 SHA-256 digest did not match X-REBX-Content-SHA256.",
        );
      }

      const verified = await verifyStoredRenderVideoObject({
        outputStorageKey: canonicalKey,
        projectId: safeProjectId,
        jobId: safeJobId,
        expectedProvider: "spaces",
        expectedSizeBytes: totalBytes,
        expectedSha256: normalizedExpectedSha ?? actualSha256,
      });

      const cleanEtag =
        verified.etag ??
        (typeof putRes?.ETag === "string" ? putRes.ETag.replace(/^"+|"+$/g, "").trim() || null : null);

      return {
        outputStorageKey: canonicalKey,
        provider: "spaces",
        fileSizeBytes: verified.fileSizeBytes,
        checksumSha256: actualSha256,
        etag: cleanEtag,
      };
    } catch (err) {
      await reader.cancel().catch(() => {});
      if (!passThrough.destroyed) {
        passThrough.destroy(err instanceof Error ? err : new Error("Upload aborted"));
      }
      await putPromise.catch(() => {});
      await deleteStoredRenderVideoBestEffort({
        outputStorageKey: canonicalKey,
        projectId: safeProjectId,
        jobId: safeJobId,
        provider: "spaces",
      });
      if (err instanceof RenderAssetStreamError) throw err;
      throw new RenderAssetStreamError(
        502,
        "STORAGE_UPLOAD_FAILED",
        `DigitalOcean Spaces upload failed (${describeStorageError(err)}).`,
      );
    }
  }

  // Fallback when Content-Length header was omitted (bounded collection up to MAX_RENDER_OUTPUT_VIDEO_BYTES)
  const chunks: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await readStreamChunkWithAbort(reader, params.signal);
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
        throw new RenderAssetStreamError(
          413,
          "OUTPUT_TOO_LARGE",
          `Render MP4 upload exceeded maximum allowed size (${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes).`,
        );
      }
      const buf = Buffer.from(value);
      hasher.update(buf);
      chunks.push(buf);
      if (headerBytes < 64) {
        const needed = Math.min(64 - headerBytes, buf.length);
        headerChunks.push(buf.subarray(0, needed));
        headerBytes += needed;
      }
    }

    if (totalBytes <= 0) {
      throw new RenderAssetStreamError(422, "EMPTY_UPLOAD", "Uploaded MP4 stream was empty (0 bytes).");
    }

    const headerBuf = Buffer.concat(headerChunks);
    if (!hasValidMp4ContainerSignature(headerBuf)) {
      throw new RenderAssetStreamError(
        422,
        "INVALID_MP4_CONTAINER",
        "Uploaded file failed MP4 container header validation.",
      );
    }

    const actualSha256 = hasher.digest("hex");
    if (normalizedExpectedSha && actualSha256 !== normalizedExpectedSha) {
      throw new RenderAssetStreamError(
        422,
        "CHECKSUM_MISMATCH",
        "Uploaded MP4 SHA-256 digest did not match X-REBX-Content-SHA256.",
      );
    }

    const bodyBuffer = Buffer.concat(chunks, totalBytes);
    const putRes = (await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: canonicalKey,
        Body: bodyBuffer,
        ContentLength: totalBytes,
        ContentType: "video/mp4",
        ACL: "private",
        CacheControl: "private, no-store",
        Metadata: {
          "rebx-project-id": safeProjectId,
          "rebx-job-id": safeJobId,
          "rebx-sha256": actualSha256,
        },
      }),
      params.signal ? { abortSignal: params.signal } : undefined,
    )) as unknown as { ETag?: string };

    const verified = await verifyStoredRenderVideoObject({
      outputStorageKey: canonicalKey,
      projectId: safeProjectId,
      jobId: safeJobId,
      expectedProvider: "spaces",
      expectedSizeBytes: totalBytes,
      expectedSha256: actualSha256,
    });

    const cleanEtag =
      verified.etag ??
      (typeof putRes?.ETag === "string" ? putRes.ETag.replace(/^"+|"+$/g, "").trim() || null : null);

    return {
      outputStorageKey: canonicalKey,
      provider: "spaces",
      fileSizeBytes: verified.fileSizeBytes,
      checksumSha256: actualSha256,
      etag: cleanEtag,
    };
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (err instanceof RenderAssetStreamError) throw err;
    throw new RenderAssetStreamError(
      502,
      "STORAGE_UPLOAD_FAILED",
      `DigitalOcean Spaces upload failed (${describeStorageError(err)}).`,
    );
  }
}

export function parseHttpByteRange(
  rangeHeader: string | null,
  totalSize: number,
):
  | { ok: true; isPartial: false; start: 0; end: number; totalSize: number }
  | { ok: true; isPartial: true; start: number; end: number; totalSize: number }
  | { ok: false; totalSize: number } {
  if (!rangeHeader || !rangeHeader.trim()) {
    return { ok: true, isPartial: false, start: 0, end: Math.max(0, totalSize - 1), totalSize };
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return { ok: false, totalSize };
  }

  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) {
    return { ok: false, totalSize };
  }

  let start: number;
  let end: number;

  if (!startRaw && endRaw) {
    const suffixLen = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
      return { ok: false, totalSize };
    }
    start = Math.max(0, totalSize - suffixLen);
    end = totalSize - 1;
  } else {
    start = Number.parseInt(startRaw, 10);
    end = endRaw ? Number.parseInt(endRaw, 10) : totalSize - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= totalSize
    ) {
      return { ok: false, totalSize };
    }
    end = Math.min(end, totalSize - 1);
  }

  return { ok: true, isPartial: true, start, end, totalSize };
}

/**
 * Opens an authenticated admin playback / download stream for a completed render MP4
 * with HTTP `Range` support (`200` / `206` / `416`) across `local` and `spaces` providers.
 */
export async function openAdminRenderVideoStream(params: {
  outputStorageKey: string;
  projectId: string;
  jobId: string;
  rangeHeader: string | null;
  signal?: AbortSignal;
}): Promise<OpenedAdminRenderVideoStream> {
  const safeProjectId = assertSafeStorageSegment(params.projectId, "projectId");
  const safeJobId = assertSafeStorageSegment(params.jobId, "jobId");
  const activeProvider = getStorageProvider();

  const keyCheck = validateWorkerOutputStorageKey({
    outputStorageKey: params.outputStorageKey,
    projectId: safeProjectId,
    jobId: safeJobId,
    expectedProvider: activeProvider === "spaces" ? "spaces" : "local-private",
  });
  if (!keyCheck.ok) {
    throw new RenderAssetStreamError(404, "INVALID_OUTPUT_KEY", "Rendered video output key is invalid.");
  }

  if (activeProvider === "local") {
    const fsPromises = await import("node:fs/promises");
    const fsSync = await import("node:fs");
    const pathMod = await import("node:path");
    const privateRoot = getPrivateVideoStudioDir(pathMod);

    const resolved = await resolveLocalRenderOutputTarget({
      outputStorageKey: keyCheck.normalizedKey,
      projectId: safeProjectId,
      jobId: safeJobId,
    });

    let stat: import("node:fs").Stats;
    try {
      stat = await fsPromises.lstat(resolved.targetFilePath);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 file no longer exists in storage.");
      }
      throw new RenderAssetStreamError(500, "STORAGE_READ_FAILED", "Failed to read rendered MP4 metadata.");
    }

    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 path is not a regular file.");
    }

    let rootReal: string;
    let fileReal: string;
    try {
      rootReal = await fsPromises.realpath(privateRoot);
      fileReal = await fsPromises.realpath(resolved.targetFilePath);
    } catch {
      throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 file could not be resolved.");
    }
    if (!isPathInsideRoot(rootReal, fileReal, pathMod)) {
      throw new RenderAssetStreamError(403, "INVALID_ASSET_PATH", "Rendered MP4 path escaped private storage.");
    }

    if (stat.size <= 0) {
      throw new RenderAssetStreamError(404, "EMPTY_OUTPUT_FILE", "Rendered MP4 file is empty.");
    }

    const parsedRange = parseHttpByteRange(params.rangeHeader, stat.size);
    if (!parsedRange.ok) {
      const rangeErr = new RenderAssetStreamError(416, "RANGE_NOT_SATISFIABLE", "Requested byte range is not satisfiable.");
      (rangeErr as RenderAssetStreamError & { totalSize?: number }).totalSize = stat.size;
      throw rangeErr;
    }

    const nodeStream = parsedRange.isPartial
      ? fsSync.createReadStream(fileReal, { start: parsedRange.start, end: parsedRange.end })
      : fsSync.createReadStream(fileReal);

    const contentLength = parsedRange.end - parsedRange.start + 1;
    return {
      stream: nodeReadableToWebStream(nodeStream, params.signal),
      status: parsedRange.isPartial ? 206 : 200,
      contentType: "video/mp4",
      contentLength,
      totalSize: stat.size,
      contentRange: parsedRange.isPartial
        ? `bytes ${parsedRange.start}-${parsedRange.end}/${stat.size}`
        : null,
    };
  }

  // DigitalOcean Spaces streaming playback with Range support
  const config = getRequiredSpacesConfig();
  const client = createSpacesClient(config);
  const objectKey = keyCheck.normalizedKey;

  type SpacesHeadResult = { ContentLength?: number };
  let head: SpacesHeadResult;
  try {
    head = (await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
      params.signal ? { abortSignal: params.signal } : undefined,
    )) as unknown as SpacesHeadResult;
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (
      e?.name === "NotFound" ||
      e?.name === "NoSuchKey" ||
      e?.Code === "NotFound" ||
      e?.Code === "NoSuchKey" ||
      e?.$metadata?.httpStatusCode === 404
    ) {
      throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 object was not found in private storage.");
    }
    throw new RenderAssetStreamError(
      502,
      "STORAGE_READ_FAILED",
      `Failed to read rendered MP4 metadata (${describeStorageError(err)}).`,
    );
  }

  const totalSize = typeof head?.ContentLength === "number" ? head.ContentLength : 0;
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 object is empty or missing.");
  }

  const parsedRange = parseHttpByteRange(params.rangeHeader, totalSize);
  if (!parsedRange.ok) {
    const rangeErr = new RenderAssetStreamError(416, "RANGE_NOT_SATISFIABLE", "Requested byte range is not satisfiable.");
    (rangeErr as RenderAssetStreamError & { totalSize?: number }).totalSize = totalSize;
    throw rangeErr;
  }

  type SpacesGetResult = { Body?: unknown; ContentLength?: number };
  let res: SpacesGetResult;
  try {
    res = (await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        ...(parsedRange.isPartial ? { Range: `bytes=${parsedRange.start}-${parsedRange.end}` } : {}),
      }),
      params.signal ? { abortSignal: params.signal } : undefined,
    )) as unknown as SpacesGetResult;
  } catch (err) {
    const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === "AbortError") {
      throw new RenderAssetStreamError(499, "REQUEST_ABORTED", "Video stream aborted by client.");
    }
    if (
      e?.name === "NotFound" ||
      e?.name === "NoSuchKey" ||
      e?.Code === "NoSuchKey" ||
      e?.$metadata?.httpStatusCode === 404
    ) {
      throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 object was not found in private storage.");
    }
    throw new RenderAssetStreamError(
      502,
      "STORAGE_READ_FAILED",
      `Failed to stream rendered MP4 (${describeStorageError(err)}).`,
    );
  }

  if (!res?.Body) {
    throw new RenderAssetStreamError(404, "OUTPUT_NOT_FOUND", "Rendered MP4 response body is missing.");
  }

  const contentLength = parsedRange.end - parsedRange.start + 1;
  return {
    stream: s3BodyToWebStream(res.Body, params.signal),
    status: parsedRange.isPartial ? 206 : 200,
    contentType: "video/mp4",
    contentLength,
    totalSize,
    contentRange: parsedRange.isPartial
      ? `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`
      : null,
  };
}
