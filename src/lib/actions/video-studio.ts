"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { Prisma } from "@prisma/client";
import {
  cleanupLocalProjectRenderDirBestEffort,
  deleteSceneImage,
  deleteStudioAsset,
  prisma,
  readPrivateStudioAsset,
  requireAdmin,
  uploadPrivateStudioAsset,
  uploadSceneImage,
} from "@/lib/video-studio/deps";
import { summarizeVersionSnapshot, type ProjectVersionSummary } from "@/lib/data/video-studio";
import {
  ACTIVE_RENDER_JOB_STATUSES,
  ASPECT_RATIO_CONFIG,
  PROJECT_STATUSES,
  cancelRenderJobSchema,
  createProjectSchema,
  createRenderJobSchema,
  extractDefaultCameraMotion,
  extractProjectThumbnail,
  extractSceneAudioMap,
  extractSceneCameraMotionMap,
  extractThumbnailPrompt,
  extractWatermarkConfig,
  generateGeminiScriptActionSchema,
  generateSceneVoiceoverInputSchema,
  getRenderJobSchema,
  listRenderJobsSchema,
  mergeDefaultCameraMotion,
  mergeProjectThumbnail,
  mergeSceneAudioMetadata,
  mergeSceneCameraMotion,
  mergeThumbnailPrompt,
  mergeWatermarkConfig,
  resolveSarvamLanguageCode,
  retryRenderJobSchema,
  saveDraftSchema,
  sceneAudioMetadataSchema,
  sceneCameraMotionSchema,
  validateRenderProjectSchema,
  type AspectRatio,
  type ContentCategory,
  type CreateProjectInput,
  type EditorScene,
  type GeminiScriptOutput,
  type GenerateGeminiScriptInput,
  type GenerateSceneVoiceoverInput,
  type Language,
  type ProjectStatus,
  type ProjectThumbnailMetadata,
  type RenderJobSummary,
  type RenderValidationReport,
  type SaveDraftInput,
  type SceneAudioMetadata,
  type SceneCameraMotion,
  type Tone,
} from "@/lib/video-studio/schemas";
import {
  cancelRenderJobForProject,
  createRenderJobForProject,
  getProjectRenderReadiness,
  getRenderJobForProject,
  listRenderJobsForProject,
  retryRenderJobForProject,
} from "@/lib/video-studio/render-jobs";
import {
  extractAssetReferencesFromRenderSnapshot,
  getEquivalentImageRefVariants,
} from "@/lib/video-studio/render-validation";
import { generateGeminiScript, getGeminiModelName, isGeminiConfigured } from "@/lib/video-studio/gemini";
import {
  estimateAudioDurationSec,
  generateSarvamSpeech,
  getAudioMimeType,
  getSarvamConfigStatus,
  isValidAudioSignature,
  type AudioContainerFormat,
} from "@/lib/video-studio/sarvam";
import {
  buildSceneAudioPlaybackUrl,
  buildVersionedProjectJson,
  hashNarrationText,
} from "@/lib/video-studio/script-utils";
import { getSourceSummary, searchSources, type SourceHit } from "@/lib/video-studio/source-adapters";
import { z } from "zod";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
export type { GenerateGeminiScriptInput, GenerateSceneVoiceoverInput };

const MAX_VERSIONS = 50;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const ALLOWED_AUDIO_TYPES: Record<string, AudioContainerFormat> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};
const BASE_ROUTE = "/admin/dashboard/video-studio";

/**
 * Prisma interactive transaction options for Video Studio actions.
 * Overrides the default 5s timeout to 30s with 10s pool wait so multi-scene operations
 * succeed reliably over live cloud database connections with network round-trip latency.
 */
export const STUDIO_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 30000,
} as const;

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Invalid input." };
    }
    if (e instanceof Error) {
      return { ok: false, error: e.message };
    }
    console.error("[video-studio]", e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function isTempSceneId(sceneId: string): boolean {
  return sceneId.startsWith("scene_") || sceneId.startsWith("init_") || sceneId.startsWith("restored_");
}

function isScopedTempStudioAsset(assetUrl: string, projectId: string): boolean {
  const clean = assetUrl.trim().split("?")[0].split("#")[0];
  if (!clean) return false;

  // Local dev path (private admin preview route, private image key, or legacy local path)
  // must match strict video-studio naming scoped to this project
  let localFilename: string | null = null;
  if (clean.startsWith("/api/admin/video-studio/image/")) {
    localFilename = clean.slice("/api/admin/video-studio/image/".length);
  } else if (clean.startsWith("local-private-image:")) {
    localFilename = clean.slice("local-private-image:".length);
  } else if (clean.startsWith("/uploads/video-studio/")) {
    localFilename = clean.slice("/uploads/video-studio/".length);
  }

  if (localFilename !== null) {
    return /^[a-zA-Z0-9._-]+$/.test(localFilename) && localFilename.includes(`_p_${projectId}_`);
  }

  // Remote URL must contain this project's studio folder prefix
  try {
    const parsed = new URL(clean);
    return parsed.pathname.includes(`/video-studio/${projectId}/`);
  } catch {
    return false;
  }
}

/**
 * Deletes an asset from storage only if no remaining VideoScene row AND no active
 * (PENDING / QUEUED / PROCESSING) VideoRenderJob snapshot references it.
 * Protects shared assets across duplicated projects and immutable queued render snapshots.
 */
async function deleteAssetIfUnused(assetUrl: string | null | undefined, excludeSceneId?: string) {
  if (!assetUrl?.trim()) return;

  const variants = getEquivalentImageRefVariants(assetUrl);

  const refCount = await prisma.videoScene.count({
    where: {
      ...(excludeSceneId ? { id: { not: excludeSceneId } } : {}),
      OR: [{ imageUrl: { in: variants } }, { imagePath: { in: variants } }],
    },
  });

  if (refCount > 0) return;

  const activeJobs = await prisma.videoRenderJob.findMany({
    where: { status: { in: [...ACTIVE_RENDER_JOB_STATUSES] } },
    select: { snapshot: true },
  });
  for (const job of activeJobs) {
    const refs = extractAssetReferencesFromRenderSnapshot(job.snapshot);
    if (variants.some((variant) => refs.imageRefs.has(variant))) {
      return; // Preserved for immutable active render job snapshot
    }
  }

  await deleteSceneImage(assetUrl);
}

/**
 * Deletes a private scene audio asset only if no active scene on any project (including
 * duplicated project copies) AND no active render job snapshot still references its storageKey.
 */
async function deleteAudioAssetIfUnused(
  storageKey: string | null | undefined,
  exclude?: { projectId: string; sceneId: string },
) {
  if (!storageKey?.trim()) return;

  const projects = await prisma.videoProject.findMany({
    select: {
      id: true,
      metadata: true,
      scenes: { select: { id: true } },
    },
  });

  for (const p of projects) {
    const activeSceneIds = new Set(p.scenes.map((s) => s.id));
    const audioMap = extractSceneAudioMap(p.metadata);
    for (const [sceneId, audioMeta] of Object.entries(audioMap)) {
      if (exclude && p.id === exclude.projectId && sceneId === exclude.sceneId) {
        continue;
      }
      if (!activeSceneIds.has(sceneId)) {
        continue;
      }
      if (audioMeta.storageKey === storageKey) {
        return; // Shared asset is still referenced elsewhere -> preserve file
      }
    }
  }

  const activeJobs = await prisma.videoRenderJob.findMany({
    where: { status: { in: [...ACTIVE_RENDER_JOB_STATUSES] } },
    select: { snapshot: true },
  });
  for (const job of activeJobs) {
    const refs = extractAssetReferencesFromRenderSnapshot(job.snapshot);
    if (refs.audioKeys.has(storageKey.trim())) {
      return; // Preserved for immutable active render job snapshot
    }
  }

  await deleteStudioAsset(storageKey);
}

async function fetchProjectVersionSummaries(projectId: string): Promise<ProjectVersionSummary[]> {
  const rows = await prisma.videoVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: MAX_VERSIONS,
  });
  return rows.map(summarizeVersionSnapshot);
}

