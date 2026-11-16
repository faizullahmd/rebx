import "server-only";
import { prisma, requireAdmin } from "@/lib/video-studio/deps";
import {
  ASPECT_RATIO_CONFIG,
  extractDefaultCameraMotion,
  extractProjectThumbnail,
  extractSceneAudioMap,
  extractSceneCameraMotionMap,
  extractThumbnailPrompt,
  extractWatermarkConfig,
  type AspectRatio,
  type ContentCategory,
  type EditorScene,
  type Language,
  type ProjectStatus,
  type ProjectThumbnailMetadata,
  type RenderJobOutputMetadata,
  type RenderJobSnapshot,
  type RenderJobStatus,
  type RenderJobSummary,
  type SceneCameraMotion,
  type Tone,
  type WatermarkConfig,
} from "@/lib/video-studio/schemas";
import { buildVersionedProjectJson, totalDuration } from "@/lib/video-studio/script-utils";

export type ProjectVersionSummary = {
  id: string;
  reason: string;
  createdAt: string;
  title: string;
  aspectRatio: string;
  sceneCount: number;
  totalDuration: number;
};

export function summarizeVersionSnapshot(v: {
  id: string;
  reason: string;
  createdAt: Date | string;
  snapshot: unknown;
}): ProjectVersionSummary {
  const snap = (v.snapshot && typeof v.snapshot === "object" ? v.snapshot : {}) as Record<string, unknown>;
  const settings = (
    snap.videoSettings && typeof snap.videoSettings === "object" ? snap.videoSettings : {}
  ) as Record<string, unknown>;
  const rawScenes = Array.isArray(snap.scenes) ? (snap.scenes as Record<string, unknown>[]) : [];
  const calculatedDuration =
    typeof settings.totalCalculatedDuration === "number"
      ? settings.totalCalculatedDuration
      : totalDuration(rawScenes.map((s) => ({ duration: Number(s.duration || 6) })));

  return {
    id: v.id,
    reason: v.reason,
    createdAt: new Date(v.createdAt).toISOString(),
    title: typeof snap.title === "string" ? snap.title : "",
    aspectRatio: typeof settings.aspectRatio === "string" ? settings.aspectRatio : "16:9",
    sceneCount: rawScenes.length,
    totalDuration: calculatedDuration,
  };
}

export async function getProjectsDashboard(
  opts: {
    status?: string;
    sort?: "updated" | "created";
    q?: string;
  } = {},
) {
  await requireAdmin();

  const [total, draft, processing, completed, failed] = await Promise.all([
    prisma.videoProject.count(),
    prisma.videoProject.count({ where: { status: "DRAFT" } }),
    prisma.videoProject.count({ where: { status: "PROCESSING" } }),
    prisma.videoProject.count({ where: { status: { in: ["COMPLETED", "APPROVED"] } } }),
    prisma.videoProject.count({ where: { status: "FAILED" } }),
  ]);

  const whereClause: Record<string, unknown> = {};

  if (opts.status && opts.status !== "ALL") {
    if (opts.status === "COMPLETED") {
      whereClause.status = { in: ["COMPLETED", "APPROVED"] };
    } else {
      whereClause.status = opts.status;
    }
  }

  if (opts.q?.trim()) {
    whereClause.title = { contains: opts.q.trim() };
  }

  const orderBy = opts.sort === "created" ? { createdAt: "desc" as const } : { updatedAt: "desc" as const };

  const rows = await prisma.videoProject.findMany({
    where: whereClause,
    orderBy,
    take: 100,
    include: {
      scenes: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          imageUrl: true,
          imagePath: true,
          duration: true,
          durationSec: true,
        },
      },
      renderJobs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          progress: true,
          outputStorageKey: true,
          createdAt: true,
        },
      },
    },
  });

  const projects = rows.map((p) => {
    const rawRatio = (p.aspectRatio ?? "16:9") as AspectRatio;
    const ratioConfig = ASPECT_RATIO_CONFIG[rawRatio] ?? ASPECT_RATIO_CONFIG["16:9"];
    const customThumb = extractProjectThumbnail(p.metadata);
    const firstImg = p.scenes.find((s) => s.imageUrl || s.imagePath);
    const thumbnail = customThumb?.url ?? (firstImg ? firstImg.imageUrl || firstImg.imagePath : null);
    const sceneCount = p.scenes.length;
    const totalSec = p.scenes.reduce((sum, s) => sum + (s.duration || s.durationSec || 6), 0);
    const latestRenderRow = p.renderJobs[0] ?? null;

    return {
      id: p.id,
      schemaVersion: p.schemaVersion,
      title: p.title,
      topic: p.topic ?? "",
      category: p.category as ContentCategory,
      aspectRatio: rawRatio,
      dimensions: ratioConfig.dimensions,
      targetAudience: p.targetAudience ?? "",
      language: p.language as Language,
      tone: p.tone as Tone,
      status: (p.status === "APPROVED" ? "COMPLETED" : p.status) as ProjectStatus,
      rawStatus: p.status,
      sceneCount,
      duration: totalSec,
      thumbnail,
      latestRenderJob: latestRenderRow
        ? {
            id: latestRenderRow.id,
            status: latestRenderRow.status as RenderJobStatus,
            progress: latestRenderRow.progress,
            outputStorageKey: latestRenderRow.outputStorageKey ?? null,
            createdAt: new Date(latestRenderRow.createdAt).toISOString(),
          }
        : null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });

  return {
    counts: {
      total,
      draft,
      processing,
      completed,
      failed,
    },
    projects,
  };
}

