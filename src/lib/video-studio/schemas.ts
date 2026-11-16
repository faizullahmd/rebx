import { z } from "zod";

/* ---------- Aspect Ratios & Dimensions ---------- */

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_RATIO_CONFIG: Record<
  AspectRatio,
  { label: string; dimensions: string; width: number; height: number; description: string }
> = {
  "16:9": {
    label: "16:9 – YouTube landscape",
    dimensions: "1920 × 1080",
    width: 1920,
    height: 1080,
    description: "Best for YouTube videos and widescreen presentations.",
  },
  "9:16": {
    label: "9:16 – Instagram Reels, YouTube Shorts and TikTok",
    dimensions: "1080 × 1920",
    width: 1080,
    height: 1920,
    description: "Vertical format optimized for mobile phone viewing.",
  },
  "1:1": {
    label: "1:1 – Instagram feed",
    dimensions: "1080 × 1080",
    width: 1080,
    height: 1080,
    description: "Square format ideal for carousel and feed posts.",
  },
};

/* ---------- Content Categories ---------- */

export const CONTENT_CATEGORIES = [
  "property_showcase",
  "market_update",
  "buyer_tips",
  "seller_tips",
  "area_guide",
  "explainer",
  "announcement",
] as const;

export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const CONTENT_CATEGORY_LABELS: Record<ContentCategory, string> = {
  property_showcase: "Property showcase",
  market_update: "Market update",
  buyer_tips: "Buyer tips",
  seller_tips: "Seller / owner tips",
  area_guide: "Area guide",
  explainer: "Explainer",
  announcement: "Announcement",
};

/* ---------- Languages & Tones ---------- */

export const LANGUAGES = [
  "English",
  "Hindi",
  "Telugu",
  "Tamil",
  "Kannada",
  "Marathi",
] as const;

export type Language = (typeof LANGUAGES)[number];

export const TONES = [
  "Professional",
  "Friendly",
  "Energetic",
  "Luxury",
  "Informative",
] as const;

export type Tone = (typeof TONES)[number];

/* ---------- Sarvam AI Text-to-Speech Configuration (Phase 3 Part B) ---------- */

export const SARVAM_TTS_MODEL = "bulbul:v3" as const;
export const SARVAM_SUPPORTED_MODELS = [SARVAM_TTS_MODEL] as const;
export type SarvamTtsModel = (typeof SARVAM_SUPPORTED_MODELS)[number];

export const SARVAM_MAX_NARRATION_CHARS = 2500;
export const SARVAM_AUDIO_FORMATS = ["mp3", "wav"] as const;
export type SarvamAudioFormat = (typeof SARVAM_AUDIO_FORMATS)[number];

export const SARVAM_SAMPLE_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000] as const;
export type SarvamSampleRate = (typeof SARVAM_SAMPLE_RATES)[number];

/**
 * Official BCP-47 language codes supported by Sarvam AI bulbul:v3.
 * Maps all 6 REBX project languages plus the remaining Sarvam Indian languages.
 */
export const SARVAM_LANGUAGES = [
  { code: "en-IN", label: "English (India)", projectLanguage: "English" as Language },
  { code: "hi-IN", label: "Hindi", projectLanguage: "Hindi" as Language },
  { code: "te-IN", label: "Telugu", projectLanguage: "Telugu" as Language },
  { code: "ta-IN", label: "Tamil", projectLanguage: "Tamil" as Language },
  { code: "kn-IN", label: "Kannada", projectLanguage: "Kannada" as Language },
  { code: "mr-IN", label: "Marathi", projectLanguage: "Marathi" as Language },
  { code: "bn-IN", label: "Bengali", projectLanguage: null },
  { code: "gu-IN", label: "Gujarati", projectLanguage: null },
  { code: "ml-IN", label: "Malayalam", projectLanguage: null },
  { code: "od-IN", label: "Odia", projectLanguage: null },
  { code: "pa-IN", label: "Punjabi", projectLanguage: null },
] as const;

export type SarvamLanguageCode = (typeof SARVAM_LANGUAGES)[number]["code"];

export const SARVAM_LANGUAGE_CODE_SET = new Set<string>(SARVAM_LANGUAGES.map((l) => l.code));

export function resolveSarvamLanguageCode(languageOrCode: string): SarvamLanguageCode | null {
  const clean = languageOrCode.trim();
  if (!clean) return null;

  const byCode = SARVAM_LANGUAGES.find((l) => l.code.toLowerCase() === clean.toLowerCase());
  if (byCode) return byCode.code;

  const byProjectLanguage = SARVAM_LANGUAGES.find(
    (l) => l.projectLanguage && l.projectLanguage.toLowerCase() === clean.toLowerCase(),
  );
  if (byProjectLanguage) return byProjectLanguage.code;

  const byLabel = SARVAM_LANGUAGES.find((l) => l.label.toLowerCase() === clean.toLowerCase());
  if (byLabel) return byLabel.code;

  return null;
}

/**
 * Verified speaker catalog for Sarvam AI bulbul:v3.
 * All bulbul:v3 speakers support every language listed in SARVAM_LANGUAGES.
 */
