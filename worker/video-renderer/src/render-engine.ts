import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { StagedJobAssetsResult } from "./assets";
import {
  buildSceneCaptionCues,
  escapeFfmpegFilterPathValue,
  generateSceneAssSubtitleContent,
  type CaptionCue,
} from "./captions";
import {
  probeMediaFile,
  runFfmpegWithProgress,
  sanitizeFfmpegErrorText,
  verifyRenderedMp4Output,
  WorkerFfmpegError,
  type FfmpegEnvironmentStatus,
  type VerifiedMp4OutputMetadata,
} from "./ffmpeg";
import type { WorkerLogger } from "./logger";

export const RENDER_ASPECT_DIMENSIONS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export type RenderAspectRatio = keyof typeof RENDER_ASPECT_DIMENSIONS;

export const SUPPORTED_TRANSITIONS = ["cut", "fade", "crossfade"] as const;
export type VideoTransitionType = (typeof SUPPORTED_TRANSITIONS)[number];

export const DEFAULT_FADE_DURATION_SEC = 0.4;
export const DEFAULT_CROSSFADE_DURATION_SEC = 0.5;
export const MIN_TRANSITION_DURATION_SEC = 0.1;
export const MAX_TRANSITION_DURATION_SEC = 3.0;
export const STANDARD_RENDER_FPS = 30 as const;

/* ---------- Brand Watermark Overlay Configuration (Part C3.6) ---------- */

export const WATERMARK_POSITIONS = [
  "TOP_RIGHT",
  "TOP_LEFT",
  "BOTTOM_RIGHT",
  "BOTTOM_LEFT",
] as const;

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_SIZES = ["SMALL", "MEDIUM", "LARGE"] as const;

export type WatermarkSize = (typeof WATERMARK_SIZES)[number];

export interface WatermarkConfig {
  enabled: boolean;
  position: WatermarkPosition;
  size: WatermarkSize;
  opacity: number;
}

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
  aspectRatio: string,
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

/**
 * Deterministically locates the transparent REBX logo asset.
 */
export function resolveWatermarkLogoPath(overridePath?: string | null): string | null {
  if (overridePath && fs.existsSync(overridePath)) {
    return path.resolve(overridePath);
  }

  const candidates = [
    // 1. Watermark-specific transparent logo (white wordmark for video canvas overlay)
    path.resolve(process.cwd(), "worker/video-renderer/assets/logo-watermark.png"),
    path.resolve(__dirname, "../assets/logo-watermark.png"),
    path.resolve(__dirname, "../../assets/logo-watermark.png"),
    path.resolve(process.cwd(), "public/logo-watermark.png"),
    path.resolve(process.cwd(), "../public/logo-watermark.png"),

    // 2. Canonical brand logo fallback
    path.resolve(process.cwd(), "worker/video-renderer/assets/logo.png"),
    path.resolve(__dirname, "../assets/logo.png"),
    path.resolve(__dirname, "../../assets/logo.png"),
    path.resolve(process.cwd(), "public/logo.png"),
    path.resolve(process.cwd(), "../public/logo.png"),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return c;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

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

export type ResolvedSceneCameraMotion = {
  effect: Exclude<CameraMotionEffect, "AUTO">;
  intensity: CameraMotionIntensity;
  focalPosition: string;
  wasAuto: boolean;
};

export interface SceneSafeMarginAnalysis {
  isConstrained: boolean;
  hasTopContent: boolean;
  hasBottomContent: boolean;
  hasSideContent: boolean;
  isInfographic: boolean;
  safeSubtleZoomMax: number;
  safeMediumZoomMax: number;
  safePanZoom: number;
  safeYRatio: number;
  safeXRatio: number;
}

export function isInfographicContent(title?: string, narration?: string): boolean {
  const combined = `${title || ""} ${narration || ""}`.toLowerCase();
  const keywords = [
    "compare",
    "comparison",
    "versus",
    "vs",
    "checklist",
    "infographic",
    "breakdown",
    "costs",
    "rental income",
    "maintenance",
    "risks",
    "summary",
    "residential vs commercial",
    "pros and cons",
    "calculator",
    "documents",
    "chart",
    "table",
    "steps",
    "tips",
    "overview",
    "advice",
    "difference",
    "ratio",
    "roi",
  ];
  return keywords.some((kw) => combined.includes(kw));
}

export function analyzeImageSafeMargins(params: {
  imageFilePath: string;
  ffmpegPath?: string;
}): {
  hasTopContent: boolean;
  hasBottomContent: boolean;
  hasSideContent: boolean;
} {
  const ffmpegCmd = params.ffmpegPath || "ffmpeg";
  try {
    const buf = execFileSync(
      ffmpegCmd,
      ["-v", "quiet", "-i", params.imageFilePath, "-vf", "scale=32:32,format=gray", "-f", "rawvideo", "-"],
      { timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (!buf || buf.length < 1024) {
      return { hasTopContent: false, hasBottomContent: false, hasSideContent: false };
    }

    // Top rows 0-2 (top 9%): logo / header energy
    let topDiff = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 31; c++) {
        topDiff += Math.abs(buf[r * 32 + c] - buf[r * 32 + (c + 1)]);
      }
    }
    const topEnergy = topDiff / (3 * 31);

    // Bottom rows 29-31 (bottom 9%): footer / watermark energy
    let botDiff = 0;
    for (let r = 29; r < 32; r++) {
      for (let c = 0; c < 31; c++) {
        botDiff += Math.abs(buf[r * 32 + c] - buf[r * 32 + (c + 1)]);
      }
    }
    const botEnergy = botDiff / (3 * 31);

    // Side cols 0-2 & 29-31 (outer 9% on left/right): side labels / columns energy
    let sideDiff = 0;
    for (const c of [0, 1, 2, 29, 30, 31]) {
      for (let r = 0; r < 31; r++) {
        sideDiff += Math.abs(buf[r * 32 + c] - buf[(r + 1) * 32 + c]);
      }
    }
    const sideEnergy = sideDiff / (6 * 31);

    return {
      hasTopContent: topEnergy >= 7.5,
      hasBottomContent: botEnergy >= 16.0,
      hasSideContent: sideEnergy >= 18.0,
    };
  } catch {
    return { hasTopContent: false, hasBottomContent: false, hasSideContent: false };
  }
}

export function computeSceneSafeMargin(params: {
  isInfographic: boolean;
  hasTopContent: boolean;
  hasBottomContent: boolean;
  hasSideContent: boolean;
  config?: Partial<CameraMotionConfig>;
}): SceneSafeMarginAnalysis {
  const cfg = { ...DEFAULT_CAMERA_MOTION_CONFIG, ...params.config };
  const isConstrained =
    params.isInfographic || params.hasTopContent || params.hasSideContent || params.hasBottomContent;

  if (!isConstrained) {
    return {
      isConstrained: false,
      hasTopContent: false,
      hasBottomContent: false,
      hasSideContent: false,
      isInfographic: false,
      safeSubtleZoomMax: cfg.subtleZoomMax, // 1.15
      safeMediumZoomMax: cfg.mediumZoomMax, // 1.22
      safePanZoom: cfg.subtlePanZoom,       // 1.15
      safeYRatio: 0.5,
      safeXRatio: 0.5,
    };
  }

  return {
    isConstrained: true,
    hasTopContent: params.hasTopContent,
    hasBottomContent: params.hasBottomContent,
    hasSideContent: params.hasSideContent,
    isInfographic: params.isInfographic,
    // Safe zoom limits: prevents cutting off top logos (e.g. REBX) and outer edge labels
    safeSubtleZoomMax: Math.min(cfg.subtleZoomMax, 1.10),
    safeMediumZoomMax: Math.min(cfg.mediumZoomMax, 1.14),
    safePanZoom: Math.min(cfg.subtlePanZoom, 1.10),
    // Anchor slightly higher (0.38) to preserve title and logo headroom at the top
    safeYRatio: params.hasTopContent || params.isInfographic ? 0.38 : 0.5,
    safeXRatio: 0.5,
  };
}

export function resolveSceneCameraMotion(
  sceneMotion?: unknown,
  sceneIndex: number = 0,
  projectDefault?: unknown,
  sceneContext?: {
    title?: string;
    narration?: string;
    isInfographic?: boolean;
  },
): ResolvedSceneCameraMotion {
  const sm = sceneMotion && typeof sceneMotion === "object" ? (sceneMotion as Record<string, unknown>) : null;
  const pd = projectDefault && typeof projectDefault === "object" ? (projectDefault as Record<string, unknown>) : null;

  let rawEffect = typeof sm?.effect === "string" ? sm.effect.trim().toUpperCase() : undefined;
  if (!rawEffect && typeof pd?.effect === "string") {
    rawEffect = pd.effect.trim().toUpperCase();
  }
  if (!rawEffect || !(CAMERA_MOTION_EFFECTS as readonly string[]).includes(rawEffect)) {
    rawEffect = "AUTO";
  }

  let rawIntensity = typeof sm?.intensity === "string" ? sm.intensity.trim().toUpperCase() : undefined;
  if (!rawIntensity && typeof pd?.intensity === "string") {
    rawIntensity = pd.intensity.trim().toUpperCase();
  }
  if (!rawIntensity || !(CAMERA_MOTION_INTENSITIES as readonly string[]).includes(rawIntensity)) {
    rawIntensity = "SUBTLE";
  }

  let rawFocal = typeof sm?.focalPosition === "string" ? sm.focalPosition.trim().toUpperCase() : undefined;
  if (!rawFocal && typeof pd?.focalPosition === "string") {
    rawFocal = pd.focalPosition.trim().toUpperCase();
  }
  if (!rawFocal) {
    rawFocal = "CENTER";
  }

  if (rawEffect === "NONE") {
    return {
      effect: "NONE",
      intensity: rawIntensity as CameraMotionIntensity,
      focalPosition: rawFocal,
      wasAuto: false,
    };
  }

  if (rawEffect === "AUTO") {
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
        focalPosition: rawFocal,
        wasAuto: true,
      };
    }

    const safeIdx = Math.max(0, sceneIndex);
    const resolved = AUTO_CAMERA_MOTION_SEQUENCE[safeIdx % AUTO_CAMERA_MOTION_SEQUENCE.length];
    return {
      effect: resolved,
      intensity: rawIntensity as CameraMotionIntensity,
      focalPosition: rawFocal,
      wasAuto: true,
    };
  }

  return {
    effect: rawEffect as Exclude<CameraMotionEffect, "AUTO">,
    intensity: rawIntensity as CameraMotionIntensity,
    focalPosition: rawFocal,
    wasAuto: false,
  };
}