export async function getProjectWithScenes(id: string) {
  await requireAdmin();

  const p = await prisma.videoProject.findUnique({
    where: { id },
    include: {
      scenes: {
        orderBy: [{ order: "asc" }, { position: "asc" }],
      },
    },
  });

  if (!p) return null;

  const sceneAudioMap = extractSceneAudioMap(p.metadata);
  const sceneMotionMap = extractSceneCameraMotionMap(p.metadata);
  const defaultCameraMotion = extractDefaultCameraMotion(p.metadata);
  const watermark = extractWatermarkConfig(p.metadata);
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

  const versionedJson = buildVersionedProjectJson({
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
    watermark,
    scenes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  });

  return {
    project: {
      id: p.id,
      schemaVersion: p.schemaVersion,
      title: p.title,
      topic: p.topic ?? "",
      category: p.category as ContentCategory,
      status: (p.status === "APPROVED" ? "COMPLETED" : p.status) as ProjectStatus,
      sourceType: p.sourceType,
      aspectRatio: rawRatio,
      dimensions: (ASPECT_RATIO_CONFIG[rawRatio] ?? ASPECT_RATIO_CONFIG["16:9"]).dimensions,
      targetAudience: p.targetAudience ?? "",
      language: (p.language ?? "English") as Language,
      tone: (p.tone ?? "Professional") as Tone,
      desiredDuration: p.duration,
      defaultCameraMotion,
      watermark,
      customThumbnail: extractProjectThumbnail(p.metadata),
      thumbnailPrompt: extractThumbnailPrompt(p.metadata),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    },
    scenes,
    versionedJson,
  };
}

export async function getProjectVersions(projectId: string): Promise<ProjectVersionSummary[]> {
  await requireAdmin();

  const rows = await prisma.videoVersion.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return rows.map(summarizeVersionSnapshot);
}

export async function getProjectRenderJobs(projectId: string): Promise<RenderJobSummary[]> {
  await requireAdmin();

  const rows = await prisma.videoRenderJob.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    createdById: row.createdById ?? null,
    status: row.status as RenderJobStatus,
    progress: row.progress,
    stage: row.stage ?? null,
    errorMessage: row.errorMessage ?? null,
    snapshotHash: row.snapshotHash,
    outputStorageKey: row.outputStorageKey ?? null,
    outputMetadata: (row.outputMetadata as unknown as RenderJobOutputMetadata | null) ?? null,
    retryCount: row.retryCount,
    workerId: row.workerId ?? null,
    leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null,
    lastHeartbeatAt: row.lastHeartbeatAt ? new Date(row.lastHeartbeatAt).toISOString() : null,
    startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    snapshot: row.snapshot as unknown as RenderJobSnapshot,
  }));
}