/**
 * Saves a version snapshot to VideoVersion table (capped at latest 50).
 */
async function recordVersionSnapshot(tx: Prisma.TransactionClient, projectId: string, reason: string) {
  const p = await tx.videoProject.findUniqueOrThrow({
    where: { id: projectId },
    include: { scenes: { orderBy: [{ order: "asc" }, { position: "asc" }] } },
  });

  const sceneAudioMap = extractSceneAudioMap(p.metadata);
  const sceneMotionMap = extractSceneCameraMotionMap(p.metadata);
  const defaultCameraMotion = extractDefaultCameraMotion(p.metadata);
  const rawRatio = (p.aspectRatio ?? "16:9") as AspectRatio;
  const scenes: EditorScene[] = p.scenes.map((s, idx) => ({
    id: s.id,
    order: s.order || idx + 1,
    title: s.title,
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    imageUrl: s.imageUrl || s.imagePath || null,
    duration: s.duration || s.durationSec || 6,
    locked: s.locked,
    audio: sceneAudioMap[s.id] ?? null,
    cameraMotion: sceneMotionMap[s.id] ?? defaultCameraMotion,
  }));

  const snapshot = buildVersionedProjectJson({
    projectId: p.id,
    title: p.title,
    category: p.category as ContentCategory,
    status: (p.status === "APPROVED" ? "COMPLETED" : p.status) as ProjectStatus,
    aspectRatio: rawRatio,
    desiredDuration: p.duration,
    targetAudience: p.targetAudience ?? "",
    language: (p.language ?? "English") as Language,
    tone: (p.tone ?? "Professional") as Tone,
    topic: p.topic ?? "",
    defaultCameraMotion,
    scenes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });

  await tx.videoVersion.create({
    data: {
      projectId,
      reason,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  const staleVersions = await tx.videoVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS,
    select: { id: true },
  });

  if (staleVersions.length > 0) {
    await tx.videoVersion.deleteMany({
      where: { id: { in: staleVersions.map((v) => v.id) } },
    });
  }
}

/**
 * Synchronizes scenes in DB with incoming list.
 */
async function syncScenes(
  tx: Prisma.TransactionClient,
  projectId: string,
  scenes: EditorScene[],
  sceneAudioMap: Record<string, SceneAudioMetadata> = {},
) {
  const existingScenes = await tx.videoScene.findMany({
    where: { projectId },
    select: { id: true },
  });
  const existingIdSet = new Set(existingScenes.map((s) => s.id));
  const retainedIds: string[] = [];

  for (let idx = 0; idx < scenes.length; idx++) {
    const s = scenes[idx];
    const order = idx + 1;
    const sceneData = {
      order,
      position: idx,
      title: s.title,
      narration: s.narration ?? "",
      imagePrompt: s.imagePrompt ?? "",
      imageUrl: s.imageUrl ?? null,
      imagePath: s.imageUrl ?? null,
      duration: s.duration || 6,
      durationSec: s.duration || 6,
      locked: s.locked ?? false,
    };

    if (existingIdSet.has(s.id)) {
      await tx.videoScene.update({
        where: { id: s.id, projectId },
        data: sceneData,
      });
      retainedIds.push(s.id);
    } else {
      const created = await tx.videoScene.create({
        data: {
          projectId,
          ...sceneData,
        },
      });
      retainedIds.push(created.id);
    }
  }

  // Delete scenes removed by the user
  const toDelete = existingScenes.filter((s) => !retainedIds.includes(s.id)).map((s) => s.id);
  if (toDelete.length > 0) {
    await tx.videoScene.deleteMany({
      where: { id: { in: toDelete }, projectId },
    });
  }

  const updatedRows = await tx.videoScene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  return updatedRows.map((r, i) => ({
    id: r.id,
    order: r.order || i + 1,
    title: r.title,
    narration: r.narration,
    imagePrompt: r.imagePrompt,
    imageUrl: r.imageUrl || r.imagePath || null,
    duration: r.duration || r.durationSec || 6,
    locked: r.locked,
    audio: sceneAudioMap[r.id] ?? null,
  }));
}

/* ==================== Server Actions ==================== */

/**
 * 1. Create a new video project (Draft)
 */
export async function createProjectAction(input: CreateProjectInput): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const admin = await requireAdmin();
    const parsed = createProjectSchema.parse(input);

    const ratioConfig = ASPECT_RATIO_CONFIG[parsed.aspectRatio] ?? ASPECT_RATIO_CONFIG["16:9"];

    const projectId = await prisma.$transaction(async (tx) => {
      let initialMeta: Record<string, unknown> = {};
      if (parsed.thumbnailPrompt) {
        initialMeta = mergeThumbnailPrompt(initialMeta, parsed.thumbnailPrompt);
      }
      if (parsed.defaultCameraMotion) {
        initialMeta = mergeDefaultCameraMotion(initialMeta, parsed.defaultCameraMotion);
      }
      if (parsed.watermark) {
        initialMeta = mergeWatermarkConfig(initialMeta, parsed.watermark);
      }

      const project = await tx.videoProject.create({
        data: {
          title: parsed.title,
          topic: parsed.topic || "",
          category: parsed.category,
          contentType: parsed.category,
          status: "DRAFT",
          sourceType: parsed.sourceType,
          sourceRefType: parsed.sourceRefType ?? null,
          sourceRefId: parsed.sourceRefId ?? null,
          targetAudience: parsed.targetAudience ?? "",
          language: parsed.language,
          tone: parsed.tone,
          duration: parsed.duration,
          aspectRatio: parsed.aspectRatio,
          resolution: ratioConfig.dimensions.replace(" × ", "x"),
          targetRatios: [parsed.aspectRatio],
          metadata: Object.keys(initialMeta).length > 0 ? (initialMeta as Prisma.InputJsonValue) : undefined,
          createdById: admin.id,
        },
      });

      const initialScenes: EditorScene[] =
        parsed.scenes.length > 0
          ? parsed.scenes
          : [
              {
                id: "init_1",
                order: 1,
                title: "Scene 1: Introduction",
                narration: "",
                imagePrompt: "",
                imageUrl: null,
                duration: 6,
                locked: false,
              },
            ];

      const syncedScenes = await syncScenes(tx, project.id, initialScenes);

      const initialMotionMap: Record<string, SceneCameraMotion> = {};
      for (let idx = 0; idx < initialScenes.length; idx++) {
        const sc = initialScenes[idx];
        const synced = syncedScenes[idx];
        if (sc.cameraMotion && synced) {
          initialMotionMap[synced.id] = sc.cameraMotion;
        }
      }
      if (Object.keys(initialMotionMap).length > 0) {
        const freshProject = await tx.videoProject.findUniqueOrThrow({ where: { id: project.id } });
        const updatedMeta = mergeSceneCameraMotion(freshProject.metadata, initialMotionMap);
        await tx.videoProject.update({
          where: { id: project.id },
          data: { metadata: updatedMeta as Prisma.InputJsonValue },
        });
      }

      await recordVersionSnapshot(tx, project.id, "Initial Draft Created");
      return project.id;
    }, STUDIO_TRANSACTION_OPTIONS);

    revalidatePath(BASE_ROUTE);
    return { id: projectId };
  });
}