export type WorkerRenderValidationErrorCode =
  | "INVALID_RENDER_SETTINGS"
  | "INVALID_SCENE_TIMING"
  | "UNSUPPORTED_TRANSITION"
  | "MISSING_MEDIA_ASSET"
  | "UNREADABLE_MEDIA_INPUT";

export class WorkerRenderValidationError extends Error {
  code: WorkerRenderValidationErrorCode;

  constructor(code: WorkerRenderValidationErrorCode, message: string) {
    super(message);
    this.name = "WorkerRenderValidationError";
    this.code = code;
  }
}

export interface CameraMotionConfig {
  subtleZoomMax: number;
  mediumZoomMax: number;
  subtlePanZoom: number;
  mediumPanZoom: number;
}

export const DEFAULT_CAMERA_MOTION_CONFIG: CameraMotionConfig = {
  subtleZoomMax: 1.15,
  mediumZoomMax: 1.22,
  subtlePanZoom: 1.15,
  mediumPanZoom: 1.22,
};

export type RenderEngineSceneInput = {
  sceneId: string;
  order: number;
  title: string;
  narration: string;
  durationSec: number;
  imageFilePath: string;
  audioFilePath?: string | null;
  declaredAudioDurationSec?: number | null;
  transition?: unknown;
  cameraMotion?: unknown;
};

export type RenderVideoToMp4Input = {
  jobId: string;
  projectId: string;
  language?: string | null;
  aspectRatio: RenderAspectRatio;
  width: number;
  height: number;
  fps: number;
  outputFormat: "mp4";
  videoCodec: "h264";
  audioCodec: "aac";
  totalDurationSec?: number;
  scenes: RenderEngineSceneInput[];
  transition?: unknown;
  transitionDurationSec?: unknown;
  defaultCameraMotion?: unknown;
  cameraMotionConfig?: Partial<CameraMotionConfig>;
  watermark?: unknown;
  watermarkLogoPath?: string;
  outputFilePath: string;
  intermediatesDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  redactDirs?: readonly string[];
  logger?: WorkerLogger;
  onRenderProgress?: (info: {
    ratio: number;
    phase: "probing" | "rendering_scene" | "assembling" | "verifying";
    sceneOrder?: number;
    totalScenes: number;
    stageLabel: string;
  }) => void;
};

export type ProbedRenderSceneAsset = {
  sceneId: string;
  order: number;
  title: string;
  narration: string;
  nominalDurationSec: number;
  imageFilePath: string;
  imageWidth: number;
  imageHeight: number;
  audioFilePath: string | null;
  probedAudioDurationSec: number | null;
  audioExtendedFromNominal: boolean;
  targetDurationSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  captionCues: CaptionCue[];
  resolvedCameraMotion: ResolvedSceneCameraMotion;
  safeMarginAnalysis?: SceneSafeMarginAnalysis;
};

export type PlannedBoundaryTransition = {
  fromSceneOrder: number;
  toSceneOrder: number;
  type: VideoTransitionType;
  overlapSec: number;
};

export type RenderExecutionPlan = {
  jobId: string;
  projectId: string;
  language: string | null;
  aspectRatio: RenderAspectRatio;
  width: number;
  height: number;
  fps: number;
  transition: VideoTransitionType;
  transitionDurationSec: number;
  defaultCameraMotion?: unknown;
  cameraMotionConfig?: Partial<CameraMotionConfig>;
  watermark?: WatermarkConfig | null;
  watermarkLayout?: WatermarkLayout | null;
  watermarkLogoPath?: string | null;
  scenes: ProbedRenderSceneAsset[];
  boundaries: PlannedBoundaryTransition[];
  nominalTotalDurationSec: number;
  expectedFinalDurationSec: number;
  intermediatesDir: string;
  outputFilePath: string;
};

export type RenderedMp4Result = {
  outputFilePath: string;
  fileSizeBytes: number;
  aspectRatio: RenderAspectRatio;
  width: number;
  height: number;
  fps: number;
  sceneCount: number;
  transition: VideoTransitionType;
  nominalTotalDurationSec: number;
  expectedFinalDurationSec: number;
  renderedDurationSec: number;
  intermediatesCleaned: boolean;
  probeMetadata: VerifiedMp4OutputMetadata;
  plan: RenderExecutionPlan;
};

function roundDuration(val: number): number {
  return Number(val.toFixed(3));
}

