import {
  ASPECT_RATIO_CONFIG,
  DEFAULT_WATERMARK_CONFIG,
  type AspectRatio,
  type ContentCategory,
  type EditorScene,
  type Language,
  type ProjectStatus,
  type SceneCameraMotion,
  type Tone,
  type VersionedProjectJson,
  type WatermarkConfig,
} from "./schemas";

export const WORDS_PER_SECOND = 2.5;
export const ADMIN_SCENE_IMAGE_ROUTE_PREFIX = "/api/admin/video-studio/image/";
export const LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX = "/uploads/video-studio/";

export function buildAdminSceneImagePreviewUrl(filename: string): string {
  return `${ADMIN_SCENE_IMAGE_ROUTE_PREFIX}${filename}`;
}

export function newTempId() {
  return `scene_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function estimateDurationSec(narration: string): number {
  const words = countWords(narration);
  return Math.min(60, Math.max(2, Math.round(words / WORDS_PER_SECOND)));
}

export function totalDuration(scenes: { duration: number }[]): number {
  return scenes.reduce((sum, s) => sum + (s.duration || 0), 0);
}

/**
 * Deterministic, isomorphic text fingerprint so client & server can detect whether
 * scene narration was edited after voiceover generation without storing plaintext twice.
 */
export function hashNarrationText(text: string): string {
  const normalized = text.trim();
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `v1_${normalized.length}_${(h1 >>> 0).toString(16)}_${(h2 >>> 0).toString(16)}`;
}

export function buildSceneAudioPlaybackUrl(projectId: string, sceneId: string, revision?: string): string {
  const params = new URLSearchParams({
    projectId,
    sceneId,
  });
  if (revision) {
    params.set("v", revision);
  }
  return `/api/admin/video-studio/audio?${params.toString()}`;
}

/**
 * Builds the canonical, versioned JSON representation of the project (Section 6 requirement).
 */
export function buildVersionedProjectJson(params: {
  projectId: string;
  title: string;
  category: ContentCategory;
  status: ProjectStatus;
  aspectRatio: AspectRatio;
  desiredDuration: number;
  targetAudience?: string;
  language: Language;
  tone: Tone;
  topic?: string;
  defaultCameraMotion?: SceneCameraMotion;
  watermark?: WatermarkConfig;
  scenes: EditorScene[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): VersionedProjectJson {
  const config = ASPECT_RATIO_CONFIG[params.aspectRatio] ?? ASPECT_RATIO_CONFIG["16:9"];
  const totalSec = totalDuration(params.scenes);

  return {
    schemaVersion: "1.0.0",
    projectId: params.projectId,
    title: params.title,
    category: params.category,
    status: params.status,
    videoSettings: {
      aspectRatio: params.aspectRatio,
      dimensions: config.dimensions,
      width: config.width,
      height: config.height,
      desiredDuration: params.desiredDuration,
      totalCalculatedDuration: totalSec,
      ...(params.defaultCameraMotion ? { defaultCameraMotion: params.defaultCameraMotion } : {}),
      watermark: params.watermark ?? DEFAULT_WATERMARK_CONFIG,
    },
    targetAudience: params.targetAudience ?? "",
    language: params.language,
    tone: params.tone,
    topic: params.topic ?? "",
    scenes: params.scenes.map((s, idx) => ({
      id: s.id,
      order: idx + 1,
      title: s.title,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      imageUrl: s.imageUrl,
      duration: s.duration,
      locked: s.locked,
      ...(s.audio ? { audio: s.audio } : {}),
      ...(s.cameraMotion ? { cameraMotion: s.cameraMotion } : {}),
    })),
    createdAt: (params.createdAt ? new Date(params.createdAt) : new Date()).toISOString(),
    updatedAt: (params.updatedAt ? new Date(params.updatedAt) : new Date()).toISOString(),
  };
}

export type SceneWarning = {
  level: "error" | "warn";
  message: string;
  sceneId?: string;
};

export function getProjectWarnings(scenes: EditorScene[], aspectRatio: AspectRatio): SceneWarning[] {
  const warnings: SceneWarning[] = [];

  scenes.forEach((s, idx) => {
    const num = idx + 1;
    if (!s.title.trim()) {
      warnings.push({ level: "error", message: `Scene ${num} is missing a title.`, sceneId: s.id });
    }
    if (!s.narration.trim()) {
      warnings.push({ level: "warn", message: `Scene ${num} has no narration text.`, sceneId: s.id });
    }
    if (!s.imageUrl) {
      warnings.push({ level: "warn", message: `Scene ${num} has no image uploaded yet.`, sceneId: s.id });
    }
    if (!s.imagePrompt.trim()) {
      warnings.push({ level: "warn", message: `Scene ${num} has no image generation prompt.`, sceneId: s.id });
    }
    const hasFreshReadyAudio =
      s.audio?.status === "ready" &&
      typeof s.audio.durationSec === "number" &&
      s.audio.durationSec > 0 &&
      (!s.audio.narrationHash || s.audio.narrationHash === hashNarrationText(s.narration));

    if (hasFreshReadyAudio && s.audio) {
      if (s.audio.durationSec > s.duration + 1) {
        warnings.push({
          level: "warn",
          message: `Scene ${num}: voiceover (${s.audio.durationSec.toFixed(1)}s) is longer than scene duration (${s.duration}s).`,
          sceneId: s.id,
        });
      }
    } else {
      const neededSec = estimateDurationSec(s.narration);
      if (s.narration.trim() && neededSec > s.duration + 2) {
        warnings.push({
          level: "warn",
          message: `Scene ${num}: narration (~${neededSec}s spoken) may exceed scene duration (${s.duration}s).`,
          sceneId: s.id,
        });
      }
    }
  });

  const total = totalDuration(scenes);
  if (aspectRatio === "9:16" && total > 60) {
    warnings.push({
      level: "warn",
      message: `Total duration is ${total}s. Instagram Reels & Shorts typically perform best under 60s.`,
    });
  }

  return warnings;
}

/**
 * Extracts and parses JSON from raw text / clipboard / export.
 */
export function extractAndParseJson(text: string): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const stripped = text.replace(/```(?:json)?/gi, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    const jsonStr = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Parsed JSON is not an object." };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON format. Please ensure valid syntax." };
  }
}