/**
 * 2. Save / Update an existing draft (Updates existing project instead of creating duplicate)
 */
export async function saveDraftAction(
  input: SaveDraftInput,
): Promise<ActionResult<{ scenes: EditorScene[]; versions: ProjectVersionSummary[] }>> {
  return run(async () => {
    await requireAdmin();
    const parsed = saveDraftSchema.parse(input);

    const existingProject = await prisma.videoProject.findUnique({
      where: { id: parsed.projectId },
      select: { id: true, metadata: true },
    });
    if (!existingProject) {
      throw new Error("Project not found.");
    }

    const oldAudioMap = extractSceneAudioMap(existingProject.metadata);
    const oldMotionMap = extractSceneCameraMotionMap(existingProject.metadata);

    const oldScenes = await prisma.videoScene.findMany({
      where: { projectId: parsed.projectId },
      select: { imageUrl: true, imagePath: true },
    });
    const oldUrls = new Set(
      oldScenes.map((s) => s.imageUrl || s.imagePath).filter((u): u is string => Boolean(u)),
    );

    const ratioConfig = ASPECT_RATIO_CONFIG[parsed.aspectRatio] ?? ASPECT_RATIO_CONFIG["16:9"];

    const scenes = await prisma.$transaction(async (tx) => {
      const updatedScenes = await syncScenes(tx, parsed.projectId, parsed.scenes, oldAudioMap);
      const retainedSceneIds = new Set(updatedScenes.map((s) => s.id));
      const nextAudioMap: Record<string, SceneAudioMetadata> = {};
      const nextMotionMap: Record<string, SceneCameraMotion> = {};

      for (let idx = 0; idx < updatedScenes.length; idx++) {
        const s = updatedScenes[idx];
        if (oldAudioMap[s.id]) {
          nextAudioMap[s.id] = oldAudioMap[s.id];
        }
        const incoming = parsed.scenes.find((sc) => sc.id === s.id) ?? parsed.scenes[idx];
        if (incoming?.cameraMotion) {
          nextMotionMap[s.id] = incoming.cameraMotion;
        } else if (oldMotionMap[s.id]) {
          nextMotionMap[s.id] = oldMotionMap[s.id];
        }
      }

      let nextMetadata = mergeSceneAudioMetadata(existingProject.metadata, nextAudioMap);
      nextMetadata = mergeSceneCameraMotion(nextMetadata, nextMotionMap);
      if (parsed.defaultCameraMotion !== undefined) {
        nextMetadata = mergeDefaultCameraMotion(nextMetadata, parsed.defaultCameraMotion);
      }
      if (parsed.thumbnailPrompt !== undefined) {
        nextMetadata = mergeThumbnailPrompt(nextMetadata, parsed.thumbnailPrompt);
      }
      if (parsed.watermark !== undefined) {
        nextMetadata = mergeWatermarkConfig(nextMetadata, parsed.watermark);
      }

      await tx.videoProject.update({
        where: { id: parsed.projectId },
        data: {
          title: parsed.title,
          topic: parsed.topic || "",
          category: parsed.category,
          contentType: parsed.category,
          status: parsed.status,
          targetAudience: parsed.targetAudience ?? "",
          language: parsed.language,
          tone: parsed.tone,
          duration: parsed.duration,
          aspectRatio: parsed.aspectRatio,
          resolution: ratioConfig.dimensions.replace(" × ", "x"),
          targetRatios: [parsed.aspectRatio],
          metadata: nextMetadata as Prisma.InputJsonValue,
        },
      });

      await recordVersionSnapshot(tx, parsed.projectId, "Saved changes");
      return updatedScenes.map((s) => ({
        ...s,
        cameraMotion: nextMotionMap[s.id] ?? null,
      }));
    }, STUDIO_TRANSACTION_OPTIONS);

    const retainedUrls = new Set(scenes.map((s) => s.imageUrl).filter((u): u is string => Boolean(u)));
    for (const oldUrl of oldUrls) {
      if (!retainedUrls.has(oldUrl)) {
        await deleteAssetIfUnused(oldUrl).catch((err) => {
          console.error("[video-studio] Cleanup error after draft save:", err);
        });
      }
    }

    const retainedIdsAfterSave = new Set(scenes.map((s) => s.id));
    for (const [oldSceneId, oldAudio] of Object.entries(oldAudioMap)) {
      if (!retainedIdsAfterSave.has(oldSceneId) && oldAudio.storageKey) {
        await deleteAudioAssetIfUnused(oldAudio.storageKey).catch((err) => {
          console.error("[video-studio] Audio cleanup error after draft save:", err);
        });
      }
    }

    const versions = await fetchProjectVersionSummaries(parsed.projectId);

    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return { scenes, versions };
  });
}

/**
 * 3. Duplicate Project
 */
export async function duplicateProjectAction(projectId: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const admin = await requireAdmin();

    const existing = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { scenes: { orderBy: { order: "asc" } } },
    });

    if (!existing) throw new Error("Project not found.");

    const newProject = await prisma.$transaction(async (tx) => {
      const cloned = await tx.videoProject.create({
        data: {
          title: `${existing.title} (Copy)`,
          topic: existing.topic,
          category: existing.category,
          contentType: existing.contentType,
          status: "DRAFT",
          sourceType: existing.sourceType,
          sourceRefType: existing.sourceRefType,
          sourceRefId: existing.sourceRefId,
          targetAudience: existing.targetAudience,
          language: existing.language,
          tone: existing.tone,
          duration: existing.duration,
          aspectRatio: existing.aspectRatio,
          resolution: existing.resolution,
          metadata: existing.metadata ?? undefined,
          targetRatios: existing.targetRatios ?? undefined,
          createdById: admin.id,
        },
      });

      const sceneIdMap = new Map<string, string>();
      for (let i = 0; i < existing.scenes.length; i++) {
        const s = existing.scenes[i];
        const clonedScene = await tx.videoScene.create({
          data: {
            projectId: cloned.id,
            order: i + 1,
            position: i,
            title: s.title,
            narration: s.narration,
            imagePrompt: s.imagePrompt,
            imageUrl: s.imageUrl,
            imagePath: s.imagePath,
            duration: s.duration,
            durationSec: s.durationSec,
            locked: false,
          },
        });
        sceneIdMap.set(s.id, clonedScene.id);
      }

      const existingAudioMap = extractSceneAudioMap(existing.metadata);
      if (Object.keys(existingAudioMap).length > 0) {
        const clonedAudioMap: Record<string, SceneAudioMetadata> = {};
        const rev = String(Date.now());
        for (const [oldSceneId, oldMeta] of Object.entries(existingAudioMap)) {
          const newSceneId = sceneIdMap.get(oldSceneId);
          if (newSceneId) {
            clonedAudioMap[newSceneId] = {
              ...oldMeta,
              audioUrl: buildSceneAudioPlaybackUrl(cloned.id, newSceneId, rev),
            };
          }
        }
        await tx.videoProject.update({
          where: { id: cloned.id },
          data: {
            metadata: mergeSceneAudioMetadata(existing.metadata, clonedAudioMap) as Prisma.InputJsonValue,
          },
        });
      }

      await recordVersionSnapshot(tx, cloned.id, "Duplicated from " + existing.title);
      return cloned;
    }, STUDIO_TRANSACTION_OPTIONS);

    revalidatePath(BASE_ROUTE);
    return { id: newProject.id };
  });
}