function quantizeUpToFrame(durationSec: number, fps: number): number {
  const frames = Math.max(1, Math.ceil(durationSec * fps));
  return roundDuration(frames / fps);
}

/**
 * Validates transition type and duration strictly against supported transitions
 * ("cut", "fade", "crossfade"). Never invents unknown types or silently ignores invalid values.
 */
export function parseAndValidateTransitionConfig(params: {
  rawTransition?: unknown;
  rawTransitionDurationSec?: unknown;
  sceneCount: number;
  minSceneDurationSec: number;
  sceneTransitions?: readonly unknown[];
}): { transition: VideoTransitionType; transitionDurationSec: number } {
  const { rawTransition, rawTransitionDurationSec, sceneTransitions } = params;

  let resolvedType: VideoTransitionType = "cut";
  if (rawTransition !== undefined && rawTransition !== null) {
    if (typeof rawTransition !== "string") {
      throw new WorkerRenderValidationError(
        "UNSUPPORTED_TRANSITION",
        `Unsupported transition setting (${typeof rawTransition}). Supported transitions are: ${SUPPORTED_TRANSITIONS.join(", ")}.`,
      );
    }
    const clean = rawTransition.trim().toLowerCase();
    if (!(SUPPORTED_TRANSITIONS as readonly string[]).includes(clean)) {
      throw new WorkerRenderValidationError(
        "UNSUPPORTED_TRANSITION",
        `Unsupported transition "${rawTransition.trim() || "(empty)"}". Supported transitions are: ${SUPPORTED_TRANSITIONS.join(", ")}.`,
      );
    }
    resolvedType = clean as VideoTransitionType;
  }

  // Also reject any scene-level unsupported transition or incompatible override
  if (sceneTransitions) {
    for (let i = 0; i < sceneTransitions.length; i++) {
      const st = sceneTransitions[i];
      if (st === undefined || st === null) continue;
      if (typeof st !== "string") {
        throw new WorkerRenderValidationError(
          "UNSUPPORTED_TRANSITION",
          `Scene ${i + 1} has invalid transition setting (${typeof st}).`,
        );
      }
      const cleanSceneTransition = st.trim().toLowerCase();
      if (!(SUPPORTED_TRANSITIONS as readonly string[]).includes(cleanSceneTransition)) {
        throw new WorkerRenderValidationError(
          "UNSUPPORTED_TRANSITION",
          `Scene ${i + 1} specifies unsupported transition "${st.trim() || "(empty)"}". Supported transitions are: ${SUPPORTED_TRANSITIONS.join(", ")}.`,
        );
      }
      if (rawTransition !== undefined && rawTransition !== null && cleanSceneTransition !== resolvedType) {
        throw new WorkerRenderValidationError(
          "UNSUPPORTED_TRANSITION",
          `Mixed scene-level transition "${cleanSceneTransition}" conflicts with project transition "${resolvedType}".`,
        );
      }
      if (rawTransition === undefined || rawTransition === null) {
        resolvedType = cleanSceneTransition as VideoTransitionType;
      }
    }
  }

  let transitionDurationSec = 0;
  if (resolvedType === "fade" || resolvedType === "crossfade") {
    const defaultDur =
      resolvedType === "fade" ? DEFAULT_FADE_DURATION_SEC : DEFAULT_CROSSFADE_DURATION_SEC;

    if (rawTransitionDurationSec !== undefined && rawTransitionDurationSec !== null) {
      if (
        typeof rawTransitionDurationSec !== "number" ||
        !Number.isFinite(rawTransitionDurationSec) ||
        rawTransitionDurationSec < MIN_TRANSITION_DURATION_SEC ||
        rawTransitionDurationSec > MAX_TRANSITION_DURATION_SEC
      ) {
        throw new WorkerRenderValidationError(
          "UNSUPPORTED_TRANSITION",
          `Invalid transitionDurationSec (${String(rawTransitionDurationSec)}). Must be between ${MIN_TRANSITION_DURATION_SEC}s and ${MAX_TRANSITION_DURATION_SEC}s.`,
        );
      }
      if (resolvedType === "crossfade" && params.sceneCount >= 2 && rawTransitionDurationSec >= params.minSceneDurationSec * 0.45) {
        throw new WorkerRenderValidationError(
          "UNSUPPORTED_TRANSITION",
          `Crossfade duration (${rawTransitionDurationSec}s) is too long for shortest scene (${params.minSceneDurationSec}s). Must be less than 45% of scene duration.`,
        );
      }
      transitionDurationSec = roundDuration(rawTransitionDurationSec);
    } else {
      transitionDurationSec =
        resolvedType === "crossfade"
          ? roundDuration(Math.min(defaultDur, params.minSceneDurationSec * 0.35))
          : roundDuration(Math.min(defaultDur, params.minSceneDurationSec * 0.25));
    }
  } else if (rawTransitionDurationSec !== undefined && rawTransitionDurationSec !== null && rawTransitionDurationSec !== 0) {
    throw new WorkerRenderValidationError(
      "UNSUPPORTED_TRANSITION",
      `Transition "cut" does not support non-zero transitionDurationSec.`,
    );
  }

  return { transition: resolvedType, transitionDurationSec };
}

/**
 * Computes synchronized effective duration for a scene given its nominal duration and optional probed voiceover duration.
 * - No voiceover -> keeps nominal scene duration and uses silent audio track.
 * - Shorter voiceover -> keeps nominal scene duration and pads trailing silence.
 * - Longer voiceover -> extends scene duration cleanly to frame boundary so spoken words are never cut off.
 */
export function computeSynchronizedSceneDurationSec(params: {
  nominalDurationSec: number;
  probedAudioDurationSec: number | null;
  fps: number;
}): { targetDurationSec: number; extended: boolean } {
  const { nominalDurationSec, probedAudioDurationSec, fps } = params;
  if (!Number.isFinite(nominalDurationSec) || nominalDurationSec <= 0) {
    throw new WorkerRenderValidationError(
      "INVALID_SCENE_TIMING",
      `Invalid nominal scene duration (${nominalDurationSec}s).`,
    );
  }

  if (probedAudioDurationSec === null) {
    return { targetDurationSec: roundDuration(nominalDurationSec), extended: false };
  }

  if (probedAudioDurationSec > nominalDurationSec + 0.05) {
    // Extend slightly beyond raw audio end so trailing speech decay isn't clipped by AAC frame boundary
    const extendedSec = quantizeUpToFrame(probedAudioDurationSec + 0.04, fps);
    return {
      targetDurationSec: Math.max(roundDuration(nominalDurationSec), extendedSec),
      extended: true,
    };
  }

  return { targetDurationSec: roundDuration(nominalDurationSec), extended: false };
}

/**
 * Probes staged image and optional audio assets for every scene in snapshot order,
 * validates settings/dimensions/transitions, and produces an immutable deterministic RenderExecutionPlan.
 */
