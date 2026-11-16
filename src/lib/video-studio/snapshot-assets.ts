import { createHash } from "node:crypto";
import path from "node:path";
import type {
  RenderJobSnapshot,
  RenderSnapshotAudioAsset,
  RenderSnapshotImageAsset,
} from "@/lib/video-studio/schemas";

export const MAX_RENDER_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_RENDER_AUDIO_BYTES = 15 * 1024 * 1024; // 15 MB

export const SNAPSHOT_ASSET_ID_REGEX = /^(img|aud)_[a-f0-9]{24}$/;

export type SupportedRenderImageFormat = "jpg" | "png" | "webp";
export type SupportedRenderAudioFormat = "mp3" | "wav" | "ogg" | "webm";
export type SupportedRenderAssetFormat = SupportedRenderImageFormat | SupportedRenderAudioFormat;

export type AuthorizedSnapshotAsset =
  | {
      assetId: string;
      kind: "image";
      provider: "local" | "spaces";
      resolvedRef: string;
      sourceUrl: string;
      format: SupportedRenderImageFormat;
      mimeType: string;
      maxBytes: number;
      safeFilename: string;
      sceneIds: string[];
      sceneOrders: number[];
    }
  | {
      assetId: string;
      kind: "audio";
      provider: "local-private" | "spaces";
      resolvedRef: string;
      storageKey: string;
      format: SupportedRenderAudioFormat;
      mimeType: string;
      maxBytes: number;
      safeFilename: string;
      sceneIds: string[];
      sceneOrders: number[];
    };

export type SceneSnapshotAssetBinding = {
  sceneId: string;
  order: number;
  imageAssetId: string;
  audioAssetId: string;
};

export function isValidSnapshotAssetId(assetId: string): boolean {
  return SNAPSHOT_ASSET_ID_REGEX.test(assetId);
}

export function isSafeAssetRefString(raw: string): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (/[\0\r\n\\]/.test(value)) return false;
  if (value.includes("..")) return false;
  if (/^(blob|data):/i.test(value)) return false;
  return true;
}

export function inferImageFormatFromRef(
  ref: string,
): { format: SupportedRenderImageFormat; mimeType: string } | null {
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

export function getAudioMimeTypeForFormat(format: SupportedRenderAudioFormat): string {
  switch (format) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "webm":
      return "audio/webm";
  }
}

export function isCompatibleAudioMimeType(
  mimeType: string,
  format: SupportedRenderAudioFormat,
): boolean {
  const clean = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (format) {
    case "mp3":
      return clean === "audio/mpeg" || clean === "audio/mp3";
    case "wav":
      return (
        clean === "audio/wav" ||
        clean === "audio/x-wav" ||
        clean === "audio/wave" ||
        clean === "audio/vnd.wave"
      );
    case "ogg":
      return clean === "audio/ogg" || clean === "application/ogg";
    case "webm":
      return clean === "audio/webm";
  }
}

export function isValidAudioExtensionForFormat(
  ref: string,
  format: SupportedRenderAudioFormat,
): boolean {
  const clean = ref.trim().split("?")[0].split("#")[0];
  const ext = path.posix.extname(clean).toLowerCase();
  return ext === `.${format}`;
}

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
  const filename = path.posix.basename(rawName);
  if (!filename || rawName !== filename || filename === "." || filename === "..") {
    return null;
  }
  return filename;
}

export function normalizeCanonicalSnapshotImageRef(image: RenderSnapshotImageAsset): {
  ok: true;
  canonicalRef: string;
  format: SupportedRenderImageFormat;
  mimeType: string;
} | { ok: false; error: string } {
  const resolved = image.resolvedPathOrKey.trim();
  const sourceUrl = image.sourceUrl.trim();
  if (!isSafeAssetRefString(resolved) || !isSafeAssetRefString(sourceUrl)) {
    return { ok: false, error: "Snapshot scene image reference contains unsafe path characters." };
  }

  if (image.provider === "local") {
    if (/^https?:\/\//i.test(resolved) || /^https?:\/\//i.test(sourceUrl)) {
      return { ok: false, error: "Local snapshot image cannot reference an external URL." };
    }
    const resolvedFilename = extractLocalImageFilenameFromRef(resolved);
    if (!resolvedFilename) {
      return { ok: false, error: "Local snapshot image path must belong to video-studio storage." };
    }
    const sourceFilename = extractLocalImageFilenameFromRef(sourceUrl);
    if (!sourceFilename || sourceFilename !== resolvedFilename) {
      return { ok: false, error: "Local snapshot image sourceUrl does not match resolvedPathOrKey." };
    }
  } else {
    if (
      /^https?:\/\//i.test(resolved) ||
      resolved.startsWith("/") ||
      resolved.startsWith("local-private:") ||
      resolved.startsWith("local-private-image:")
    ) {
      return { ok: false, error: "Spaces snapshot image resolvedPathOrKey must be a clean relative object key." };
    }
  }

  const inferred = inferImageFormatFromRef(resolved);
  if (!inferred) {
    return { ok: false, error: "Snapshot scene image must have a supported JPG, PNG, or WebP extension." };
  }

  return {
    ok: true,
    canonicalRef: resolved,
    format: inferred.format,
    mimeType: inferred.mimeType,
  };
}