/**
 * 4. Delete Project (with cascade and reference-checked storage cleanup)
 */
export async function deleteProjectAction(projectId: string): Promise<ActionResult<{ success: boolean }>> {
  return run(async () => {
    await requireAdmin();

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) throw new Error("Project not found.");

    const scenes = await prisma.videoScene.findMany({
      where: { projectId },
      select: { imageUrl: true, imagePath: true },
    });

    const renderJobs = await prisma.videoRenderJob.findMany({
      where: { projectId },
      select: { id: true, snapshot: true, outputStorageKey: true, outputMetadata: true },
    });

    const assetUrlSet = new Set(
      scenes.map((s) => s.imageUrl || s.imagePath).filter((u): u is string => Boolean(u)),
    );
    const customThumb = extractProjectThumbnail(project.metadata);
    const audioKeySet = new Set(
      Object.values(extractSceneAudioMap(project.metadata))
        .map((a) => a.storageKey)
        .filter((k): k is string => Boolean(k)),
    );
    const renderOutputKeySet = new Set<string>();
    const projectRenderPrefix = `video-studio/${projectId}/renders/render_`;

    for (const job of renderJobs) {
      if (typeof job.outputStorageKey === "string" && job.outputStorageKey.trim()) {
        renderOutputKeySet.add(job.outputStorageKey.trim());
      }
      const meta = job.outputMetadata as {
        uploadedOutputKey?: unknown;
        targetOutputKey?: unknown;
      } | null;
      for (const candidateRaw of [meta?.uploadedOutputKey, meta?.targetOutputKey]) {
        if (typeof candidateRaw === "string") {
          const candidate = candidateRaw.trim();
          if (
            candidate.startsWith(projectRenderPrefix) &&
            candidate.endsWith(".mp4") &&
            !candidate.includes("..") &&
            !candidate.includes("\\")
          ) {
            renderOutputKeySet.add(candidate);
          }
        }
      }
      const snap = job.snapshot as {
        scenes?: { image?: { sourceUrl?: unknown }; audio?: { storageKey?: unknown } }[];
        project?: { scenes?: { imageUrl?: unknown; audio?: { storageKey?: unknown } }[] };
      } | null;

      if (Array.isArray(snap?.scenes)) {
        for (const s of snap.scenes) {
          if (typeof s?.image?.sourceUrl === "string" && s.image.sourceUrl.trim()) {
            assetUrlSet.add(s.image.sourceUrl.trim());
          }
          if (typeof s?.audio?.storageKey === "string" && s.audio.storageKey.trim()) {
            audioKeySet.add(s.audio.storageKey.trim());
          }
        }
      }
      if (Array.isArray(snap?.project?.scenes)) {
        for (const s of snap.project.scenes) {
          if (typeof s?.imageUrl === "string" && s.imageUrl.trim()) {
            assetUrlSet.add(s.imageUrl.trim());
          }
          if (typeof s?.audio?.storageKey === "string" && s.audio.storageKey.trim()) {
            audioKeySet.add(s.audio.storageKey.trim());
          }
        }
      }
    }

    const uniqueAssetUrls = Array.from(assetUrlSet);
    const uniqueAudioKeys = Array.from(audioKeySet);
    const uniqueRenderOutputKeys = Array.from(renderOutputKeySet);

    await prisma.videoProject.delete({
      where: { id: projectId },
    });

    for (const url of uniqueAssetUrls) {
      await deleteAssetIfUnused(url).catch((err) => {
        console.error("[video-studio] Asset cleanup error after project delete:", err);
      });
    }

    for (const key of uniqueAudioKeys) {
      await deleteAudioAssetIfUnused(key).catch((err) => {
        console.error("[video-studio] Audio cleanup error after project delete:", err);
      });
    }

    if (customThumb?.storageKey) {
      await deleteStudioAsset(customThumb.storageKey).catch((err) => {
        console.error("[video-studio] Thumbnail cleanup error after project delete:", err);
      });
    }

    for (const outKey of uniqueRenderOutputKeys) {
      await deleteSceneImage(outKey).catch((err) => {
        console.error("[video-studio] Render output cleanup error after project delete:", err);
      });
    }

    await cleanupLocalProjectRenderDirBestEffort(projectId).catch((err) => {
      console.error("[video-studio] Render directory cleanup error after project delete:", err);
    });

    revalidatePath(BASE_ROUTE);
    return { success: true };
  });
}

/**
 * Delete a specific scene image safely (verifies project/scene ownership & preserves shared project copies)
 */
export async function deleteSceneImageAction(params: {
  projectId: string;
  sceneId: string;
  imageUrl?: string;
}): Promise<ActionResult<{ success: boolean }>> {
  return run(async () => {
    await requireAdmin();

    const project = await prisma.videoProject.findUnique({
      where: { id: params.projectId },
      select: { id: true },
    });
    if (!project) throw new Error("Project not found.");

    if (!isTempSceneId(params.sceneId)) {
      const scene = await prisma.videoScene.findFirst({
        where: { id: params.sceneId, projectId: params.projectId },
        select: { id: true, imageUrl: true, imagePath: true },
      });
      if (!scene) {
        throw new Error("Scene not found in this project.");
      }

      const authoritativeUrl = scene.imageUrl || scene.imagePath;
      if (authoritativeUrl) {
        // Delete physical file only if no other scene (including duplicated projects) still uses it.
        // Run storage delete before clearing DB row so remote delete errors leave state consistent.
        await deleteAssetIfUnused(authoritativeUrl, scene.id);

        await prisma.videoScene.update({
          where: { id: scene.id },
          data: { imageUrl: null, imagePath: null },
        });
      }
    } else if (params.imageUrl) {
      if (!isScopedTempStudioAsset(params.imageUrl, params.projectId)) {
        throw new Error("Invalid scene image reference.");
      }
      await deleteAssetIfUnused(params.imageUrl);
    }

    revalidatePath(`${BASE_ROUTE}/${params.projectId}`);
    return { success: true };
  });
}

/**
 * 5. Upload or replace an image for a specific scene (cleans up unused previous asset & failed DB writes)
 */