export async function probeAndBuildRenderPlan(
  input: RenderVideoToMp4Input,
): Promise<RenderExecutionPlan> {
  if (!(input.aspectRatio in RENDER_ASPECT_DIMENSIONS)) {
    throw new WorkerRenderValidationError(
      "INVALID_RENDER_SETTINGS",
      `Unsupported aspect ratio "${String(input.aspectRatio)}".`,
    );
  }

  const expectedDims = RENDER_ASPECT_DIMENSIONS[input.aspectRatio];
  if (input.width !== expectedDims.width || input.height !== expectedDims.height) {
    throw new WorkerRenderValidationError(
      "INVALID_RENDER_SETTINGS",
      `Render dimensions ${input.width}x${input.height} do not match aspect ratio ${input.aspectRatio} (${expectedDims.width}x${expectedDims.height}).`,
    );
  }

  if (input.fps !== STANDARD_RENDER_FPS) {
    throw new WorkerRenderValidationError(
      "INVALID_RENDER_SETTINGS",
      `Unsupported render frame rate ${input.fps}; expected ${STANDARD_RENDER_FPS} fps.`,
    );
  }

  if (input.outputFormat !== "mp4" || input.videoCodec !== "h264" || input.audioCodec !== "aac") {
    throw new WorkerRenderValidationError(
      "INVALID_RENDER_SETTINGS",
      `Unsupported output codecs (${input.outputFormat}/${input.videoCodec}/${input.audioCodec}). Expected mp4/h264/aac.`,
    );
  }

  if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
    throw new WorkerRenderValidationError(
      "INVALID_SCENE_TIMING",
      "At least one scene is required for video rendering.",
    );
  }

  // Copy and verify order ascending without mutating input array
  const orderedScenes = [...input.scenes].sort((a, b) => a.order - b.order);
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();

  for (const scene of orderedScenes) {
    if (seenIds.has(scene.sceneId)) {
      throw new WorkerRenderValidationError(
        "INVALID_SCENE_TIMING",
        `Duplicate sceneId "${scene.sceneId}" in render input.`,
      );
    }
    seenIds.add(scene.sceneId);

    if (!Number.isInteger(scene.order) || scene.order < 1 || seenOrders.has(scene.order)) {
      throw new WorkerRenderValidationError(
        "INVALID_SCENE_TIMING",
        `Invalid or duplicate scene order ${scene.order}.`,
      );
    }
    seenOrders.add(scene.order);

    if (!Number.isFinite(scene.durationSec) || scene.durationSec < 2 || scene.durationSec > 60) {
      throw new WorkerRenderValidationError(
        "INVALID_SCENE_TIMING",
        `Scene ${scene.order} duration (${scene.durationSec}s) is outside allowed 2s–60s bounds.`,
      );
    }
  }

  // Validate transition settings up-front before spawning FFmpeg
  parseAndValidateTransitionConfig({
    rawTransition: input.transition,
    rawTransitionDurationSec: input.transitionDurationSec,
    sceneCount: orderedScenes.length,
    minSceneDurationSec: Math.min(...orderedScenes.map((s) => s.durationSec)),
    sceneTransitions: orderedScenes.map((s) => s.transition),
  });

  const probedScenes: ProbedRenderSceneAsset[] = [];

  for (let i = 0; i < orderedScenes.length; i++) {
    if (input.signal?.aborted) {
      throw new WorkerFfmpegError("FFMPEG_CANCELLED", "Render cancelled during media probing.");
    }

    const scene = orderedScenes[i];
    if (!scene.imageFilePath?.trim()) {
      throw new WorkerRenderValidationError(
        "MISSING_MEDIA_ASSET",
        `Scene ${scene.order} is missing staged image file path.`,
      );
    }

    const imageProbe = await probeMediaFile({
      ffprobePath: input.ffprobePath,
      filePath: scene.imageFilePath,
      timeoutMs: 15_000,
      signal: input.signal,
      secrets: input.secrets,
      redactDirs: input.redactDirs,
    });

    const imgStream = imageProbe.videoStreams[0];
    if (!imgStream || imgStream.width <= 0 || imgStream.height <= 0) {
      throw new WorkerRenderValidationError(
        "UNREADABLE_MEDIA_INPUT",
        `Scene ${scene.order} staged image could not be decoded as a valid image frame.`,
      );
    }

    let audioFilePath: string | null = null;
    let probedAudioDurationSec: number | null = null;

    if (scene.audioFilePath && scene.audioFilePath.trim()) {
      audioFilePath = scene.audioFilePath;
      const audioProbe = await probeMediaFile({
        ffprobePath: input.ffprobePath,
        filePath: audioFilePath,
        timeoutMs: 15_000,
        signal: input.signal,
        secrets: input.secrets,
        redactDirs: input.redactDirs,
      });

      const audStream = audioProbe.audioStreams[0];
      if (!audStream) {
        throw new WorkerRenderValidationError(
          "UNREADABLE_MEDIA_INPUT",
          `Scene ${scene.order} audio file does not contain a valid audio stream.`,
        );
      }

      const detectedDur =
        audStream.durationSec ??
        audioProbe.durationSec ??
        (scene.declaredAudioDurationSec && scene.declaredAudioDurationSec > 0
          ? scene.declaredAudioDurationSec
          : null);

      if (!detectedDur || detectedDur <= 0) {
        throw new WorkerRenderValidationError(
          "UNREADABLE_MEDIA_INPUT",
          `Scene ${scene.order} audio stream has unknown or zero duration.`,
        );
      }
      probedAudioDurationSec = roundDuration(detectedDur);
    }

    const sync = computeSynchronizedSceneDurationSec({
      nominalDurationSec: scene.durationSec,
      probedAudioDurationSec,
      fps: input.fps,
    });

    const captionCues = buildSceneCaptionCues({
      narration: scene.narration,
      targetDurationSec: sync.targetDurationSec,
      probedAudioDurationSec,
      aspectRatio: input.aspectRatio,
    });

    const infographicDetected = isInfographicContent(scene.title, scene.narration);
    const edgeAnalysis = analyzeImageSafeMargins({
      imageFilePath: scene.imageFilePath,
      ffmpegPath: input.ffmpegPath,
    });
    const safeMarginAnalysis = computeSceneSafeMargin({
      isInfographic: infographicDetected,
      hasTopContent: edgeAnalysis.hasTopContent,
      hasBottomContent: edgeAnalysis.hasBottomContent,
      hasSideContent: edgeAnalysis.hasSideContent,
      config: input.cameraMotionConfig,
    });

    const resolvedCameraMotion = resolveSceneCameraMotion(
      scene.cameraMotion,
      i,
      input.defaultCameraMotion,
      {
        title: scene.title,
        narration: scene.narration,
        isInfographic: infographicDetected,
      },
    );

    probedScenes.push({
      sceneId: scene.sceneId,
      order: scene.order,
      title: scene.title,
      narration: scene.narration,
      nominalDurationSec: scene.durationSec,
      imageFilePath: scene.imageFilePath,
      imageWidth: imgStream.width,
      imageHeight: imgStream.height,
      audioFilePath,
      probedAudioDurationSec,
      audioExtendedFromNominal: sync.extended,
      targetDurationSec: sync.targetDurationSec,
      fadeInSec: 0,
      fadeOutSec: 0,
      captionCues,
      resolvedCameraMotion,
      safeMarginAnalysis,
    });
  }

  // Re-validate transition with actual resolved minimum scene duration & assign edge fades
  const minTargetDuration = Math.min(...probedScenes.map((s) => s.targetDurationSec));
  const finalTransition = parseAndValidateTransitionConfig({
    rawTransition: input.transition,
    rawTransitionDurationSec: input.transitionDurationSec,
    sceneCount: probedScenes.length,
    minSceneDurationSec: minTargetDuration,
    sceneTransitions: orderedScenes.map((s) => s.transition),
  });

  const totalScenes = probedScenes.length;
  for (let i = 0; i < totalScenes; i++) {
    const s = probedScenes[i];
    if (finalTransition.transition === "fade") {
      // Every scene fades in from black and fades out cleanly to black; cap to 25% per end so fades never overlap
      const safeFade = roundDuration(Math.min(finalTransition.transitionDurationSec, s.targetDurationSec * 0.25));
      s.fadeInSec = safeFade;
      s.fadeOutSec = safeFade;
    } else if (finalTransition.transition === "crossfade" && totalScenes === 1) {
      // Single scene with crossfade: smooth start & end fades cleanly handle both first/last scene boundaries
      const safeFade = roundDuration(Math.min(finalTransition.transitionDurationSec, s.targetDurationSec * 0.2));
      s.fadeInSec = safeFade;
      s.fadeOutSec = safeFade;
    }
  }

  const boundaries: PlannedBoundaryTransition[] = [];
  let totalOverlapSec = 0;
  for (let i = 0; i < totalScenes - 1; i++) {
    const cur = probedScenes[i];
    const next = probedScenes[i + 1];
    let overlapSec = 0;
    if (finalTransition.transition === "crossfade") {
      overlapSec = roundDuration(
        Math.min(
          finalTransition.transitionDurationSec,
          Math.min(cur.targetDurationSec, next.targetDurationSec) * 0.35,
        ),
      );
      totalOverlapSec += overlapSec;
    }
    boundaries.push({
      fromSceneOrder: cur.order,
      toSceneOrder: next.order,
      type: finalTransition.transition,
      overlapSec,
    });
  }

  const nominalTotalDurationSec = roundDuration(
    probedScenes.reduce((sum, s) => sum + s.targetDurationSec, 0),
  );
  const expectedFinalDurationSec = roundDuration(
    Math.max(0.5, nominalTotalDurationSec - totalOverlapSec),
  );

  let resolvedWatermark: WatermarkConfig = { ...DEFAULT_WATERMARK_CONFIG };
  if (input.watermark && typeof input.watermark === "object") {
    const rawWm = input.watermark as Record<string, unknown>;
    const enabled = rawWm.enabled !== false;
    const position = (WATERMARK_POSITIONS as readonly string[]).includes(String(rawWm.position))
      ? (rawWm.position as WatermarkPosition)
      : "TOP_RIGHT";
    const size = (WATERMARK_SIZES as readonly string[]).includes(String(rawWm.size))
      ? (rawWm.size as WatermarkSize)
      : "MEDIUM";
    const opacity =
      typeof rawWm.opacity === "number" && !isNaN(rawWm.opacity)
        ? Math.max(0.1, Math.min(1.0, rawWm.opacity))
        : 0.92;
    resolvedWatermark = { enabled, position, size, opacity };
  } else if (input.watermark === false) {
    resolvedWatermark = { ...DEFAULT_WATERMARK_CONFIG, enabled: false };
  }

  const watermarkLogoPath = resolvedWatermark.enabled
    ? resolveWatermarkLogoPath(input.watermarkLogoPath)
    : null;

  const watermarkLayout = calculateWatermarkLayout(
    input.width,
    input.height,
    input.aspectRatio,
    resolvedWatermark,
  );

  return {
    jobId: input.jobId,
    projectId: input.projectId,
    language: input.language?.trim() || null,
    aspectRatio: input.aspectRatio,
    width: input.width,
    height: input.height,
    fps: input.fps,
    transition: finalTransition.transition,
    transitionDurationSec: finalTransition.transitionDurationSec,
    defaultCameraMotion: input.defaultCameraMotion,
    cameraMotionConfig: input.cameraMotionConfig,
    watermark: resolvedWatermark,
    watermarkLayout,
    watermarkLogoPath,
    scenes: probedScenes,
    boundaries,
    nominalTotalDurationSec,
    expectedFinalDurationSec,
    intermediatesDir: input.intermediatesDir,
    outputFilePath: input.outputFilePath,
  };
}