export const SARVAM_VOICES = [
  { id: "shubh", label: "Shubh (Default)", gender: "male" },
  { id: "priya", label: "Priya", gender: "female" },
  { id: "aditya", label: "Aditya", gender: "male" },
  { id: "ritu", label: "Ritu", gender: "female" },
  { id: "kavya", label: "Kavya", gender: "female" },
  { id: "rahul", label: "Rahul", gender: "male" },
  { id: "neha", label: "Neha", gender: "female" },
  { id: "rohan", label: "Rohan", gender: "male" },
  { id: "pooja", label: "Pooja", gender: "female" },
  { id: "simran", label: "Simran", gender: "female" },
  { id: "amit", label: "Amit", gender: "male" },
  { id: "dev", label: "Dev", gender: "male" },
  { id: "ishita", label: "Ishita", gender: "female" },
  { id: "shreya", label: "Shreya", gender: "female" },
  { id: "ratan", label: "Ratan", gender: "male" },
  { id: "varun", label: "Varun", gender: "male" },
  { id: "manan", label: "Manan", gender: "male" },
  { id: "sumit", label: "Sumit", gender: "male" },
  { id: "roopa", label: "Roopa", gender: "female" },
  { id: "kabir", label: "Kabir", gender: "male" },
  { id: "aayan", label: "Aayan", gender: "male" },
  { id: "ashutosh", label: "Ashutosh", gender: "male" },
  { id: "advait", label: "Advait", gender: "male" },
  { id: "anand", label: "Anand", gender: "male" },
  { id: "tanya", label: "Tanya", gender: "female" },
  { id: "tarun", label: "Tarun", gender: "male" },
  { id: "sunny", label: "Sunny", gender: "male" },
  { id: "mani", label: "Mani", gender: "male" },
  { id: "gokul", label: "Gokul", gender: "male" },
  { id: "vijay", label: "Vijay", gender: "male" },
  { id: "shruti", label: "Shruti", gender: "female" },
  { id: "suhani", label: "Suhani", gender: "female" },
  { id: "mohit", label: "Mohit", gender: "male" },
  { id: "kavitha", label: "Kavitha", gender: "female" },
  { id: "rehan", label: "Rehan", gender: "male" },
  { id: "soham", label: "Soham", gender: "male" },
  { id: "rupali", label: "Rupali", gender: "female" },
] as const;

export type SarvamVoiceId = (typeof SARVAM_VOICES)[number]["id"];
export const SARVAM_VOICE_ID_SET = new Set<string>(SARVAM_VOICES.map((v) => v.id));

export const sceneAudioMetadataSchema = z.object({
  audioUrl: z.string().min(1).max(1000),
  storageKey: z.string().min(1).max(1000),
  format: z.enum(["mp3", "wav", "ogg", "webm"]),
  mimeType: z.string().min(1).max(100),
  durationSec: z.number().min(0).max(3600),
  sizeBytes: z.number().int().min(0).optional(),
  model: z.string().min(1).max(100),
  voice: z.string().max(100).nullable().optional(),
  languageCode: z.string().max(20).nullable().optional(),
  sampleRate: z.number().int().min(8000).max(48000).optional(),
  narrationHash: z.string().max(128).optional(),
  status: z.enum(["ready", "failed"]).default("ready"),
  generatedAt: z.string().min(1),
  requestId: z.string().max(120).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});

export type SceneAudioMetadata = z.output<typeof sceneAudioMetadataSchema>;

export const generateSceneVoiceoverInputSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required"),
  sceneId: z.string().trim().min(1, "Scene ID is required"),
  narration: z
    .string()
    .trim()
    .min(1, "Scene narration cannot be empty. Write or generate narration text first.")
    .max(
      SARVAM_MAX_NARRATION_CHARS,
      `Narration exceeds Sarvam AI's ${SARVAM_MAX_NARRATION_CHARS} character limit per scene.`,
    ),
  language: z.string().trim().min(1, "Voiceover language is required"),
  voice: z.string().trim().min(1, "Speaker voice is required"),
  format: z.enum(SARVAM_AUDIO_FORMATS).default("mp3"),
  pace: z.coerce.number().min(0.5, "Minimum pace is 0.5x").max(2.0, "Maximum pace is 2.0x").default(1.0),
});

export type GenerateSceneVoiceoverInput = z.input<typeof generateSceneVoiceoverInputSchema>;

/**
 * Safely extracts typed per-scene voiceover metadata from VideoProject.metadata.
 */
export function extractSceneAudioMap(metadata: unknown): Record<string, SceneAudioMetadata> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const rawMap = (metadata as { sceneAudio?: unknown }).sceneAudio;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  const clean: Record<string, SceneAudioMetadata> = {};
  for (const [sceneId, value] of Object.entries(rawMap as Record<string, unknown>)) {
    const parsed = sceneAudioMetadataSchema.safeParse(value);
    if (parsed.success) {
      clean[sceneId] = parsed.data;
    }
  }
  return clean;
}

/**
 * Merges updated per-scene audio metadata into VideoProject.metadata while preserving
 * all unrelated keys.
 */
export function mergeSceneAudioMetadata(
  existingMetadata: unknown,
  sceneAudioMap: Record<string, SceneAudioMetadata>,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  base.sceneAudio = sceneAudioMap;
  return base;
}

/* ---------- Project Thumbnail Metadata ---------- */

export const projectThumbnailMetadataSchema = z.object({
  storageKey: z.string().trim().min(1, "Thumbnail storage key is required"),
  url: z.string().trim().min(1, "Thumbnail URL is required"),
  mimeType: z.string().trim().min(1, "Thumbnail MIME type is required"),
  fileSizeBytes: z.number().int().nonnegative("File size must be non-negative"),
  uploadedAt: z.string().trim().min(1, "Upload timestamp is required"),
  isCustom: z.literal(true),
});

export type ProjectThumbnailMetadata = z.infer<typeof projectThumbnailMetadataSchema>;

/**
 * Safely extracts custom thumbnail metadata from VideoProject.metadata.
 */
export function extractProjectThumbnail(metadata: unknown): ProjectThumbnailMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as { customThumbnail?: unknown }).customThumbnail;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const parsed = projectThumbnailMetadataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Merges updated custom thumbnail metadata into VideoProject.metadata while preserving
 * all existing keys (such as sceneAudio, etc.).
 */