export function normalizeCanonicalSnapshotAudioRef(audio: RenderSnapshotAudioAsset): {
  ok: true;
  canonicalRef: string;
  format: SupportedRenderAudioFormat;
  mimeType: string;
} | { ok: false; error: string } {
  const resolved = audio.resolvedKey.trim();
  const storageKey = audio.storageKey.trim();
  if (!isSafeAssetRefString(resolved) || !isSafeAssetRefString(storageKey)) {
    return { ok: false, error: "Snapshot scene audio reference contains unsafe path characters." };
  }

  if (audio.provider === "local-private") {
    if (/^https?:\/\//i.test(resolved) || /^https?:\/\//i.test(storageKey)) {
      return { ok: false, error: "Local private snapshot audio cannot reference an external URL." };
    }
    if (!resolved.startsWith("local-private:")) {
      return { ok: false, error: "Local private snapshot audio key must start with local-private:." };
    }
    const rawName = resolved.slice("local-private:".length);
    const filename = path.posix.basename(rawName);
    if (!filename || rawName !== filename) {
      return { ok: false, error: "Local private snapshot audio key must resolve to a single filename." };
    }
    if (storageKey !== resolved) {
      return { ok: false, error: "Local private snapshot audio storageKey does not match resolvedKey." };
    }
  } else {
    if (/^https?:\/\//i.test(resolved) || resolved.startsWith("/") || resolved.startsWith("local-private:")) {
      return { ok: false, error: "Spaces snapshot audio resolvedKey must be a clean relative object key." };
    }
  }

  if (!isValidAudioExtensionForFormat(resolved, audio.format)) {
    return { ok: false, error: `Snapshot scene audio key extension does not match format "${audio.format}".` };
  }

  if (!isCompatibleAudioMimeType(audio.mimeType, audio.format)) {
    return { ok: false, error: `Snapshot scene audio MIME type "${audio.mimeType}" is invalid for format "${audio.format}".` };
  }

  return {
    ok: true,
    canonicalRef: resolved,
    format: audio.format,
    mimeType: getAudioMimeTypeForFormat(audio.format),
  };
}

export function deriveSnapshotAssetId(
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

export function extractAuthorizedSnapshotAssetManifest(snapshot: RenderJobSnapshot):
  | {
      ok: true;
      assetsById: Map<string, AuthorizedSnapshotAsset>;
      orderedAssets: AuthorizedSnapshotAsset[];
      sceneBindings: SceneSnapshotAssetBinding[];
    }
  | { ok: false; code: string; error: string } {
  const assetsById = new Map<string, AuthorizedSnapshotAsset>();
  const orderedAssets: AuthorizedSnapshotAsset[] = [];
  const sceneBindings: SceneSnapshotAssetBinding[] = [];

  for (const scene of snapshot.scenes) {
    const imgCheck = normalizeCanonicalSnapshotImageRef(scene.image);
    if (!imgCheck.ok) {
      return {
        ok: false,
        code: "INVALID_SNAPSHOT_ASSET",
        error: `Scene ${scene.order} (${scene.sceneId}): ${imgCheck.error}`,
      };
    }

    const audioCheck = normalizeCanonicalSnapshotAudioRef(scene.audio);
    if (!audioCheck.ok) {
      return {
        ok: false,
        code: "INVALID_SNAPSHOT_ASSET",
        error: `Scene ${scene.order} (${scene.sceneId}): ${audioCheck.error}`,
      };
    }

    const imageAssetId = deriveSnapshotAssetId({
      kind: "image",
      provider: scene.image.provider,
      canonicalRef: imgCheck.canonicalRef,
    });

    const existingImg = assetsById.get(imageAssetId);
    if (existingImg && existingImg.kind === "image") {
      existingImg.sceneIds.push(scene.sceneId);
      existingImg.sceneOrders.push(scene.order);
    } else {
      const imgEntry: AuthorizedSnapshotAsset = {
        assetId: imageAssetId,
        kind: "image",
        provider: scene.image.provider,
        resolvedRef: imgCheck.canonicalRef,
        sourceUrl: scene.image.sourceUrl.trim(),
        format: imgCheck.format,
        mimeType: imgCheck.mimeType,
        maxBytes: MAX_RENDER_IMAGE_BYTES,
        safeFilename: `${imageAssetId}.${imgCheck.format}`,
        sceneIds: [scene.sceneId],
        sceneOrders: [scene.order],
      };
      assetsById.set(imageAssetId, imgEntry);
      orderedAssets.push(imgEntry);
    }

    const audioAssetId = deriveSnapshotAssetId({
      kind: "audio",
      provider: scene.audio.provider,
      canonicalRef: audioCheck.canonicalRef,
    });

    const existingAudio = assetsById.get(audioAssetId);
    if (existingAudio && existingAudio.kind === "audio") {
      existingAudio.sceneIds.push(scene.sceneId);
      existingAudio.sceneOrders.push(scene.order);
    } else {
      const audioEntry: AuthorizedSnapshotAsset = {
        assetId: audioAssetId,
        kind: "audio",
        provider: scene.audio.provider,
        resolvedRef: audioCheck.canonicalRef,
        storageKey: scene.audio.storageKey.trim(),
        format: audioCheck.format,
        mimeType: audioCheck.mimeType,
        maxBytes: MAX_RENDER_AUDIO_BYTES,
        safeFilename: `${audioAssetId}.${audioCheck.format}`,
        sceneIds: [scene.sceneId],
        sceneOrders: [scene.order],
      };
      assetsById.set(audioAssetId, audioEntry);
      orderedAssets.push(audioEntry);
    }

    sceneBindings.push({
      sceneId: scene.sceneId,
      order: scene.order,
      imageAssetId,
      audioAssetId,
    });
  }

  return {
    ok: true,
    assetsById,
    orderedAssets,
    sceneBindings,
  };
}