/**
 * Builds FFmpeg video filter strings for camera motion animations (Part C3.5).
 * - "NONE": Uses standard contain + letterbox/pillarbox padding.
 * - Active effects: Pre-scales image to cover the canvas (flags=lanczos), crops to even dimensions,
 *   and applies zoompan with subpixel expressions and exact 30 fps CFR output.
 */
export function buildSceneCameraMotionFilter(params: {
  motion: ResolvedSceneCameraMotion;
  width: number;
  height: number;
  fps: number;
  targetDurationSec: number;
  config?: Partial<CameraMotionConfig>;
  safeArea?: SceneSafeMarginAnalysis;
}): string[] {
  const { motion, width, height, fps, targetDurationSec, safeArea } = params;
  const cfg: CameraMotionConfig = {
    ...DEFAULT_CAMERA_MOTION_CONFIG,
    ...params.config,
  };

  if (motion.effect === "NONE") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    ];
  }

  const totalFrames = Math.max(1, Math.round(targetDurationSec * fps));
  const denom = Math.max(1, totalFrames - 1);
  const isMedium = motion.intensity === "MEDIUM";

  // Configurable cinematic zoom targets with adaptive safe-margin clamping:
  // - Clean scenic images get full dramatic cinematic motion: Subtle 1.15x, Medium 1.22x
  // - Infographics and images with logos/edge text are clamped to safe boundaries: Subtle 1.10x, Medium 1.14x
  const zoomStart = 1.0;
  const subtleMax = safeArea?.safeSubtleZoomMax ?? cfg.subtleZoomMax;
  const mediumMax = safeArea?.safeMediumZoomMax ?? cfg.mediumZoomMax;
  const zoomMax = isMedium ? mediumMax : subtleMax;
  const zoomDelta = Number((zoomMax - zoomStart).toFixed(3));
  const zoomEnd = Number(zoomMax.toFixed(3));
  const defaultPan = isMedium ? cfg.mediumPanZoom : cfg.subtlePanZoom;
  const panZoom = Number((safeArea?.safePanZoom ?? defaultPan).toFixed(3));

  // Focal position anchoring for cinematic framing
  const focal = (motion.focalPosition || "CENTER").toUpperCase();
  let xRatio = focal === "LEFT" ? 0.15 : focal === "RIGHT" ? 0.85 : 0.5;
  let yRatio = focal === "TOP" ? 0.15 : focal === "BOTTOM" ? 0.85 : 0.5;

  // When focal is CENTER (default) and safeArea has top headroom constraints (logos, titles):
  // Anchor yRatio slightly higher (safeArea.safeYRatio, e.g. 0.38) so zoom pushes inward without cropping the top logo/header!
  if (focal === "CENTER" && safeArea?.safeYRatio !== undefined) {
    yRatio = safeArea.safeYRatio;
  }

  // Smooth Hermite smoothstep easing curve: S(t) = t^2 * (3 - 2t)
  const normTime = `(on/${denom})`;
  const smoothStep = `(${normTime}*${normTime}*(3-2*${normTime}))`;

  let zoomExpr = "1.0";
  let xExpr = `(iw-iw/zoom)*${xRatio}`;
  let yExpr = `(ih-ih/zoom)*${yRatio}`;

  switch (motion.effect) {
    case "SLOW_ZOOM_IN":
      zoomExpr = `${zoomStart}+(${zoomDelta}*${smoothStep})`;
      xExpr = `(iw-iw/zoom)*${xRatio}`;
      yExpr = `(ih-ih/zoom)*${yRatio}`;
      break;

    case "SLOW_ZOOM_OUT":
      zoomExpr = `${zoomEnd}-(${zoomDelta}*${smoothStep})`;
      xExpr = `(iw-iw/zoom)*${xRatio}`;
      yExpr = `(ih-ih/zoom)*${yRatio}`;
      break;

    case "PAN_LEFT":
      zoomExpr = String(panZoom);
      xExpr = `(iw-iw/zoom)*(1-${smoothStep})`;
      yExpr = `(ih-ih/zoom)*${yRatio}`;
      break;

    case "PAN_RIGHT":
      zoomExpr = String(panZoom);
      xExpr = `(iw-iw/zoom)*(${smoothStep})`;
      yExpr = `(ih-ih/zoom)*${yRatio}`;
      break;

    case "PAN_UP":
      zoomExpr = String(panZoom);
      xExpr = `(iw-iw/zoom)*${xRatio}`;
      yExpr = `(ih-ih/zoom)*(1-${smoothStep})`;
      break;

    case "PAN_DOWN":
      zoomExpr = String(panZoom);
      xExpr = `(iw-iw/zoom)*${xRatio}`;
      yExpr = `(ih-ih/zoom)*(${smoothStep})`;
      break;
  }

  // 2x Supersampling resolution buffer to eliminate FFmpeg zoompan subpixel integer-truncation jitter (Bug #4298).
  // Scaling to a 2x coordinate buffer allows zoompan to calculate subpixel-accurate crops,
  // which are then downscaled to target width x height with lanczos/bicubic filtering for buttery-smooth motion.
  const superW = width * 2;
  const superH = height * 2;

  return [
    `scale=${superW}:${superH}:force_original_aspect_ratio=increase:flags=lanczos:out_color_matrix=bt709:out_range=tv`,
    `crop=${superW}:${superH}:(iw-${superW})*${xRatio}:(ih-${superH})*${yRatio}`,
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=1:s=${width}x${height}:fps=${fps}`,
  ];
}

/**
 * Builds Stage 1 FFmpeg argument array (no shell interpolation) to normalize a single scene image + optional voiceover
 * into a frame-accurate, non-stretched intermediate MKV (H.264 + sample-exact 48kHz stereo PCM).
 */
export function buildSceneIntermediateFfmpegArgs(params: {
  scene: ProbedRenderSceneAsset;
  width: number;
  height: number;
  fps: number;
  outputIntermediatePath: string;
  assSubtitleFilePath?: string | null;
  cameraMotionConfig?: Partial<CameraMotionConfig>;
}): string[] {
  const { scene, width, height, fps, outputIntermediatePath, assSubtitleFilePath, cameraMotionConfig } = params;
  const durStr = scene.targetDurationSec.toFixed(3);

  const args: string[] = [
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-t",
    durStr,
    "-i",
    scene.imageFilePath,
  ];

  if (scene.audioFilePath) {
    args.push("-i", scene.audioFilePath);
  }

  const motionFilters = buildSceneCameraMotionFilter({
    motion: scene.resolvedCameraMotion,
    width,
    height,
    fps,
    targetDurationSec: scene.targetDurationSec,
    config: cameraMotionConfig,
    safeArea: scene.safeMarginAnalysis,
  });

  // Video filter: Camera motion (zoompan or contain+pad) -> square SAR -> exact CFR -> burned-in ASS captions -> BT.709 yuv420p
  const vFilters: string[] = [
    ...motionFilters,
    "setsar=1",
    `fps=${fps}`,
    `trim=duration=${durStr}`,
    "setpts=PTS-STARTPTS",
  ];

  if (assSubtitleFilePath && assSubtitleFilePath.trim()) {
    vFilters.push(`ass=filename=${escapeFfmpegFilterPathValue(assSubtitleFilePath)}`);
  }

  vFilters.push(
    "format=yuv420p",
    "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709",
  );

  if (scene.fadeInSec > 0) {
    vFilters.push(`fade=t=in:st=0:d=${scene.fadeInSec.toFixed(3)}`);
  }
  if (scene.fadeOutSec > 0) {
    const fadeOutStart = Math.max(0, scene.targetDurationSec - scene.fadeOutSec);
    vFilters.push(`fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${scene.fadeOutSec.toFixed(3)}`);
  }

  const videoChain = `[0:v]${vFilters.join(",")}[vout]`;

  let audioChain: string;
  if (scene.audioFilePath) {
    // Normalize sample rate/channels, limit peaks cleanly to avoid clipping, pad shorter tracks, trim to exact duration
    const audioFadeIn = scene.fadeInSec > 0 ? scene.fadeInSec : 0.015;
    const audioFadeOut = scene.fadeOutSec > 0 ? scene.fadeOutSec : 0.02;
    const audioFadeOutStart = Math.max(0, scene.targetDurationSec - audioFadeOut);

    const aFilters = [
      "asetpts=PTS-STARTPTS",
      "aresample=48000:async=1:first_pts=0",
      "aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo",
      "alimiter=level_in=1:level_out=1:limit=0.95:attack=5:release=50:level=false",
      `apad=whole_dur=${durStr}`,
      `atrim=0:${durStr}`,
      "asetpts=PTS-STARTPTS",
      `afade=t=in:st=0:d=${audioFadeIn.toFixed(3)}`,
      `afade=t=out:st=${audioFadeOutStart.toFixed(3)}:d=${audioFadeOut.toFixed(3)}`,
    ];
    audioChain = `[1:a]${aFilters.join(",")}[aout]`;
  } else {
    // Synthesize exact-duration silent stereo 48kHz audio track when optional audio is omitted
    audioChain = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${durStr},asetpts=PTS-STARTPTS[aout]`;
  }

  args.push(
    "-filter_complex",
    `${videoChain};${audioChain}`,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-t",
    durStr,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-g",
    String(fps),
    "-keyint_min",
    String(fps),
    "-sc_threshold",
    "0",
    "-c:a",
    "pcm_s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "matroska",
    "-y",
    outputIntermediatePath,
  );

  return args;
}