export function mergeProjectThumbnail(
  existingMetadata: unknown,
  thumbnail: ProjectThumbnailMetadata | null,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  if (thumbnail) {
    base.customThumbnail = thumbnail;
  } else {
    delete base.customThumbnail;
  }
  return base;
}

/**
 * Safely extracts thumbnail prompt text from VideoProject.metadata.
 */
export function extractThumbnailPrompt(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }
  const prompt = (metadata as { thumbnailPrompt?: unknown }).thumbnailPrompt;
  return typeof prompt === "string" ? prompt : "";
}

/**
 * Merges updated thumbnail prompt text into VideoProject.metadata while preserving
 * all existing keys.
 */
export function mergeThumbnailPrompt(
  existingMetadata: unknown,
  prompt: string | null | undefined,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  if (typeof prompt === "string" && prompt.trim().length > 0) {
    base.thumbnailPrompt = prompt.trim();
  } else if (prompt === null || prompt === "") {
    delete base.thumbnailPrompt;
  }
  return base;
}

/* ---------- Camera Motion Animation Effects (Phase 3 Part C3.5) ---------- */

export const CAMERA_MOTION_EFFECTS = [
  "AUTO",
  "SLOW_ZOOM_IN",
  "SLOW_ZOOM_OUT",
  "PAN_LEFT",
  "PAN_RIGHT",
  "PAN_UP",
  "PAN_DOWN",
  "NONE",
] as const;

export type CameraMotionEffect = (typeof CAMERA_MOTION_EFFECTS)[number];

export const CAMERA_MOTION_INTENSITIES = ["SUBTLE", "MEDIUM"] as const;
export type CameraMotionIntensity = (typeof CAMERA_MOTION_INTENSITIES)[number];

export const FOCAL_POSITIONS = ["CENTER", "TOP", "BOTTOM", "LEFT", "RIGHT"] as const;
export type FocalPosition = (typeof FOCAL_POSITIONS)[number];

export const sceneCameraMotionSchema = z.object({
  effect: z.enum(CAMERA_MOTION_EFFECTS).default("AUTO"),
  intensity: z.enum(CAMERA_MOTION_INTENSITIES).default("SUBTLE"),
  focalPosition: z.enum(FOCAL_POSITIONS).default("CENTER").optional(),
});

export type SceneCameraMotion = {
  effect: CameraMotionEffect;
  intensity: CameraMotionIntensity;
  focalPosition?: FocalPosition;
};

export const CAMERA_MOTION_EFFECT_LABELS: Record<CameraMotionEffect, string> = {
  AUTO: "Auto (Cinematic Sequence)",
  SLOW_ZOOM_IN: "Slow Zoom In (Push In)",
  SLOW_ZOOM_OUT: "Slow Zoom Out (Pull Out)",
  PAN_LEFT: "Pan Left (Right to Left)",
  PAN_RIGHT: "Pan Right (Left to Right)",
  PAN_UP: "Pan Up (Bottom to Top)",
  PAN_DOWN: "Pan Down (Top to Bottom)",
  NONE: "None (Static Image)",
};

export const CAMERA_MOTION_INTENSITY_LABELS: Record<CameraMotionIntensity, string> = {
  SUBTLE: "Subtle (Recommended for Real Estate)",
  MEDIUM: "Medium (Dynamic Movement)",
};

export const FOCAL_POSITION_LABELS: Record<FocalPosition, string> = {
  CENTER: "Center (Default)",
  TOP: "Top (High Subject / Rooftop)",
  BOTTOM: "Bottom (Low Subject / Ground)",
  LEFT: "Left (Left-Aligned Subject)",
  RIGHT: "Right (Right-Aligned Subject)",
};

/**
 * Deterministic scene-based selection sequence for AUTO camera motion.
 * Ensures reassembling the same project produces the exact same cinematic movements.
 */
export const AUTO_CAMERA_MOTION_SEQUENCE: readonly Exclude<CameraMotionEffect, "NONE" | "AUTO">[] = [
  "SLOW_ZOOM_IN",
  "PAN_RIGHT",
  "SLOW_ZOOM_OUT",
  "PAN_LEFT",
  "SLOW_ZOOM_IN",
  "PAN_UP",
  "PAN_RIGHT",
  "SLOW_ZOOM_OUT",
  "PAN_DOWN",
  "PAN_LEFT",
] as const;

export function isInfographicContent(title?: string, narration?: string): boolean {
  const combined = `${title || ""} ${narration || ""}`.toLowerCase();
  const keywords = [
    "infographic",
    "vs",
    "versus",
    "compare",
    "comparison",
    "chart",
    "table",
    "guide",
    "pros and cons",
    "overview",
    "checklist",
    "residential vs commercial",
  ];
  return keywords.some((kw) => combined.includes(kw));
}