export async function uploadSceneImageAction(formData: FormData): Promise<ActionResult<{ imageUrl: string }>> {
  return run(async () => {
    await requireAdmin();

    const projectId = formData.get("projectId")?.toString();
    const sceneId = formData.get("sceneId")?.toString();
    const file = formData.get("file") as File | null;
    const clientPreviousUrl = formData.get("previousImageUrl")?.toString() || null;

    if (!projectId || !sceneId || !file) {
      throw new Error("Missing project, scene, or image file.");
    }

    if (!ALLOWED_IMAGE_TYPES[file.type]) {
      throw new Error("Please upload a JPG, PNG, or WebP image.");
    }

    if (file.size <= 0) {
      throw new Error("Uploaded image file is empty.");
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Image must be under 10 MB.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    let previousUrl: string | null = null;
    const persistedScene = !isTempSceneId(sceneId);

    if (persistedScene) {
      const existingScene = await prisma.videoScene.findFirst({
        where: { id: sceneId, projectId },
        select: { id: true, imageUrl: true, imagePath: true },
      });
      if (!existingScene) {
        throw new Error("Scene not found in this project.");
      }
      previousUrl = existingScene.imageUrl || existingScene.imagePath;
    } else if (clientPreviousUrl && isScopedTempStudioAsset(clientPreviousUrl, projectId)) {
      previousUrl = clientPreviousUrl;
    }

    const ext = ALLOWED_IMAGE_TYPES[file.type] || "jpg";
    const storageKey = `video-studio/${projectId}/scene_${sceneId}_p_${projectId}_${Date.now()}.${ext}`;
    const imageUrl = await uploadSceneImage(file, storageKey);

    if (persistedScene) {
      try {
        await prisma.videoScene.update({
          where: { id: sceneId },
          data: { imageUrl, imagePath: imageUrl },
        });
      } catch (dbError) {
        // Rollback newly uploaded storage file so failed uploads never leave orphans
        await deleteSceneImage(imageUrl).catch(() => {});
        throw dbError;
      }
    }

    if (previousUrl && previousUrl !== imageUrl) {
      await deleteAssetIfUnused(previousUrl).catch((err) => {
        console.error("[video-studio] Previous image cleanup failed:", err);
      });
    }

    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { imageUrl };
  });
}

/**
 * 6. Bulk upload multiple images and assign sequentially to scenes without images
 */
export async function bulkUploadImagesAction(formData: FormData): Promise<
  ActionResult<{
    scenes: EditorScene[];
    assignments: { sceneId: string; imageUrl: string }[];
    assigned: number;
    skipped: number;
  }>
> {
  return run(async () => {
    await requireAdmin();

    const projectId = formData.get("projectId")?.toString();
    const files = formData.getAll("files") as File[];
    const sceneIdsRaw = formData.get("sceneIds")?.toString();

    if (!projectId || !files.length) {
      throw new Error("No images provided for upload.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES[file.type]) {
        throw new Error(`Invalid file type (${file.type}). JPG, PNG, or WebP required.`);
      }
      if (file.size <= 0) {
        throw new Error(`File ${file.name} is empty.`);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new Error(`File ${file.name} exceeds the 10 MB limit.`);
      }
    }

    const currentScenes = await prisma.videoScene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });

    let targetScenes = currentScenes.filter((s) => !s.imageUrl && !s.imagePath);
    if (sceneIdsRaw) {
      let requestedIds: string[] = [];
      try {
        const parsed = JSON.parse(sceneIdsRaw);
        if (Array.isArray(parsed)) {
          requestedIds = parsed.map(String);
        }
      } catch {
        throw new Error("Invalid sceneIds parameter.");
      }

      const byId = new Map(currentScenes.map((s) => [s.id, s]));
      targetScenes = [];
      for (const id of requestedIds) {
        const match = byId.get(id);
        if (!match) {
          throw new Error("Requested target scene does not belong to this project.");
        }
        targetScenes.push(match);
      }
    }

    let assigned = 0;
    const assignments: { sceneId: string; imageUrl: string }[] = [];

    for (let i = 0; i < targetScenes.length && i < files.length; i++) {
      const scene = targetScenes[i];
      const file = files[i];
      const ext = ALLOWED_IMAGE_TYPES[file.type] || "jpg";
      const storageKey = `video-studio/${projectId}/scene_${scene.id}_p_${projectId}_bulk_${Date.now()}_${i}.${ext}`;
      const url = await uploadSceneImage(file, storageKey);

      try {
        await prisma.videoScene.update({
          where: { id: scene.id },
          data: { imageUrl: url, imagePath: url },
        });
      } catch (dbErr) {
        await deleteSceneImage(url).catch(() => {});
        throw dbErr;
      }

      assignments.push({ sceneId: scene.id, imageUrl: url });
      assigned++;
    }

    const skipped = files.length > assigned ? files.length - assigned : 0;

    const freshRows = await prisma.videoScene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });

    const sceneAudioMap = extractSceneAudioMap(project.metadata);
    const updatedScenes: EditorScene[] = freshRows.map((r, i) => ({
      id: r.id,
      order: r.order || i + 1,
      title: r.title,
      narration: r.narration,
      imagePrompt: r.imagePrompt,
      imageUrl: r.imageUrl || r.imagePath || null,
      duration: r.duration || r.durationSec || 6,
      locked: r.locked,
      audio: sceneAudioMap[r.id] ?? null,
    }));

    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { scenes: updatedScenes, assignments, assigned, skipped };
  });
}

/**
 * 6b. Upload or replace a custom project thumbnail
 */