/**
 * Builds Stage 2 FFmpeg argument array (no shell interpolation) to assemble intermediate scene
 * segments with the validated transition mode ("cut", "fade", or "crossfade") into the final
 * standardized H.264/AAC yuv420p MP4 with `+faststart`.
 */
export function buildAssemblyFfmpegArgs(params: {
  plan: RenderExecutionPlan;
  intermediatePaths: readonly string[];
  tempMp4OutputPath: string;
}): string[] {
  const { plan, intermediatePaths, tempMp4OutputPath } = params;
  const n = intermediatePaths.length;

  const args: string[] = [];
  for (const p of intermediatePaths) {
    args.push("-i", p);
  }

  const wmLayout = plan.watermarkLayout;
  const applyWatermark = Boolean(wmLayout && wmLayout.enabled && plan.watermarkLogoPath);

  if (applyWatermark && plan.watermarkLogoPath) {
    args.push("-i", plan.watermarkLogoPath);
  }

  const filterParts: string[] = [];
  const assembledVLabel = applyWatermark ? "v_assembled" : "vout";

  if (n === 1) {
    filterParts.push(
      `[0:v]fps=${plan.fps},setpts=PTS-STARTPTS,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[${assembledVLabel}]`,
      "[0:a]asetpts=PTS-STARTPTS[aout]",
    );
  } else if (plan.transition === "cut" || plan.transition === "fade") {
    const concatInputs: string[] = [];
    for (let i = 0; i < n; i++) {
      filterParts.push(`[${i}:v]fps=${plan.fps},settb=1/${plan.fps},setpts=PTS-STARTPTS[vn${i}]`);
      filterParts.push(`[${i}:a]asetpts=PTS-STARTPTS[an${i}]`);
      concatInputs.push(`[vn${i}][an${i}]`);
    }
    filterParts.push(`${concatInputs.join("")}concat=n=${n}:v=1:a=1[vconcat][aout]`);
    filterParts.push(
      `[vconcat]format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[${assembledVLabel}]`,
    );
  } else {
    // Crossfade transition chained reliably with identical frame rates & timebases across inputs
    for (let i = 0; i < n; i++) {
      filterParts.push(`[${i}:v]fps=${plan.fps},settb=1/${plan.fps},setpts=PTS-STARTPTS[vn${i}]`);
      filterParts.push(`[${i}:a]asetpts=PTS-STARTPTS[an${i}]`);
    }

    let prevVLabel = "vn0";
    let prevALabel = "an0";
    let cumulativeTimelineSec = plan.scenes[0].targetDurationSec;

    for (let i = 0; i < n - 1; i++) {
      const boundary = plan.boundaries[i];
      const overlap = boundary?.overlapSec ?? DEFAULT_CROSSFADE_DURATION_SEC;
      const offset = Math.max(0.05, roundDuration(cumulativeTimelineSec - overlap));
      const isLast = i === n - 2;
      const nextVLabel = isLast ? "vxf" : `vx${i + 1}`;
      const nextALabel = isLast ? "axf" : `ax${i + 1}`;

      filterParts.push(
        `[${prevVLabel}][vn${i + 1}]xfade=transition=fade:duration=${overlap.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVLabel}]`,
      );
      filterParts.push(
        `[${prevALabel}][an${i + 1}]acrossfade=d=${overlap.toFixed(3)}:c1=tri:c2=tri[${nextALabel}]`,
      );

      prevVLabel = nextVLabel;
      prevALabel = nextALabel;
      cumulativeTimelineSec = roundDuration(
        cumulativeTimelineSec + plan.scenes[i + 1].targetDurationSec - overlap,
      );
    }

    filterParts.push(
      `[${prevVLabel}]format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[${assembledVLabel}]`,
    );
    filterParts.push(`[${prevALabel}]asetpts=PTS-STARTPTS[aout]`);
  }

  // Stage 2 Watermark Overlay: burned permanently onto the assembled video canvas
  if (applyWatermark && wmLayout) {
    const wmInputIdx = n;
    filterParts.push(
      `[${wmInputIdx}:v]scale=${wmLayout.logoWidth}:${wmLayout.logoHeight}:flags=lanczos,format=rgba,colorchannelmixer=aa=${wmLayout.opacity.toFixed(2)}[wm]`,
      `[${assembledVLabel}][wm]overlay=x=${wmLayout.x}:y=${wmLayout.y}:format=auto,format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709[vout]`,
    );
  }

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-maxrate",
    "8M",
    "-bufsize",
    "16M",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-r",
    String(plan.fps),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "-y",
    tempMp4OutputPath,
  );

  return args;
}