export function resolveSceneCameraMotion(
  sceneMotion?: Partial<SceneCameraMotion> | null,
  sceneIndex: number = 0,
  projectDefault?: Partial<SceneCameraMotion> | null,
  sceneContext?: {
    title?: string;
    narration?: string;
    isInfographic?: boolean;
  },
): {
  effect: Exclude<CameraMotionEffect, "AUTO">;
  intensity: CameraMotionIntensity;
  focalPosition: FocalPosition;
  wasAuto: boolean;
} {
  const chosenEffect = sceneMotion?.effect ?? projectDefault?.effect ?? "AUTO";
  const chosenIntensity = sceneMotion?.intensity ?? projectDefault?.intensity ?? "SUBTLE";
  const chosenFocal = sceneMotion?.focalPosition ?? projectDefault?.focalPosition ?? "CENTER";

  if (chosenEffect === "NONE") {
    return {
      effect: "NONE",
      intensity: chosenIntensity,
      focalPosition: chosenFocal,
      wasAuto: false,
    };
  }

  if (chosenEffect === "AUTO") {
    const isInfo =
      sceneContext?.isInfographic ||
      isInfographicContent(sceneContext?.title, sceneContext?.narration);

    if (isInfo) {
      const combined = `${sceneContext?.title || ""} ${sceneContext?.narration || ""}`.toLowerCase();
      const isComparison =
        combined.includes("compare") ||
        combined.includes("versus") ||
        combined.includes("vs") ||
        combined.includes("residential vs commercial");

      // For comparison infographics: gentle horizontal pan across columns
      // For general infographics: gentle subtle zoom with safe headroom
      const resolved = isComparison
        ? sceneIndex % 2 === 0
          ? "PAN_RIGHT"
          : "PAN_LEFT"
        : "SLOW_ZOOM_IN";

      return {
        effect: resolved,
        intensity: "SUBTLE",
        focalPosition: chosenFocal,
        wasAuto: true,
      };
    }

    const safeIdx = Math.max(0, sceneIndex);
    const resolved = AUTO_CAMERA_MOTION_SEQUENCE[safeIdx % AUTO_CAMERA_MOTION_SEQUENCE.length];
    return {
      effect: resolved,
      intensity: chosenIntensity,
      focalPosition: chosenFocal,
      wasAuto: true,
    };
  }

  return {
    effect: chosenEffect,
    intensity: chosenIntensity,
    focalPosition: chosenFocal,
    wasAuto: false,
  };
}

export function extractSceneCameraMotionMap(metadata: unknown): Record<string, SceneCameraMotion> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const raw = (metadata as { sceneCameraMotion?: unknown }).sceneCameraMotion;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, SceneCameraMotion> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = sceneCameraMotionSchema.safeParse(val);
    if (parsed.success) {
      result[key] = parsed.data;
    }
  }
  return result;
}

export function mergeSceneCameraMotion(
  existingMetadata: unknown,
  motionMap: Record<string, SceneCameraMotion>,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  base.sceneCameraMotion = motionMap;
  return base;
}

export function extractDefaultCameraMotion(metadata: unknown): SceneCameraMotion {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { effect: "AUTO", intensity: "SUBTLE", focalPosition: "CENTER" };
  }
  const raw = (metadata as { defaultCameraMotion?: unknown }).defaultCameraMotion;
  const parsed = sceneCameraMotionSchema.safeParse(raw);
  return parsed.success ? parsed.data : { effect: "AUTO", intensity: "SUBTLE", focalPosition: "CENTER" };
}

export function mergeDefaultCameraMotion(
  existingMetadata: unknown,
  defaultMotion: SceneCameraMotion | null | undefined,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  if (defaultMotion) {
    base.defaultCameraMotion = defaultMotion;
  } else {
    delete base.defaultCameraMotion;
  }
  return base;
}

/* ---------- Brand Watermark Overlay Configuration (C3.6) ---------- */

export const WATERMARK_POSITIONS = [
  "TOP_RIGHT",
  "TOP_LEFT",
  "BOTTOM_RIGHT",
  "BOTTOM_LEFT",
] as const;

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  TOP_RIGHT: "Top Right",
  TOP_LEFT: "Top Left",
  BOTTOM_RIGHT: "Bottom Right",
  BOTTOM_LEFT: "Bottom Left",
};

export const WATERMARK_SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;

export type WatermarkSize = (typeof WATERMARK_SIZES)[number];

export const WATERMARK_SIZE_LABELS: Record<WatermarkSize, string> = {
  SMALL: "Small",
  MEDIUM: "Medium",
  LARGE: "Large",
};

export const watermarkConfigSchema = z.object({
  enabled: z.boolean().default(true),
  position: z.enum(WATERMARK_POSITIONS).default("TOP_RIGHT"),
  size: z.enum(WATERMARK_SIZES).default("MEDIUM"),
  opacity: z.coerce.number().min(0.1).max(1.0).default(0.92),
});

export type WatermarkConfig = z.infer<typeof watermarkConfigSchema>;

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  enabled: true,
  position: "TOP_RIGHT",
  size: "MEDIUM",
  opacity: 0.92,
};

export interface WatermarkLayout {
  enabled: boolean;
  logoWidth: number;
  logoHeight: number;
  x: number;
  y: number;
  opacity: number;
  position: WatermarkPosition;
  size: WatermarkSize;
}

/**
 * Calculates responsive dimensions and safe margins for the REBX watermark overlay.
 * Preserves the exact 703:135 aspect ratio of the canonical REBX logo asset.
 */