export async function uploadProjectThumbnailAction(
  formData: FormData,
): Promise<ActionResult<{ thumbnail: ProjectThumbnailMetadata }>> {
  return run(async () => {
    await requireAdmin();

    const projectId = formData.get("projectId")?.toString()?.trim();
    const file = formData.get("file") as File | null;

    if (!projectId || !file) {
      throw new Error("Missing project ID or thumbnail image file.");
    }

    if (!ALLOWED_IMAGE_TYPES[file.type]) {
      throw new Error("Please upload a JPG, PNG, or WebP image.");
    }

    if (file.size <= 0) {
      throw new Error("Uploaded thumbnail file is empty.");
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error("Thumbnail must be under 10 MB.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const oldThumbnail = extractProjectThumbnail(project.metadata);
    const ext = ALLOWED_IMAGE_TYPES[file.type] || "jpg";
    const storageKey = `video-studio/${projectId}/thumbnails/thumb_${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const uploadedStorageKey = await uploadPrivateStudioAsset({
      buffer,
      contentType: file.type,
      key: storageKey,
      cacheControl: "private, no-store",
    });

    const thumbnailMeta: ProjectThumbnailMetadata = {
      storageKey: uploadedStorageKey,
      url: `/api/admin/video-studio/projects/${projectId}/thumbnail`,
      mimeType: file.type,
      fileSizeBytes: file.size,
      uploadedAt: new Date().toISOString(),
      isCustom: true,
    };

    const nextMetadata = mergeProjectThumbnail(project.metadata, thumbnailMeta);
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    if (oldThumbnail?.storageKey && oldThumbnail.storageKey !== uploadedStorageKey) {
      await deleteStudioAsset(oldThumbnail.storageKey).catch((err) => {
        console.error("[video-studio] Previous thumbnail cleanup failed:", err);
      });
    }

    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { thumbnail: thumbnailMeta };
  });
}

/**
 * 6c. Remove a custom project thumbnail (reverts to auto-generated frame)
 */
export async function removeProjectThumbnailAction(
  projectId: string,
): Promise<ActionResult<{ success: true }>> {
  return run(async () => {
    await requireAdmin();

    const cleanProjectId = projectId?.trim();
    if (!cleanProjectId) {
      throw new Error("Missing project ID.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: cleanProjectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const oldThumbnail = extractProjectThumbnail(project.metadata);
    if (oldThumbnail?.storageKey) {
      await deleteStudioAsset(oldThumbnail.storageKey).catch((err) => {
        console.error("[video-studio] Thumbnail cleanup failed:", err);
      });
    }

    const nextMetadata = mergeProjectThumbnail(project.metadata, null);
    await prisma.videoProject.update({
      where: { id: cleanProjectId },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    revalidatePath(`${BASE_ROUTE}/${cleanProjectId}`);
    return { success: true };
  });
}

/**
 * 6d. Update project thumbnail prompt
 */
export async function updateThumbnailPromptAction(
  projectId: string,
  prompt: string,
): Promise<ActionResult<{ thumbnailPrompt: string }>> {
  return run(async () => {
    await requireAdmin();

    const cleanProjectId = projectId?.trim();
    if (!cleanProjectId) {
      throw new Error("Missing project ID.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: cleanProjectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const nextMetadata = mergeThumbnailPrompt(project.metadata, prompt);
    await prisma.videoProject.update({
      where: { id: cleanProjectId },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    revalidatePath(`${BASE_ROUTE}/${cleanProjectId}`);
    return { thumbnailPrompt: prompt.trim() };
  });
}

/**
 * 7. Restore an older project version snapshot (enforces project existence and snapshot ownership)
 */
export async function restoreVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult<{ scenes: EditorScene[]; versions: ProjectVersionSummary[] }>> {
  return run(async () => {
    await requireAdmin();

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const version = await prisma.videoVersion.findUnique({
      where: { id: versionId },
    });

    if (!version || !version.snapshot) {
      throw new Error("Version snapshot not found.");
    }

    if (version.projectId !== projectId) {
      throw new Error("Unauthorized: Version snapshot does not belong to this project.");
    }

    const snapshot = version.snapshot as Record<string, unknown>;
    const rawScenes = Array.isArray(snapshot.scenes) ? (snapshot.scenes as Record<string, unknown>[]) : [];

    if (rawScenes.length === 0) {
      throw new Error("Snapshot contains no scenes to restore.");
    }

    const previousAudioMap = extractSceneAudioMap(project.metadata);

    const restoredScenes: EditorScene[] = rawScenes.map((s, idx) => {
      const parsedAudio = sceneAudioMetadataSchema.safeParse(s.audio);
      const parsedMotion = s.cameraMotion ? sceneCameraMotionSchema.safeParse(s.cameraMotion) : null;
      return {
        id: String(s.id || `restored_${idx}`),
        order: Number(s.order || idx + 1),
        title: String(s.title || `Scene ${idx + 1}`).slice(0, 255),
        narration: String(s.narration || "").slice(0, 2500),
        imagePrompt: String(s.imagePrompt || "").slice(0, 2500),
        imageUrl: s.imageUrl ? String(s.imageUrl) : null,
        duration: Math.min(60, Math.max(2, Math.round(Number(s.duration || 6)))),
        locked: Boolean(s.locked),
        audio: parsedAudio.success ? parsedAudio.data : null,
        cameraMotion: parsedMotion?.success ? parsedMotion.data : null,
      };
    });

    const scenes = await prisma.$transaction(async (tx) => {
      const synced = await syncScenes(tx, projectId, restoredScenes);
      const restoredAudioMap: Record<string, SceneAudioMetadata> = {};
      const restoredMotionMap: Record<string, SceneCameraMotion> = {};
      const rev = `${Date.now()}_${randomBytes(3).toString("hex")}`;

      const withRestoredAudio: EditorScene[] = synced.map((syncedScene, idx) => {
        const snapshotAudio = restoredScenes[idx]?.audio ?? null;
        const snapshotMotion = restoredScenes[idx]?.cameraMotion ?? null;
        if (snapshotMotion) {
          restoredMotionMap[syncedScene.id] = snapshotMotion;
        }
        if (!snapshotAudio) {
          return { ...syncedScene, audio: null, cameraMotion: snapshotMotion };
        }
        const meta: SceneAudioMetadata = {
          ...snapshotAudio,
          audioUrl: buildSceneAudioPlaybackUrl(projectId, syncedScene.id, rev),
        };
        restoredAudioMap[syncedScene.id] = meta;
        return { ...syncedScene, audio: meta, cameraMotion: snapshotMotion };
      });

      let nextMeta = mergeSceneAudioMetadata(project.metadata, restoredAudioMap);
      nextMeta = mergeSceneCameraMotion(nextMeta, restoredMotionMap);

      await tx.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: nextMeta as Prisma.InputJsonValue,
        },
      });

      await recordVersionSnapshot(tx, projectId, `Restored from snapshot (${version.reason})`);
      return withRestoredAudio;
    }, STUDIO_TRANSACTION_OPTIONS);

    const retainedAudioKeys = new Set(scenes.map((s) => s.audio?.storageKey).filter((k): k is string => Boolean(k)));
    for (const prevAudio of Object.values(previousAudioMap)) {
      if (prevAudio.storageKey && !retainedAudioKeys.has(prevAudio.storageKey)) {
        await deleteAudioAssetIfUnused(prevAudio.storageKey).catch((err) => {
          console.error("[video-studio] Audio cleanup error after restore:", err);
        });
      }
    }

    const versions = await fetchProjectVersionSummaries(projectId);

    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { scenes, versions };
  });
}

/**
 * 8. Status transition (DRAFT -> PROCESSING -> COMPLETED -> FAILED)
 */
export async function updateProjectStatusAction(
  projectId: string,
  status: ProjectStatus,
): Promise<ActionResult<{ status: ProjectStatus }>> {
  return run(async () => {
    await requireAdmin();
    const validStatus = z.enum(PROJECT_STATUSES).parse(status);

    const existing = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!existing) {
      throw new Error("Project not found.");
    }

    await prisma.videoProject.update({
      where: { id: projectId },
      data: {
        status: validStatus,
        ...(validStatus === "COMPLETED" ? { approvedAt: new Date() } : {}),
      },
    });

    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { status: validStatus };
  });
}

/**
 * 9. Content source search and fact extraction
 */
export async function searchSourcesAction(params: { type: string; q: string }): Promise<ActionResult<SourceHit[]>> {
  return run(async () => {
    await requireAdmin();
    return searchSources(params.type, params.q);
  });
}

export async function getSourceSummaryAction(params: {
  type: string;
  id: string;
}): Promise<ActionResult<{ title: string; summary: string }>> {
  return run(async () => {
    await requireAdmin();
    return getSourceSummary(params.type, params.id);
  });
}

/**
 * 10. Gemini script generation & status checks (Phase 2)
 */
export async function checkGeminiStatusAction(): Promise<ActionResult<{ configured: boolean; model: string }>> {
  return run(async () => {
    await requireAdmin();
    return {
      configured: isGeminiConfigured(),
      model: getGeminiModelName(),
    };
  });
}

export async function generateScriptWithGeminiAction(
  input: GenerateGeminiScriptInput,
): Promise<ActionResult<GeminiScriptOutput>> {
  return run(async () => {
    await requireAdmin();
    const parsed = generateGeminiScriptActionSchema.parse(input);
    return generateGeminiScript(parsed);
  });
}

/**
 * 11. Sarvam AI voiceover generation & scene audio management (Phase 3 Part B)
 */
export async function checkSarvamStatusAction(): Promise<
  ActionResult<ReturnType<typeof getSarvamConfigStatus>>
> {
  return run(async () => {
    await requireAdmin();
    return getSarvamConfigStatus();
  });
}

export async function generateSceneVoiceoverAction(
  input: GenerateSceneVoiceoverInput,
): Promise<ActionResult<{ audio: SceneAudioMetadata }>> {
  return run(async () => {
    await requireAdmin();
    const parsed = generateSceneVoiceoverInputSchema.parse(input);

    const project = await prisma.videoProject.findUnique({
      where: { id: parsed.projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const scene = await prisma.videoScene.findFirst({
      where: { id: parsed.sceneId, projectId: parsed.projectId },
      select: { id: true },
    });
    if (!scene) {
      throw new Error("Scene not found in this project. Save new scenes as a draft before generating voiceover.");
    }

    const existingAudioMap = extractSceneAudioMap(project.metadata);
    const previousAudio = existingAudioMap[scene.id] ?? null;

    // Call Sarvam AI before modifying storage or DB: failed calls keep previous audio intact.
    const speech = await generateSarvamSpeech({
      text: parsed.narration,
      language: parsed.language,
      voice: parsed.voice,
      format: parsed.format,
      pace: parsed.pace,
    });

    const revision = `${Date.now()}_${randomBytes(3).toString("hex")}`;
    const storagePathKey = `video-studio/${parsed.projectId}/audio_${scene.id}_p_${parsed.projectId}_${revision}.${speech.format}`;

    const storedKey = await uploadPrivateStudioAsset({
      buffer: speech.buffer,
      contentType: speech.mimeType,
      key: storagePathKey,
    });

    const audioMeta: SceneAudioMetadata = {
      audioUrl: buildSceneAudioPlaybackUrl(parsed.projectId, scene.id, revision),
      storageKey: storedKey,
      format: speech.format,
      mimeType: speech.mimeType,
      durationSec: speech.durationSec,
      sizeBytes: speech.buffer.length,
      model: speech.model,
      voice: speech.voice,
      languageCode: speech.languageCode,
      sampleRate: speech.sampleRate,
      narrationHash: hashNarrationText(parsed.narration),
      status: "ready",
      generatedAt: speech.generatedAt,
      requestId: speech.requestId,
      error: null,
    };

    try {
      const latestProject = await prisma.videoProject.findUnique({
        where: { id: parsed.projectId },
        select: { metadata: true },
      });
      const latestAudioMap = extractSceneAudioMap(latestProject?.metadata);
      latestAudioMap[scene.id] = audioMeta;

      await prisma.videoProject.update({
        where: { id: parsed.projectId },
        data: {
          metadata: mergeSceneAudioMetadata(latestProject?.metadata, latestAudioMap) as Prisma.InputJsonValue,
        },
      });
    } catch (dbErr) {
      // Roll back newly stored audio file if persisting metadata fails
      await deleteStudioAsset(storedKey).catch(() => {});
      throw dbErr;
    }

    if (previousAudio?.storageKey && previousAudio.storageKey !== storedKey) {
      await deleteAudioAssetIfUnused(previousAudio.storageKey, {
        projectId: parsed.projectId,
        sceneId: scene.id,
      }).catch((err) => {
        console.error("[video-studio] Previous audio cleanup failed:", err);
      });
    }

    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return { audio: audioMeta };
  });
}

/**
 * Manual voiceover upload / replacement (works even when SARVAM_API_KEY is unconfigured).
 */
export async function uploadSceneAudioAction(
  formData: FormData,
): Promise<ActionResult<{ audio: SceneAudioMetadata }>> {
  return run(async () => {
    await requireAdmin();

    const projectId = formData.get("projectId")?.toString()?.trim() ?? "";
    const sceneId = formData.get("sceneId")?.toString()?.trim() ?? "";
    const file = formData.get("file") as File | null;
    const rawLanguage = formData.get("language")?.toString()?.trim() ?? "";

    if (!projectId || !sceneId || !file) {
      throw new Error("Missing project, scene, or audio file.");
    }

    const format = ALLOWED_AUDIO_TYPES[file.type];
    if (!format) {
      throw new Error("Please upload a valid MP3, WAV, OGG, or WebM audio file.");
    }

    if (file.size <= 0) {
      throw new Error("Uploaded audio file is empty.");
    }

    if (file.size > MAX_AUDIO_BYTES) {
      throw new Error("Audio file must be under 15 MB.");
    }

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const scene = await prisma.videoScene.findFirst({
      where: { id: sceneId, projectId },
      select: { id: true, narration: true },
    });
    if (!scene) {
      throw new Error("Scene not found in this project. Save new scenes as a draft before attaching audio.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isValidAudioSignature(buffer, format)) {
      throw new Error("Invalid or corrupted audio file content. Upload a genuine MP3, WAV, OGG, or WebM file.");
    }

    const existingAudioMap = extractSceneAudioMap(project.metadata);
    const previousAudio = existingAudioMap[scene.id] ?? null;

    const revision = `${Date.now()}_${randomBytes(3).toString("hex")}`;
    const mimeType = getAudioMimeType(format);
    const storagePathKey = `video-studio/${projectId}/audio_${scene.id}_p_${projectId}_${revision}.${format}`;

    const storedKey = await uploadPrivateStudioAsset({
      buffer,
      contentType: mimeType,
      key: storagePathKey,
    });

    const audioMeta: SceneAudioMetadata = {
      audioUrl: buildSceneAudioPlaybackUrl(projectId, scene.id, revision),
      storageKey: storedKey,
      format,
      mimeType,
      durationSec: estimateAudioDurationSec(buffer, format, scene.narration),
      sizeBytes: buffer.length,
      model: "manual-upload",
      voice: null,
      languageCode: resolveSarvamLanguageCode(rawLanguage),
      narrationHash: hashNarrationText(scene.narration),
      status: "ready",
      generatedAt: new Date().toISOString(),
      requestId: null,
      error: null,
    };

    try {
      const latestProject = await prisma.videoProject.findUnique({
        where: { id: projectId },
        select: { metadata: true },
      });
      const latestAudioMap = extractSceneAudioMap(latestProject?.metadata);
      latestAudioMap[scene.id] = audioMeta;

      await prisma.videoProject.update({
        where: { id: projectId },
        data: {
          metadata: mergeSceneAudioMetadata(latestProject?.metadata, latestAudioMap) as Prisma.InputJsonValue,
        },
      });
    } catch (dbErr) {
      await deleteStudioAsset(storedKey).catch(() => {});
      throw dbErr;
    }

    if (previousAudio?.storageKey && previousAudio.storageKey !== storedKey) {
      await deleteAudioAssetIfUnused(previousAudio.storageKey, {
        projectId,
        sceneId: scene.id,
      }).catch((err) => {
        console.error("[video-studio] Previous manual audio cleanup failed:", err);
      });
    }

    revalidatePath(`${BASE_ROUTE}/${projectId}`);
    return { audio: audioMeta };
  });
}

/**
 * Deletes scene voiceover audio safely after verifying project/scene ownership and shared references.
 */
export async function deleteSceneAudioAction(params: {
  projectId: string;
  sceneId: string;
}): Promise<ActionResult<{ success: boolean }>> {
  return run(async () => {
    await requireAdmin();

    const project = await prisma.videoProject.findUnique({
      where: { id: params.projectId },
      select: { id: true, metadata: true },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const scene = await prisma.videoScene.findFirst({
      where: { id: params.sceneId, projectId: params.projectId },
      select: { id: true },
    });
    if (!scene) {
      throw new Error("Scene not found in this project.");
    }

    const audioMap = extractSceneAudioMap(project.metadata);
    const previousAudio = audioMap[scene.id];
    if (previousAudio?.storageKey) {
      await deleteAudioAssetIfUnused(previousAudio.storageKey, {
        projectId: params.projectId,
        sceneId: scene.id,
      });

      delete audioMap[scene.id];
      await prisma.videoProject.update({
        where: { id: params.projectId },
        data: {
          metadata: mergeSceneAudioMetadata(project.metadata, audioMap) as Prisma.InputJsonValue,
        },
      });
    }

    revalidatePath(`${BASE_ROUTE}/${params.projectId}`);
    return { success: true };
  });
}

/**
 * Recalculates stored scene audio durations from the underlying private audio files
 * (fixing legacy byte-rate heuristic inflation) and optionally extends short scene durations
 * to accommodate their voiceover length.
 */
export async function syncProjectAudioTimingAction(input: {
  projectId: string;
  fitSceneDurations?: boolean;
}): Promise<
  ActionResult<{
    scenes: EditorScene[];
    updatedAudioCount: number;
    updatedSceneDurationCount: number;
  }>
> {
  return run(async () => {
    await requireAdmin();
    const parsed = z
      .object({
        projectId: z.string().trim().min(1),
        fitSceneDurations: z.boolean().optional(),
      })
      .parse(input);

    const project = await prisma.videoProject.findUnique({
      where: { id: parsed.projectId },
      include: { scenes: { orderBy: [{ order: "asc" }, { position: "asc" }] } },
    });
    if (!project) {
      throw new Error("Project not found.");
    }

    const audioMap = extractSceneAudioMap(project.metadata);
    const shouldFitScenes = parsed.fitSceneDurations !== false;
    let updatedAudioCount = 0;
    const durationUpdates: { id: string; nextDuration: number }[] = [];

    for (const s of project.scenes) {
      const audio = audioMap[s.id];
      if (!audio || audio.status !== "ready" || !audio.storageKey) continue;

      let effectiveSec = audio.durationSec;
      try {
        const buf = await readPrivateStudioAsset(audio.storageKey);
        const fmt = (["mp3", "wav", "ogg", "webm"].includes(audio.format)
          ? audio.format
          : "mp3") as AudioContainerFormat;
        const measured = estimateAudioDurationSec(buf, fmt, s.narration);
        if (measured > 0 && Math.abs(measured - audio.durationSec) >= 0.1) {
          audioMap[s.id] = {
            ...audio,
            durationSec: measured,
          };
          updatedAudioCount++;
        }
        effectiveSec = audioMap[s.id].durationSec;
      } catch {
        // Keep stored metadata if file is temporarily unreachable
      }

      if (shouldFitScenes && effectiveSec > 0) {
        const currentDur = s.duration || s.durationSec || 6;
        const targetDur = Math.min(60, Math.max(2, Math.ceil(effectiveSec)));
        if (currentDur < targetDur) {
          durationUpdates.push({ id: s.id, nextDuration: targetDur });
        }
      }
    }

    if (updatedAudioCount > 0 || durationUpdates.length > 0) {
      await prisma.$transaction(async (tx) => {
        if (updatedAudioCount > 0) {
          await tx.videoProject.update({
            where: { id: parsed.projectId },
            data: {
              metadata: mergeSceneAudioMetadata(project.metadata, audioMap) as Prisma.InputJsonValue,
            },
          });
        }
        for (const upd of durationUpdates) {
          await tx.videoScene.update({
            where: { id: upd.id },
            data: {
              duration: upd.nextDuration,
              durationSec: upd.nextDuration,
            },
          });
        }
        await recordVersionSnapshot(tx, parsed.projectId, "Synced audio & scene timing");
      }, STUDIO_TRANSACTION_OPTIONS);
    }

    const refreshed = await prisma.videoProject.findUniqueOrThrow({
      where: { id: parsed.projectId },
      include: { scenes: { orderBy: [{ order: "asc" }, { position: "asc" }] } },
    });
    const refreshedAudioMap = extractSceneAudioMap(refreshed.metadata);
    const hydratedScenes: EditorScene[] = refreshed.scenes.map((s, idx) => ({
      id: s.id,
      order: s.order || idx + 1,
      title: s.title,
      narration: s.narration,
      imagePrompt: s.imagePrompt,
      imageUrl: s.imageUrl || s.imagePath || null,
      duration: s.duration || s.durationSec || 6,
      locked: s.locked,
      audio: refreshedAudioMap[s.id] ?? null,
    }));

    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return {
      scenes: hydratedScenes,
      updatedAudioCount,
      updatedSceneDurationCount: durationUpdates.length,
    };
  });
}

/**
 * 12. Render Job Management (Phase 3 Part C2 — no FFmpeg worker or browser completion yet)
 */
export async function validateProjectRenderReadinessAction(
  projectId: string,
): Promise<ActionResult<RenderValidationReport>> {
  return run(async () => {
    await requireAdmin();
    const parsed = validateRenderProjectSchema.parse({ projectId });
    const { report } = await getProjectRenderReadiness(parsed.projectId);
    return report;
  });
}

export async function createRenderJobAction(input: {
  projectId: string;
}): Promise<ActionResult<RenderJobSummary>> {
  return run(async () => {
    const admin = await requireAdmin();
    const parsed = createRenderJobSchema.parse(input);
    const job = await createRenderJobForProject(parsed.projectId, admin.id);
    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return job;
  });
}

export async function getRenderJobAction(input: {
  projectId: string;
  jobId: string;
}): Promise<ActionResult<RenderJobSummary>> {
  return run(async () => {
    await requireAdmin();
    const parsed = getRenderJobSchema.parse(input);
    return getRenderJobForProject(parsed.projectId, parsed.jobId);
  });
}

export async function listRenderJobsAction(input: {
  projectId: string;
}): Promise<ActionResult<RenderJobSummary[]>> {
  return run(async () => {
    await requireAdmin();
    const parsed = listRenderJobsSchema.parse(input);
    return listRenderJobsForProject(parsed.projectId);
  });
}

export async function cancelRenderJobAction(input: {
  projectId: string;
  jobId: string;
}): Promise<ActionResult<RenderJobSummary>> {
  return run(async () => {
    await requireAdmin();
    const parsed = cancelRenderJobSchema.parse(input);
    const job = await cancelRenderJobForProject(parsed.projectId, parsed.jobId);
    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return job;
  });
}

export async function retryRenderJobAction(input: {
  projectId: string;
  jobId: string;
}): Promise<ActionResult<RenderJobSummary>> {
  return run(async () => {
    await requireAdmin();
    const parsed = retryRenderJobSchema.parse(input);
    const job = await retryRenderJobForProject(parsed.projectId, parsed.jobId);
    revalidatePath(BASE_ROUTE);
    revalidatePath(`${BASE_ROUTE}/${parsed.projectId}`);
    return job;
  });
}