/**
 * Renders an ordered list of staged scene images + optional voiceover files into a verified MP4
 * stored inside the per-job temporary workspace.
 * - Cleans up intermediate scene segments immediately after rendering.
 * - Removes partial/invalid outputs on failure or cancellation.
 * - Verifies final MP4 via FFprobe before resolving.
 */
export async function renderVideoToMp4(input: RenderVideoToMp4Input): Promise<RenderedMp4Result> {
  const secrets = input.secrets ?? [];
  const redactDirs = [
    input.intermediatesDir,
    path.dirname(input.outputFilePath),
    ...(input.redactDirs ?? []),
  ];

  const emitProgress = (info: {
    ratio: number;
    phase: "probing" | "rendering_scene" | "assembling" | "verifying";
    sceneOrder?: number;
    totalScenes: number;
    stageLabel: string;
  }) => {
    try {
      input.onRenderProgress?.({
        ...info,
        ratio: Math.min(1, Math.max(0, info.ratio)),
      });
    } catch {
      // Ignore callback issues
    }
  };

  emitProgress({
    ratio: 0.02,
    phase: "probing",
    totalScenes: input.scenes.length,
    stageLabel: "Inspecting staged scene images and audio assets",
  });

  const plan = await probeAndBuildRenderPlan(input);

  await fsPromises.mkdir(plan.intermediatesDir, { recursive: true });
  await fsPromises.mkdir(path.dirname(plan.outputFilePath), { recursive: true });

  const tempMp4Path = `${plan.outputFilePath}.rendering.mp4`;
  const intermediatePaths: string[] = [];

  const totalWorkDurationSec = Math.max(1, plan.nominalTotalDurationSec);
  const timeoutMs = input.timeoutMs ?? 300_000;
  const startedMs = Date.now();
  const remainingTimeoutMs = () => {
    const elapsed = Date.now() - startedMs;
    const left = timeoutMs - elapsed;
    if (left <= 0) {
      throw new WorkerFfmpegError(
        "FFMPEG_TIMEOUT",
        `Video render budget timed out after ${timeoutMs}ms.`,
      );
    }
    return left;
  };

  const cleanupRenderArtifacts = async () => {
    await fsPromises.rm(plan.intermediatesDir, { recursive: true, force: true }).catch(() => {});
    await fsPromises.rm(tempMp4Path, { force: true }).catch(() => {});
  };

  try {
    // Stage 1: Normalize each scene into an isolated intermediate file (0.04 -> 0.78 progress band)
    let accumulatedDurationSec = 0;

    for (let i = 0; i < plan.scenes.length; i++) {
      if (input.signal?.aborted) {
        throw new WorkerFfmpegError("FFMPEG_CANCELLED", "Render cancelled before scene encoding.");
      }

      const scene = plan.scenes[i];
      const sceneFilename = `scene_${String(scene.order).padStart(3, "0")}.mkv`;
      const intermediatePath = path.join(plan.intermediatesDir, sceneFilename);
      intermediatePaths.push(intermediatePath);

      let assSubtitleFilePath: string | null = null;
      if (scene.captionCues.length > 0) {
        const assFilename = `scene_${String(scene.order).padStart(3, "0")}_captions.ass`;
        assSubtitleFilePath = path.join(plan.intermediatesDir, assFilename);
        const assContent = generateSceneAssSubtitleContent({
          cues: scene.captionCues,
          aspectRatio: plan.aspectRatio,
          language: plan.language,
        });
        await fsPromises.writeFile(assSubtitleFilePath, assContent, "utf8");
      }

      const stage1Args = buildSceneIntermediateFfmpegArgs({
        scene,
        width: plan.width,
        height: plan.height,
        fps: plan.fps,
        outputIntermediatePath: intermediatePath,
        assSubtitleFilePath,
        cameraMotionConfig: plan.cameraMotionConfig,
      });

      const sceneWeight = scene.targetDurationSec / totalWorkDurationSec;
      const baseRatio = 0.04 + (accumulatedDurationSec / totalWorkDurationSec) * 0.74;
      const stageLabel = `Rendering scene ${i + 1} of ${plan.scenes.length}`;

      emitProgress({
        ratio: baseRatio,
        phase: "rendering_scene",
        sceneOrder: scene.order,
        totalScenes: plan.scenes.length,
        stageLabel,
      });

      await runFfmpegWithProgress({
        ffmpegPath: input.ffmpegPath,
        args: stage1Args,
        expectedDurationSec: scene.targetDurationSec,
        timeoutMs: remainingTimeoutMs(),
        signal: input.signal,
        secrets,
        redactDirs,
        onProgress: (sample) => {
          if (sample.ratio !== null) {
            const overall = baseRatio + sample.ratio * sceneWeight * 0.74;
            emitProgress({
              ratio: overall,
              phase: "rendering_scene",
              sceneOrder: scene.order,
              totalScenes: plan.scenes.length,
              stageLabel,
            });
          }
        },
      });

      accumulatedDurationSec += scene.targetDurationSec;
    }

    if (input.signal?.aborted) {
      throw new WorkerFfmpegError("FFMPEG_CANCELLED", "Render cancelled before final assembly.");
    }

    // Stage 2: Assemble scenes & apply transition into final MP4 (0.78 -> 0.94 progress band)
    const assemblyStageLabel = "Assembling scenes and encoding final MP4";
    emitProgress({
      ratio: 0.78,
      phase: "assembling",
      totalScenes: plan.scenes.length,
      stageLabel: assemblyStageLabel,
    });

    const stage2Args = buildAssemblyFfmpegArgs({
      plan,
      intermediatePaths,
      tempMp4OutputPath: tempMp4Path,
    });

    await runFfmpegWithProgress({
      ffmpegPath: input.ffmpegPath,
      args: stage2Args,
      expectedDurationSec: plan.expectedFinalDurationSec,
      timeoutMs: remainingTimeoutMs(),
      signal: input.signal,
      secrets,
      redactDirs,
      onProgress: (sample) => {
        if (sample.ratio !== null) {
          emitProgress({
            ratio: 0.78 + sample.ratio * 0.16,
            phase: "assembling",
            totalScenes: plan.scenes.length,
            stageLabel: assemblyStageLabel,
          });
        }
      },
    });

    // Clean up intermediate scene files immediately once assembly completes
    await fsPromises.rm(plan.intermediatesDir, { recursive: true, force: true }).catch(() => {});

    // Stage 3: Verify MP4 integrity via FFprobe before committing final workspace output path
    emitProgress({
      ratio: 0.95,
      phase: "verifying",
      totalScenes: plan.scenes.length,
      stageLabel: "Verifying rendered MP4 streams with FFprobe",
    });

    const probeMetadata = await verifyRenderedMp4Output({
      ffprobePath: input.ffprobePath,
      filePath: tempMp4Path,
      expectedWidth: plan.width,
      expectedHeight: plan.height,
      expectedFps: plan.fps,
      expectedDurationSec: plan.expectedFinalDurationSec,
      requireAudio: true,
      timeoutMs: Math.min(15_000, remainingTimeoutMs()),
      signal: input.signal,
      secrets,
      redactDirs,
    });

    await fsPromises.rename(tempMp4Path, plan.outputFilePath);

    emitProgress({
      ratio: 1,
      phase: "verifying",
      totalScenes: plan.scenes.length,
      stageLabel: "MP4 rendered and verified",
    });

    input.logger?.info("Rendered and verified temporary MP4 output via FFmpeg/FFprobe", {
      jobId: plan.jobId,
      projectId: plan.projectId,
      aspectRatio: plan.aspectRatio,
      width: probeMetadata.width,
      height: probeMetadata.height,
      fps: probeMetadata.fps,
      sceneCount: plan.scenes.length,
      transition: plan.transition,
      renderedDurationSec: probeMetadata.renderedDurationSec,
      fileSizeBytes: probeMetadata.fileSizeBytes,
      outputFilename: path.basename(plan.outputFilePath),
    });

    return {
      outputFilePath: plan.outputFilePath,
      fileSizeBytes: probeMetadata.fileSizeBytes,
      aspectRatio: plan.aspectRatio,
      width: probeMetadata.width,
      height: probeMetadata.height,
      fps: probeMetadata.fps,
      sceneCount: plan.scenes.length,
      transition: plan.transition,
      nominalTotalDurationSec: plan.nominalTotalDurationSec,
      expectedFinalDurationSec: plan.expectedFinalDurationSec,
      renderedDurationSec: probeMetadata.renderedDurationSec,
      intermediatesCleaned: true,
      probeMetadata,
      plan,
    };
  } catch (err) {
    await cleanupRenderArtifacts();
    await fsPromises.rm(plan.outputFilePath, { force: true }).catch(() => {});

    if (err instanceof WorkerFfmpegError || err instanceof WorkerRenderValidationError) {
      throw err;
    }

    const sanitizedMsg = sanitizeFfmpegErrorText(
      err instanceof Error ? err.message : "Unexpected video rendering failure.",
      { secrets, redactDirs },
    );
    throw new WorkerFfmpegError("FFMPEG_EXEC_FAILED", sanitizedMsg);
  }
}