export function calculateWatermarkLayout(
  canvasWidth: number,
  canvasHeight: number,
  aspectRatio: AspectRatio | string,
  config: WatermarkConfig = DEFAULT_WATERMARK_CONFIG,
): WatermarkLayout {
  if (!config.enabled) {
    return {
      enabled: false,
      logoWidth: 0,
      logoHeight: 0,
      x: 0,
      y: 0,
      opacity: 0,
      position: config.position,
      size: config.size,
    };
  }

  // Canonical logo aspect ratio (703 / 135 ~ 5.2074)
  const LOGO_ASPECT_RATIO = 703 / 135;

  let widthFraction: number;
  let marginXFraction: number;
  let marginYFraction: number;

  if (aspectRatio === "9:16" || canvasHeight > canvasWidth) {
    // Mobile vertical reels/shorts: wider relative width for readability, safe margin below status bar/notch
    widthFraction = config.size === "SMALL" ? 0.18 : config.size === "LARGE" ? 0.26 : 0.22;
    marginXFraction = 0.04;
    marginYFraction = 0.045; // ~86px on 1920h
  } else if (aspectRatio === "1:1" || canvasWidth === canvasHeight) {
    // Square
    widthFraction = config.size === "SMALL" ? 0.14 : config.size === "LARGE" ? 0.22 : 0.18;
    marginXFraction = 0.035;
    marginYFraction = 0.035;
  } else {
    // Landscape 16:9
    widthFraction = config.size === "SMALL" ? 0.11 : config.size === "LARGE" ? 0.18 : 0.14;
    marginXFraction = 0.025;
    marginYFraction = 0.035;
  }

  let logoWidth = Math.round(canvasWidth * widthFraction);
  // Ensure even dimensions for optimal FFmpeg scaling
  if (logoWidth % 2 !== 0) logoWidth += 1;
  let logoHeight = Math.round(logoWidth / LOGO_ASPECT_RATIO);
  if (logoHeight % 2 !== 0) logoHeight += 1;

  const marginX = Math.round(canvasWidth * marginXFraction);
  const marginY = Math.round(canvasHeight * marginYFraction);

  let x: number;
  let y: number;

  switch (config.position) {
    case "TOP_LEFT":
      x = marginX;
      y = marginY;
      break;
    case "BOTTOM_LEFT":
      x = marginX;
      y = canvasHeight - marginY - logoHeight;
      break;
    case "BOTTOM_RIGHT":
      x = canvasWidth - marginX - logoWidth;
      y = canvasHeight - marginY - logoHeight;
      break;
    case "TOP_RIGHT":
    default:
      x = canvasWidth - marginX - logoWidth;
      y = marginY;
      break;
  }

  const opacity = Math.max(0.1, Math.min(1.0, config.opacity ?? 0.92));

  return {
    enabled: true,
    logoWidth,
    logoHeight,
    x,
    y,
    opacity,
    position: config.position,
    size: config.size,
  };
}

export function extractWatermarkConfig(metadata: unknown): WatermarkConfig {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ...DEFAULT_WATERMARK_CONFIG };
  }
  const raw = (metadata as { watermark?: unknown }).watermark;
  if (!raw) {
    return { ...DEFAULT_WATERMARK_CONFIG };
  }
  const parsed = watermarkConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_WATERMARK_CONFIG };
}

export function mergeWatermarkConfig(
  existingMetadata: unknown,
  watermark: WatermarkConfig | null | undefined,
): Record<string, unknown> {
  const base =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  if (watermark) {
    base.watermark = watermark;
  } else {
    delete base.watermark;
  }
  return base;
}

/* ---------- Project Statuses ---------- */

export const PROJECT_STATUSES = [
  "DRAFT",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Draft",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

/* ---------- Source Types (Tabs) ---------- */

export const SOURCE_TYPES = [
  "CUSTOM_SCRIPT",
  "EXISTING_CONTENT",
  "CONTENT_IDEAS",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

/* ---------- Content Ideas & Source Hits ---------- */

export type SourceHit = { id: string; title: string; subtitle?: string };

export type ContentIdea = {
  id: string;
  title: string;
  category: string;
  targetDuration: number;
  description: string;
  outline: string[];
};

export const REBX_CONTENT_IDEAS: ContentIdea[] = [
  {
    id: "idea_hyderabad_corridors",
    title: "Hyderabad's Top 3 Real Estate Growth Corridors",
    category: "market_update",
    targetDuration: 60,
    description: "Breakdown of Tellapur, Kokapet, and Financial District price movements, connectivity, and rental yields.",
    outline: [
      "Hook: Why high-net-worth buyers are flocking to West Hyderabad",
      "Corridor 1: Tellapur - Gated luxury villas and wide green spaces",
      "Corridor 2: Kokapet & Neopolis - High-rise skyscrapers and commercial boom",
      "Corridor 3: Financial District - Unbeatable 5-minute work commute",
      "CTA: Browse verified luxury properties on REBX",
    ],
  },
  {
    id: "idea_rera_verification",
    title: "5 Things to Check on the RERA Portal Before Booking",
    category: "buyer_tips",
    targetDuration: 45,
    description: "A quick practical checklist helping homebuyers avoid litigation, delays, and unapproved layouts.",
    outline: [
      "Hook: Never pay a builder advance without verifying these 5 RERA details",
      "Step 1: Check the exact RERA registration validity and sanctioned building plans",
      "Step 2: Verify the developer's registered bank escrow account",
      "Step 3: Review the committed quarterly completion milestone schedule",
      "CTA: Compare RERA-registered homes directly on REBX",
    ],
  },
  {
    id: "idea_super_vs_carpet",
    title: "Super Built-Up vs Carpet Area: What Are You Paying For?",
    category: "explainer",
    targetDuration: 45,
    description: "Visual explanation showing how 25-30% of quoted property space is common areas, lifts, and corridors.",
    outline: [
      "Hook: Did you know you might only live in 70% of the flat you paid for?",
      "Explanation: What carpet area actually means (inner wall to inner wall)",
      "The loading factor: Why loading over 28% should make you reconsider",
      "CTA: REBX displays both carpet and super built-up areas transparently",
    ],
  },
  {
    id: "idea_tellapur_showcase",
    title: "Luxury 3BHK Tour in Tellapur: Inside 2,800 Sq Ft",
    category: "property_showcase",
    targetDuration: 60,
    description: "Showcase walkthrough of a premier high-rise luxury apartment featuring Italian marble and panoramic sunset balconies.",
    outline: [
      "Hook: Take a look inside one of Tellapur's finest 3BHK residences",
      "Living & Dining: Expansive 40-foot living room with sunlit floor-to-ceiling glass",
      "Master Suite: King-size master suite with private walk-in wardrobe and en-suite bath",
      "Amenities: Olympic-size infinity pool, tennis courts, and 50,000 sq ft clubhouse",
      "CTA: Schedule a private in-person site visit through REBX",
    ],
  },
];

/* ---------- Scene Schema ---------- */

export const editorSceneSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "Scene title cannot be empty").max(255),
  narration: z.string().trim().max(2500).default(""),
  imagePrompt: z.string().trim().max(2500).default(""),
  imageUrl: z.string().max(1000).nullable().default(null),
  duration: z.coerce.number().int().min(2, "Minimum 2s").max(60, "Maximum 60s").default(6),
  locked: z.boolean().default(false),
  order: z.number().int().default(0),
  audio: sceneAudioMetadataSchema.nullable().optional(),
  cameraMotion: sceneCameraMotionSchema.nullable().optional(),
});

export type EditorScene = z.output<typeof editorSceneSchema>;

/* ---------- Project Validation & Transfer Schemas ---------- */

export const createProjectSchema = z.object({
  title: z.string().trim().min(1, "Video title is required").max(255),
  topic: z.string().trim().max(5000).optional().default(""),
  category: z.enum(CONTENT_CATEGORIES).default("property_showcase"),
  sourceType: z.enum(SOURCE_TYPES).default("CUSTOM_SCRIPT"),
  sourceRefType: z.string().optional(),
  sourceRefId: z.string().optional(),
  targetAudience: z.string().trim().max(300).optional().default(""),
  language: z.enum(LANGUAGES).default("English"),
  tone: z.enum(TONES).default("Professional"),
  duration: z.coerce.number().int().min(10).max(300).default(60),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
  thumbnailPrompt: z.string().trim().max(2500).optional().nullable(),
  defaultCameraMotion: sceneCameraMotionSchema.optional(),
  watermark: watermarkConfigSchema.optional(),
  scenes: z.array(editorSceneSchema).default([]),
});

export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const saveDraftSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Video title is required").max(255),
  topic: z.string().trim().max(5000).optional().default(""),
  category: z.enum(CONTENT_CATEGORIES).default("property_showcase"),
  status: z.enum(PROJECT_STATUSES).default("DRAFT"),
  targetAudience: z.string().trim().max(300).optional().default(""),
  language: z.enum(LANGUAGES).default("English"),
  tone: z.enum(TONES).default("Professional"),
  duration: z.coerce.number().int().min(10).max(300).default(60),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
  thumbnailPrompt: z.string().trim().max(2500).optional().nullable(),
  defaultCameraMotion: sceneCameraMotionSchema.optional(),
  watermark: watermarkConfigSchema.optional(),
  scenes: z.array(editorSceneSchema).min(1, "At least one scene is required"),
});

export type SaveDraftInput = z.input<typeof saveDraftSchema>;

/* ---------- Gemini Generated Script Validation ---------- */

export const geminiSceneInputSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional().default("Scene"),
    narration: z.string().optional(),
    narration_text: z.string().optional(),
    imagePrompt: z.string().optional(),
    image_prompt: z.string().optional(),
    visual_prompt: z.string().optional(),
    duration: z.coerce.number().optional(),
    duration_sec: z.coerce.number().optional(),
  })
  .transform((val) => ({
    title: val.title || "Scene",
    narration: (val.narration ?? val.narration_text ?? "").trim(),
    imagePrompt: (val.imagePrompt ?? val.image_prompt ?? val.visual_prompt ?? "").trim(),
    duration: Math.min(60, Math.max(2, Math.round(Number(val.duration ?? val.duration_sec ?? 6)))),
  }));

export const geminiScriptInputSchema = z.object({
  title: z.string().trim().min(1, "Video title is required").max(255),
  description: z.string().trim().optional().default(""),
  thumbnailPrompt: z.string().trim().optional().default(""),
  scenes: z.array(geminiSceneInputSchema).min(1, "At least one scene is required"),
});

export type GeminiScriptOutput = {
  title: string;
  description: string;
  thumbnailPrompt?: string;
  scenes: {
    title: string;
    narration: string;
    imagePrompt: string;
    duration: number;
  }[];
};

export const generateGeminiScriptActionSchema = z.object({
  topic: z.string().trim().min(1, "Topic or project description is required").max(5000),
  category: z.enum(CONTENT_CATEGORIES).default("property_showcase"),
  targetAudience: z.string().trim().max(300).optional().default(""),
  language: z.enum(LANGUAGES).default("English"),
  tone: z.enum(TONES).default("Professional"),
  desiredDuration: z.coerce.number().int().min(10).max(300).default(60),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
  sourceSummary: z.string().optional(),
});

export type GenerateGeminiScriptInput = z.input<typeof generateGeminiScriptActionSchema>;

/* ---------- Versioned JSON Project Structure (Section 6) ---------- */