/**
 * High-level helper that converts a staged REBX snapshot workspace into a verified MP4
 * using the immutable snapshot settings (no second configuration system).
 */
export async function renderStagedSnapshotToMp4(params: {
  staged: StagedJobAssetsResult;
  ffmpegStatus: FfmpegEnvironmentStatus;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: readonly string[];
  logger?: WorkerLogger;
  onRenderProgress?: RenderVideoToMp4Input["onRenderProgress"];
}): Promise<RenderedMp4Result> {
  const { staged, ffmpegStatus } = params;
  if (!ffmpegStatus.readyForPartC32Rendering || !ffmpegStatus.ffmpeg.executablePath || !ffmpegStatus.ffprobe.executablePath) {
    throw new WorkerFfmpegError(
      "FFMPEG_UNAVAILABLE",
      `FFmpeg/FFprobe unavailable for rendering (ffmpeg=${ffmpegStatus.ffmpeg.errorCode ?? "ok"}, ffprobe=${ffmpegStatus.ffprobe.errorCode ?? "ok"}).`,
    );
  }

  await staged.ensureRenderDirectories();
  const outputFilePath = staged.allocateOutputMp4Path(staged.jobId);

  const sceneMetadataById = new Map(staged.snapshot.scenes.map((s) => [s.sceneId, s]));
  const scenesInput: RenderEngineSceneInput[] = staged.scenes.map((s) => {
    const snapScene = sceneMetadataById.get(s.sceneId);
    return {
      sceneId: s.sceneId,
      order: s.order,
      title: s.title,
      narration: snapScene?.narration ?? "",
      durationSec: s.durationSec,
      imageFilePath: s.imageFilePath,
      audioFilePath: s.audioFilePath,
      declaredAudioDurationSec: snapScene?.audio.durationSec ?? null,
      transition: snapScene?.transition,
      cameraMotion: snapScene?.cameraMotion,
    };
  });

  return renderVideoToMp4({
    jobId: staged.jobId,
    projectId: staged.projectId,
    language: staged.snapshot.project.language,
    aspectRatio: staged.snapshot.renderSettings.aspectRatio,
    width: staged.snapshot.renderSettings.width,
    height: staged.snapshot.renderSettings.height,
    fps: staged.snapshot.renderSettings.fps,
    outputFormat: staged.snapshot.renderSettings.outputFormat,
    videoCodec: staged.snapshot.renderSettings.videoCodec,
    audioCodec: staged.snapshot.renderSettings.audioCodec,
    totalDurationSec: staged.snapshot.renderSettings.totalDurationSec,
    scenes: scenesInput,
    transition: staged.snapshot.renderSettings.transition,
    transitionDurationSec: staged.snapshot.renderSettings.transitionDurationSec,
    defaultCameraMotion: staged.snapshot.renderSettings.defaultCameraMotion,
    watermark:
      (staged.snapshot.renderSettings as { watermark?: unknown })?.watermark ??
      (staged.snapshot.project as { watermark?: unknown })?.watermark,
    outputFilePath,
    intermediatesDir: staged.intermediatesDir,
    ffmpegPath: ffmpegStatus.ffmpeg.executablePath,
    ffprobePath: ffmpegStatus.ffprobe.executablePath,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    secrets: params.secrets,
    redactDirs: [staged.workspaceDir],
    logger: params.logger,
    onRenderProgress: params.onRenderProgress,
  });
}