export interface VersionedProjectJson {
  schemaVersion: "1.0.0";
  projectId: string;
  title: string;
  category: ContentCategory;
  status: ProjectStatus;
  videoSettings: {
    aspectRatio: AspectRatio;
    dimensions: string;
    width: number;
    height: number;
    desiredDuration: number;
    totalCalculatedDuration: number;
    defaultCameraMotion?: SceneCameraMotion;
    watermark?: WatermarkConfig;
  };
  targetAudience: string;
  language: Language;
  tone: Tone;
  topic: string;
  scenes: {
    id: string;
    order: number;
    title: string;
    narration: string;
    imagePrompt: string;
    imageUrl: string | null;
    duration: number;
    locked: boolean;
    audio?: SceneAudioMetadata | null;
    cameraMotion?: SceneCameraMotion | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

export const versionedProjectJsonSceneSchema = z.object({
  id: z.string().trim().min(1, "Scene ID is required"),
  order: z.number().int().min(1, "Scene order must be >= 1"),
  title: z.string().trim().min(1, "Scene title is required").max(255),
  narration: z.string().max(SARVAM_MAX_NARRATION_CHARS),
  imagePrompt: z.string().max(2500),
  imageUrl: z.string().max(1000).nullable(),
  duration: z.number().int().min(2, "Minimum scene duration is 2s").max(60, "Maximum scene duration is 60s"),
  locked: z.boolean(),
  audio: sceneAudioMetadataSchema.nullable().optional(),
  cameraMotion: sceneCameraMotionSchema.nullable().optional(),
});

export const versionedProjectJsonSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  projectId: z.string().trim().min(1, "Project ID is required"),
  title: z.string().trim().min(1, "Video title is required").max(255),
  category: z.enum(CONTENT_CATEGORIES),
  status: z.enum(PROJECT_STATUSES),
  videoSettings: z.object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    dimensions: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    desiredDuration: z.number().int().min(10).max(300),
    totalCalculatedDuration: z.number().int().positive(),
    defaultCameraMotion: sceneCameraMotionSchema.optional(),
    watermark: watermarkConfigSchema.optional(),
  }),
  targetAudience: z.string().max(300),
  language: z.enum(LANGUAGES),
  tone: z.enum(TONES),
  topic: z.string().max(5000),
  scenes: z.array(versionedProjectJsonSceneSchema).min(1, "At least one scene is required"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/* ---------- Render Job Management Schemas & Types (Phase 3 Part C2) ---------- */

export const RENDER_JOB_STATUSES = [
  "PENDING",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RenderJobStatus = (typeof RENDER_JOB_STATUSES)[number];

export const ACTIVE_RENDER_JOB_STATUSES = [
  "PENDING",
  "QUEUED",
  "PROCESSING",
] as const;

export const RENDER_JOB_STATUS_LABELS: Record<RenderJobStatus, string> = {
  PENDING: "Pending",
  QUEUED: "Queued",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const renderJobProgressSchema = z
  .number()
  .int("Progress must be an integer between 0 and 100.")
  .min(0, "Progress cannot be less than 0%.")
  .max(100, "Progress cannot exceed 100%.");

export const validateRenderProjectSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
});

export const createRenderJobSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
});

export const getRenderJobSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
  jobId: z.string().trim().min(1, "Render job ID is required."),
});

export const listRenderJobsSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
});

export const cancelRenderJobSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
  jobId: z.string().trim().min(1, "Render job ID is required."),
});

export const retryRenderJobSchema = z.object({
  projectId: z.string().trim().min(1, "Project ID is required."),
  jobId: z.string().trim().min(1, "Render job ID is required."),
});

export type RenderValidationIssue = {
  code: string;
  level: "error" | "warning";
  message: string;
  sceneId?: string;
  sceneOrder?: number;
};

export type RenderValidationReport = {
  valid: boolean;
  errors: RenderValidationIssue[];
  warnings: RenderValidationIssue[];
  summary: {
    sceneCount: number;
    totalDurationSec: number;
    aspectRatio: string;
    dimensions: string | null;
    missingImageCount: number;
    missingAudioCount: number;
    staleAudioCount: number;
  };
};

export type RenderSnapshotImageAsset = {
  sourceUrl: string;
  provider: "local" | "spaces";
  resolvedPathOrKey: string;
};

export type RenderSnapshotAudioAsset = {
  storageKey: string;
  provider: "local-private" | "spaces";
  resolvedKey: string;
  format: "mp3" | "wav" | "ogg" | "webm";
  mimeType: string;
  durationSec: number;
  model: string;
  voice: string | null;
  languageCode: string | null;
  narrationHash: string | null;
};

export type RenderJobSnapshot = {
  snapshotVersion: "1.0.0";
  capturedAt: string;
  project: VersionedProjectJson;
  renderSettings: {
    aspectRatio: AspectRatio;
    width: number;
    height: number;
    dimensions: string;
    fps: 30;
    outputFormat: "mp4";
    videoCodec: "h264";
    audioCodec: "aac";
    totalDurationSec: number;
    defaultCameraMotion?: SceneCameraMotion;
    watermark?: WatermarkConfig;
  };
  scenes: {
    sceneId: string;
    order: number;
    title: string;
    narration: string;
    durationSec: number;
    image: RenderSnapshotImageAsset;
    audio: RenderSnapshotAudioAsset;
    cameraMotion?: SceneCameraMotion | null;
  }[];
  outputDestination: {
    provider: "local-private" | "spaces";
    storageKeyPrefix: string;
    format: "mp4";
  };
};

export type RenderJobOutputMetadata = {
  targetOutputKey: string;
  container: "mp4";
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: number;
  sceneCount: number;
  totalDurationSec: number;
  workerPendingPartC3: boolean;
  fileSizeBytes?: number | null;
  renderedDurationSec?: number | null;
  renderedAt?: string | null;
  checksumSha256?: string | null;
  etag?: string | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  pixelFormat?: string | null;
  bitRate?: number | null;
  storageProvider?: "local-private" | "spaces" | null;
};

export type RenderJobSummary = {
  id: string;
  projectId: string;
  createdById: number | null;
  status: RenderJobStatus;
  progress: number;
  stage: string | null;
  errorMessage: string | null;
  snapshotHash: string;
  outputStorageKey: string | null;
  outputMetadata: RenderJobOutputMetadata | null;
  retryCount: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  snapshot: RenderJobSnapshot;
};

/* ---------- Background Worker Protocol Schemas (Phase 3 Part C3.1) ---------- */

export const WORKER_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,118}$/;
export const DEFAULT_WORKER_LEASE_SECONDS = 300;
export const MIN_WORKER_LEASE_SECONDS = 30;
export const MAX_WORKER_LEASE_SECONDS = 3600;
export const DEFAULT_MAX_WORKER_AUTO_RETRIES = 3;

export const workerIdSchema = z
  .string()
  .trim()
  .min(2, "Worker ID must be at least 2 characters.")
  .max(120, "Worker ID must be at most 120 characters.")
  .regex(
    WORKER_ID_REGEX,
    "Worker ID may only contain letters, numbers, dots, underscores, colons, and hyphens.",
  );

export const renderSnapshotImageAssetSchema = z.object({
  sourceUrl: z.string().trim().min(1),
  provider: z.enum(["local", "spaces"]),
  resolvedPathOrKey: z.string().trim().min(1),
});

export const renderSnapshotAudioAssetSchema = z.object({
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
});

export const renderJobSnapshotSchema = z.object({
  snapshotVersion: z.literal("1.0.0"),
  capturedAt: z.string().min(1),
  project: versionedProjectJsonSchema,
  renderSettings: z.object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    dimensions: z.string().min(1),
    fps: z.literal(30),
    outputFormat: z.literal("mp4"),
    videoCodec: z.literal("h264"),
    audioCodec: z.literal("aac"),
    totalDurationSec: z.number().int().positive(),
    defaultCameraMotion: sceneCameraMotionSchema.optional(),
    watermark: watermarkConfigSchema.optional(),
  }),
  scenes: z
    .array(
      z.object({
        sceneId: z.string().trim().min(1),
        order: z.number().int().min(1),
        title: z.string().trim().min(1),
        narration: z.string(),
        durationSec: z.number().int().min(2).max(60),
        image: renderSnapshotImageAssetSchema,
        audio: renderSnapshotAudioAssetSchema,
        cameraMotion: sceneCameraMotionSchema.optional(),
      }),
    )
    .min(1, "Render snapshot must include at least one scene."),
  outputDestination: z.object({
    provider: z.enum(["local-private", "spaces"]),
    storageKeyPrefix: z.string().trim().min(1),
    format: z.literal("mp4"),
  }),
});

export const workerClaimJobSchema = z.object({
  workerId: workerIdSchema,
  leaseDurationSec: z
    .number()
    .int("Lease duration must be an integer in seconds.")
    .min(MIN_WORKER_LEASE_SECONDS, `Minimum lease duration is ${MIN_WORKER_LEASE_SECONDS}s.`)
    .max(MAX_WORKER_LEASE_SECONDS, `Maximum lease duration is ${MAX_WORKER_LEASE_SECONDS}s.`)
    .optional(),
  recoverExpiredLeases: z.boolean().optional(),
});

export type WorkerClaimJobInput = z.output<typeof workerClaimJobSchema>;

export const workerProgressSchema = z.object({
  workerId: workerIdSchema,
  progress: renderJobProgressSchema,
  stage: z.string().trim().min(1, "Stage cannot be empty.").max(120).optional(),
  leaseDurationSec: z
    .number()
    .int("Lease duration must be an integer in seconds.")
    .min(MIN_WORKER_LEASE_SECONDS)
    .max(MAX_WORKER_LEASE_SECONDS)
    .optional(),
});

export type WorkerProgressInput = z.output<typeof workerProgressSchema>;

export const workerHeartbeatSchema = z.object({
  workerId: workerIdSchema,
  progress: renderJobProgressSchema.optional(),
  stage: z.string().trim().min(1, "Stage cannot be empty.").max(120).optional(),
  leaseDurationSec: z
    .number()
    .int("Lease duration must be an integer in seconds.")
    .min(MIN_WORKER_LEASE_SECONDS)
    .max(MAX_WORKER_LEASE_SECONDS)
    .optional(),
});

export type WorkerHeartbeatInput = z.output<typeof workerHeartbeatSchema>;

export const workerOutputMetadataSchema = z.object({
  container: z.literal("mp4"),
  aspectRatio: z.enum(ASPECT_RATIOS),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive().max(120),
  sceneCount: z.number().int().min(1),
  totalDurationSec: z.number().positive(),
  fileSizeBytes: z.number().int().positive("Completed render output must have positive fileSizeBytes."),
  renderedDurationSec: z.number().positive("Completed render output must have positive renderedDurationSec."),
  renderedAt: z.string().min(1).optional(),
  checksumSha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "checksumSha256 must be a 64-character hex SHA-256 digest.")
    .optional(),
  etag: z.string().trim().min(1).max(256).optional(),
  videoCodec: z.string().trim().min(1).max(64).optional(),
  audioCodec: z.string().trim().min(1).max(64).nullable().optional(),
  pixelFormat: z.string().trim().min(1).max(64).optional(),
  bitRate: z.number().nonnegative().nullable().optional(),
  storageProvider: z.enum(["local-private", "spaces"]).optional(),
});

export const workerCompleteJobSchema = z.object({
  workerId: workerIdSchema,
  outputStorageKey: z.string().trim().min(1, "outputStorageKey is required.").max(500),
  stage: z.string().trim().min(1).max(120).optional(),
  outputMetadata: workerOutputMetadataSchema,
});

export type WorkerCompleteJobInput = z.output<typeof workerCompleteJobSchema>;

export const workerFailJobSchema = z.object({
  workerId: workerIdSchema,
  errorMessage: z.string().trim().min(1, "errorMessage is required.").max(2000),
  stage: z.string().trim().min(1).max(120).optional(),
});

export type WorkerFailJobInput = z.output<typeof workerFailJobSchema>;

export const workerRecoverLeasesSchema = z.object({
  maxAutoRetries: z.number().int().min(0).max(10).optional(),
});

export type WorkerRecoverLeasesInput = z.output<typeof workerRecoverLeasesSchema>;

