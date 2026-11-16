import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

class RedirectSignal extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

let mockActor: { id: number; role: "ADMIN" | "AGENT" | "CUSTOMER"; email: string; name: string } | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  }),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => {
    if (!mockActor) throw new RedirectSignal("/login");
    return mockActor;
  }),
  requireRole: vi.fn(async (role: string) => {
    if (!mockActor) throw new RedirectSignal("/login");
    if (mockActor.role !== role) throw new RedirectSignal("/unauthorized");
    return mockActor;
  }),
}));

import * as videoStudioActions from "@/lib/actions/video-studio";
import {
  cancelRenderJobAction,
  createProjectAction,
  createRenderJobAction,
  deleteProjectAction,
  duplicateProjectAction,
  getRenderJobAction,
  listRenderJobsAction,
  retryRenderJobAction,
  saveDraftAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
  validateProjectRenderReadinessAction,
} from "@/lib/actions/video-studio";
import { getProjectRenderJobs, getProjectsDashboard, getProjectVersions, getProjectWithScenes } from "@/lib/data/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX } from "@/lib/video-studio/deps";
import { transitionRenderJobInternal } from "@/lib/video-studio/render-jobs";

const ADMIN_USER = {
  id: 960001,
  role: "ADMIN" as const,
  email: "video-studio-admin96@example.com",
  name: "Studio Admin Part C2",
};

const CUSTOMER_USER = {
  id: 960002,
  role: "CUSTOMER" as const,
  email: "video-studio-cust96@example.com",
  name: "Studio Customer Part C2",
};

const AGENT_USER = {
  id: 960003,
  role: "AGENT" as const,
  email: "video-studio-agent96@example.com",
  name: "Studio Agent Part C2",
};

const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const originalEnv = { ...process.env };

function makeMp3Buffer(tag = "c2"): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const payload = Buffer.from(`rebx-c2-audio-${tag}`, "utf8");
  return Buffer.concat([header, frame, payload]);
}

function resolvePrivateImageDiskPath(url: string): string | null {
  if (url.startsWith("/api/admin/video-studio/image/")) {
    return path.join(
      process.cwd(),
      "storage",
      "video-studio",
      "images",
      url.slice("/api/admin/video-studio/image/".length),
    );
  }
  if (url.startsWith("/uploads/video-studio/")) {
    return path.join(
      process.cwd(),
      "storage",
      "video-studio",
      "images",
      url.slice("/uploads/video-studio/".length),
    );
  }
  return null;
}

async function privateImageExists(url: string): Promise<boolean> {
  const diskPath = resolvePrivateImageDiskPath(url);
  if (!diskPath) return false;
  try {
    await fs.access(diskPath);
    return true;
  } catch {
    return false;
  }
}

async function privateAudioExists(storageKey: string): Promise<boolean> {
  if (!storageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) return false;
  const filename = storageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
  try {
    await fs.access(path.join(process.cwd(), "storage", "video-studio", filename));
    return true;
  } catch {
    return false;
  }
}

async function createRenderReadyProject(title = "Render Ready Project"): Promise<{
  projectId: string;
  sceneIds: string[];
  imageUrls: string[];
  audioKeys: string[];
}> {
  const proj = await createProjectAction({
    title,
    topic: "Walkthrough of Tellapur high-rise apartments",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Luxury",
    duration: 30,
    aspectRatio: "16:9",
    scenes: [
      {
        id: "init_1",
        order: 1,
        title: "Grand Entrance",
        narration: "Welcome to Tellapur Reserve luxury residences.",
        imagePrompt: "Luxury gatehouse",
        imageUrl: null,
        duration: 6,
        locked: false,
      },
      {
        id: "init_2",
        order: 2,
        title: "Sky Lounge",
        narration: "Enjoy panoramic skyline views from the rooftop clubhouse.",
        imagePrompt: "Rooftop infinity pool sunset",
        imageUrl: null,
        duration: 8,
        locked: false,
      },
    ],
  });
  expect(proj.ok).toBe(true);
  if (!proj.ok) throw new Error(proj.error);

  const projectId = proj.data.id;
  createdProjectIds.push(projectId);

  const scenes = await prisma.videoScene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  const imageUrls: string[] = [];
  const audioKeys: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const imgFd = new FormData();
    imgFd.set("projectId", projectId);
    imgFd.set("sceneId", s.id);
    imgFd.set(
      "file",
      new File([Buffer.from(`img-bytes-${i}-${Date.now()}`)], `scene_${i + 1}.jpg`, { type: "image/jpeg" }),
    );
    const imgRes = await uploadSceneImageAction(imgFd);
    expect(imgRes.ok).toBe(true);
    if (!imgRes.ok) throw new Error(imgRes.error);
    imageUrls.push(imgRes.data.imageUrl);
    localImageUrls.push(imgRes.data.imageUrl);

    const audFd = new FormData();
    audFd.set("projectId", projectId);
    audFd.set("sceneId", s.id);
    audFd.set("language", "en-IN");
    audFd.set(
      "file",
      new File([new Uint8Array(makeMp3Buffer(`scene_${i}`))], `voice_${i + 1}.mp3`, { type: "audio/mpeg" }),
    );
    const audRes = await uploadSceneAudioAction(audFd);
    expect(audRes.ok).toBe(true);
    if (!audRes.ok) throw new Error(audRes.error);
    audioKeys.push(audRes.data.audio.storageKey);
    localAudioKeys.push(audRes.data.audio.storageKey);
  }

  return {
    projectId,
    sceneIds: scenes.map((s) => s.id),
    imageUrls,
    audioKeys,
  };
}

async function cleanup() {
  const projects = await prisma.videoProject.findMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
    include: { scenes: { select: { imageUrl: true, imagePath: true } } },
  });

  for (const p of projects) {
    for (const s of p.scenes) {
      const url = s.imageUrl || s.imagePath;
      if (url?.startsWith("/api/admin/video-studio/image/") || url?.startsWith("/uploads/video-studio/")) {
        localImageUrls.push(url);
      }
    }
    const meta = p.metadata as { sceneAudio?: Record<string, { storageKey?: string }> } | null;
    if (meta?.sceneAudio) {
      for (const a of Object.values(meta.sceneAudio)) {
        if (a?.storageKey?.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
          localAudioKeys.push(a.storageKey);
        }
      }
    }
  }

  await prisma.videoProject.deleteMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id, AGENT_USER.id] } },
  });

  for (const url of new Set(localImageUrls)) {
    const diskPath = resolvePrivateImageDiskPath(url);
    if (diskPath) {
      await fs.unlink(diskPath).catch(() => {});
    }
  }
  for (const key of new Set(localAudioKeys)) {
    if (key.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      const filename = key.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", filename)).catch(() => {});
    }
  }
}

describe("REBX AI Video Studio - Phase 3 Part C2: Render Job Management", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.createMany({
      data: [
        { id: ADMIN_USER.id, name: ADMIN_USER.name, email: ADMIN_USER.email, role: "ADMIN", passwordHash: "x" },
        { id: CUSTOMER_USER.id, name: CUSTOMER_USER.name, email: CUSTOMER_USER.email, role: "CUSTOMER", passwordHash: "x" },
        { id: AGENT_USER.id, name: AGENT_USER.name, email: AGENT_USER.email, role: "AGENT", passwordHash: "x" },
      ],
    });
  });

  beforeEach(() => {
    mockActor = ADMIN_USER;
    process.env = { ...originalEnv, STORAGE_PROVIDER: "local" };
  });

  afterAll(cleanup);

  it("1. Validates a complete project and creates a PENDING render job with immutable snapshot & worker metadata", async () => {
    const { projectId, sceneIds } = await createRenderReadyProject("Complete C2 Project");

    const readiness = await validateProjectRenderReadinessAction(projectId);
    expect(readiness.ok).toBe(true);
    if (!readiness.ok) return;
    expect(readiness.data.valid).toBe(true);
    expect(readiness.data.errors).toEqual([]);
    expect(readiness.data.summary.sceneCount).toBe(2);
    expect(readiness.data.summary.totalDurationSec).toBe(14);
    expect(readiness.data.summary.aspectRatio).toBe("16:9");

    const created = await createRenderJobAction({ projectId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const job = created.data;
    expect(job.projectId).toBe(projectId);
    expect(job.createdById).toBe(ADMIN_USER.id);
    expect(job.status).toBe("PENDING");
    expect(job.progress).toBe(0);
    expect(job.retryCount).toBe(0);
    expect(job.outputStorageKey).toBeNull();
    expect(job.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(job.outputMetadata?.targetOutputKey).toBe(`video-studio/${projectId}/renders/render_${job.id}.mp4`);
    expect(job.outputMetadata?.container).toBe("mp4");
    expect(job.outputMetadata?.workerPendingPartC3).toBe(true);

    expect(job.snapshot.snapshotVersion).toBe("1.0.0");
    expect(job.snapshot.project.projectId).toBe(projectId);
    expect(job.snapshot.renderSettings.width).toBe(1920);
    expect(job.snapshot.renderSettings.height).toBe(1080);
    expect(job.snapshot.scenes.map((s) => s.sceneId)).toEqual(sceneIds);
    expect(job.snapshot.scenes[0].image.provider).toBe("local");
    expect(job.snapshot.scenes[0].audio.provider).toBe("local-private");

    // Verify getProjectsDashboard includes latestRenderJob cleanly with current Prisma client
    const dashboard = await getProjectsDashboard();
    const row = dashboard.projects.find((p) => p.id === projectId);
    expect(row).toBeDefined();
    expect(row?.latestRenderJob?.id).toBe(job.id);
    expect(row?.latestRenderJob?.status).toBe("PENDING");
    expect(row?.latestRenderJob?.progress).toBe(0);

    // Ensure no credentials ever leak into snapshots or metadata
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain("SPACES_SECRET");
    expect(serialized).not.toContain("SARVAM_API_KEY");
    expect(serialized).not.toContain("DATABASE_URL");
  });

  it("2. Rejects invalid projects (missing project, unsupported aspect ratio, invalid JSON, bad scene ordering, bad durations)", async () => {
    const missingRes = await createRenderJobAction({ projectId: "nonexistent_proj_xyz" });
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) expect(missingRes.error).toMatch(/Project not found/i);

    const { projectId, sceneIds } = await createRenderReadyProject("Invalid Checks Project");

    // Unsupported aspect ratio must fail loudly (no silent 16:9 fallback)
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { aspectRatio: "21:9" },
    });
    const badRatio = await createRenderJobAction({ projectId });
    expect(badRatio.ok).toBe(false);
    if (!badRatio.ok) expect(badRatio.error).toMatch(/Unsupported aspect ratio "21:9"/i);

    // Ensure project was NOT silently mutated back to 16:9
    const stillBad = await prisma.videoProject.findUniqueOrThrow({ where: { id: projectId } });
    expect(stillBad.aspectRatio).toBe("21:9");

    // Restore valid aspect ratio, break category (Project JSON Zod validation)
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { aspectRatio: "16:9", category: "unsupported_category" },
    });
    const badJson = await validateProjectRenderReadinessAction(projectId);
    expect(badJson.ok).toBe(true);
    if (badJson.ok) {
      expect(badJson.data.valid).toBe(false);
      expect(badJson.data.errors.some((e) => e.message.includes("Unsupported content category"))).toBe(true);
    }

    // Restore category, test invalid duplicate scene ordering [1, 1]
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { category: "property_showcase" },
    });
    await prisma.videoScene.update({
      where: { id: sceneIds[1] },
      data: { order: 1 },
    });
    const badOrder = await createRenderJobAction({ projectId });
    expect(badOrder.ok).toBe(false);
    if (!badOrder.ok) expect(badOrder.error).toMatch(/invalid ordering/i);

    // Restore order, break scene duration (< 2s) and clear narration
    await prisma.videoScene.update({
      where: { id: sceneIds[1] },
      data: { order: 2, duration: 1, narration: "   " },
    });
    const badScene = await validateProjectRenderReadinessAction(projectId);
    expect(badScene.ok).toBe(true);
    if (badScene.ok) {
      expect(badScene.data.valid).toBe(false);
      expect(badScene.data.errors.some((e) => e.code === "INVALID_SCENE_DURATION")).toBe(true);
      expect(badScene.data.errors.some((e) => e.code === "MISSING_SCENE_NARRATION")).toBe(true);
    }
  });

  it("3. Rejects missing or unresolvable scene images and missing, failed, or unresolvable audio", async () => {
    const { projectId, sceneIds, imageUrls, audioKeys } = await createRenderReadyProject("Missing Assets Project");

    // Case A: Clear Scene 1 imageUrl in DB
    await prisma.videoScene.update({
      where: { id: sceneIds[0] },
      data: { imageUrl: null, imagePath: null },
    });
    const noImg = await createRenderJobAction({ projectId });
    expect(noImg.ok).toBe(false);
    if (!noImg.ok) expect(noImg.error).toMatch(/requires an uploaded scene image/i);

    // Case B: Point Scene 1 to nonexistent local image file (unresolvable through storage abstraction)
    await prisma.videoScene.update({
      where: { id: sceneIds[0] },
      data: { imageUrl: "/uploads/video-studio/does_not_exist_999.jpg", imagePath: "/uploads/video-studio/does_not_exist_999.jpg" },
    });
    const missingFile = await createRenderJobAction({ projectId });
    expect(missingFile.ok).toBe(false);
    if (!missingFile.ok) expect(missingFile.error).toMatch(/does not exist in storage/i);

    // Restore valid imageUrl, corrupt Scene 2 audio status -> "failed"
    await prisma.videoScene.update({
      where: { id: sceneIds[0] },
      data: { imageUrl: imageUrls[0], imagePath: imageUrls[0] },
    });
    const projRow = await prisma.videoProject.findUniqueOrThrow({ where: { id: projectId }, select: { metadata: true } });
    const meta = (projRow.metadata ?? {}) as { sceneAudio?: Record<string, Record<string, unknown>> };
    const failedAudioMeta = {
      ...meta,
      sceneAudio: {
        ...(meta.sceneAudio ?? {}),
        [sceneIds[1]]: {
          ...(meta.sceneAudio?.[sceneIds[1]] ?? {}),
          status: "failed",
        },
      },
    };
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { metadata: failedAudioMeta as never },
    });

    const badAudio = await createRenderJobAction({ projectId });
    expect(badAudio.ok).toBe(false);
    if (!badAudio.ok) expect(badAudio.error).toMatch(/voiceover status is "failed"/i);

    // Remove audio entry completely -> MISSING_SCENE_AUDIO
    const clearedAudioMeta = {
      ...meta,
      sceneAudio: { [sceneIds[0]]: meta.sceneAudio?.[sceneIds[0]] },
    };
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { metadata: clearedAudioMeta as never },
    });
    const missingAudio = await createRenderJobAction({ projectId });
    expect(missingAudio.ok).toBe(false);
    if (!missingAudio.ok) expect(missingAudio.error).toMatch(/missing voiceover audio/i);

    // Put valid metadata pointing to missing private file -> unresolvable audio error
    const danglingAudioMeta = {
      sceneAudio: {
        [sceneIds[0]]: meta.sceneAudio?.[sceneIds[0]],
        [sceneIds[1]]: {
          ...(meta.sceneAudio?.[sceneIds[1]] ?? {}),
          status: "ready",
          storageKey: `${LOCAL_PRIVATE_ASSET_PREFIX}missing_voiceover_file.mp3`,
        },
      },
    };
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { metadata: danglingAudioMeta as never },
    });
    const danglingAudio = await createRenderJobAction({ projectId });
    expect(danglingAudio.ok).toBe(false);
    if (!danglingAudio.ok) expect(danglingAudio.error).toMatch(/does not exist in private storage/i);
    expect(audioKeys.length).toBe(2);
  });

  it("4. Enforces ADMIN authorization, cross-project ownership, and prevents browser completion", async () => {
    const p1 = await createRenderReadyProject("Auth Project 1");
    const p2 = await createRenderReadyProject("Auth Project 2");

    const j1Res = await createRenderJobAction({ projectId: p1.projectId });
    expect(j1Res.ok).toBe(true);
    if (!j1Res.ok) return;
    const j1 = j1Res.data;

    // Cross-project access rejected even for ADMIN
    const crossGet = await getRenderJobAction({ projectId: p2.projectId, jobId: j1.id });
    expect(crossGet.ok).toBe(false);
    if (!crossGet.ok) expect(crossGet.error).toMatch(/does not belong to this project/i);

    const crossCancel = await cancelRenderJobAction({ projectId: p2.projectId, jobId: j1.id });
    expect(crossCancel.ok).toBe(false);
    if (!crossCancel.ok) expect(crossCancel.error).toMatch(/does not belong to this project/i);

    const crossRetry = await retryRenderJobAction({ projectId: p2.projectId, jobId: j1.id });
    expect(crossRetry.ok).toBe(false);
    if (!crossRetry.ok) expect(crossRetry.error).toMatch(/does not belong to this project/i);

    // Non-ADMIN roles rejected
    for (const actor of [CUSTOMER_USER, AGENT_USER]) {
      mockActor = actor;
      await expect(validateProjectRenderReadinessAction(p1.projectId)).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(createRenderJobAction({ projectId: p1.projectId })).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(getRenderJobAction({ projectId: p1.projectId, jobId: j1.id })).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(listRenderJobsAction({ projectId: p1.projectId })).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(cancelRenderJobAction({ projectId: p1.projectId, jobId: j1.id })).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(retryRenderJobAction({ projectId: p1.projectId, jobId: j1.id })).rejects.toThrow(
        /NEXT_REDIRECT:\/unauthorized/,
      );
      await expect(getProjectRenderJobs(p1.projectId)).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);
    }

    // Unauthenticated rejected to /login
    mockActor = null;
    await expect(createRenderJobAction({ projectId: p1.projectId })).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    await expect(listRenderJobsAction({ projectId: p1.projectId })).rejects.toThrow(/NEXT_REDIRECT:\/login/);

    // Verify NO server action exports a browser-callable completion or progress setter for render jobs
    const exportedActionNames = Object.keys(videoStudioActions);
    expect(exportedActionNames).not.toContain("completeRenderJobAction");
    expect(exportedActionNames).not.toContain("updateRenderJobProgressAction");
    expect(exportedActionNames).not.toContain("transitionRenderJobInternal");
  });

  it("5. Prevents accidental duplicate jobs for identical active snapshot and allows new job after edits or terminal status", async () => {
    const { projectId, sceneIds } = await createRenderReadyProject("Duplicate Prevention Project");

    const first = await createRenderJobAction({ projectId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Duplicate while PENDING -> rejected
    const dupWhilePending = await createRenderJobAction({ projectId });
    expect(dupWhilePending.ok).toBe(false);
    if (!dupWhilePending.ok) expect(dupWhilePending.error).toMatch(/Duplicate render job prevented/i);

    // Move to QUEUED -> still active, duplicate rejected
    await transitionRenderJobInternal({
      projectId,
      jobId: first.data.id,
      targetStatus: "QUEUED",
      progress: 0,
    });
    const dupWhileQueued = await createRenderJobAction({ projectId });
    expect(dupWhileQueued.ok).toBe(false);
    if (!dupWhileQueued.ok) expect(dupWhileQueued.error).toMatch(/Duplicate render job prevented/i);

    // Edit scene duration cleanly via saveDraftAction -> snapshotHash changes, so new job is allowed!
    const current = await getProjectWithScenes(projectId);
    expect(current).not.toBeNull();
    const updatedScenes = current!.scenes.map((s) =>
      s.id === sceneIds[0] ? { ...s, duration: s.duration + 2 } : s,
    );
    const saveRes = await saveDraftAction({
      projectId,
      title: "Duplicate Prevention Project (Edited)",
      category: "property_showcase",
      status: "DRAFT",
      language: "English",
      tone: "Luxury",
      duration: 30,
      aspectRatio: "16:9",
      scenes: updatedScenes,
    });
    expect(saveRes.ok).toBe(true);

    const second = await createRenderJobAction({ projectId });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.id).not.toBe(first.data.id);
    expect(second.data.snapshotHash).not.toBe(first.data.snapshotHash);

    // Cancel second job -> now same edited snapshot is allowed again
    const cancelSecond = await cancelRenderJobAction({ projectId, jobId: second.data.id });
    expect(cancelSecond.ok).toBe(true);

    const third = await createRenderJobAction({ projectId });
    expect(third.ok).toBe(true);
  });

  it("6. Enforces status transitions, invalid progress checks, cancellation rules, and safe retry behavior", async () => {
    const { projectId } = await createRenderReadyProject("State Machine Project");

    const jobRes = await createRenderJobAction({ projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) return;
    const jobId = jobRes.data.id;

    // Invalid skips from PENDING
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: 10 }),
    ).rejects.toThrow(/Invalid render job status transition: PENDING -> PROCESSING/);
    await expect(
      transitionRenderJobInternal({
        projectId,
        jobId,
        targetStatus: "COMPLETED",
        progress: 100,
        outputStorageKey: "x.mp4",
      }),
    ).rejects.toThrow(/Invalid render job status transition: PENDING -> COMPLETED/);

    // Invalid retry when not FAILED
    const badRetry = await retryRenderJobAction({ projectId, jobId });
    expect(badRetry.ok).toBe(false);
    if (!badRetry.ok) expect(badRetry.error).toMatch(/PENDING -> QUEUED|Invalid/i);

    // PENDING -> QUEUED (with invalid progress 50 rejected first, then 0 accepted)
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "QUEUED", progress: 50 }),
    ).rejects.toThrow(/must be 0%/i);

    const queued = await transitionRenderJobInternal({
      projectId,
      jobId,
      targetStatus: "QUEUED",
      progress: 0,
    });
    expect(queued.status).toBe("QUEUED");

    // QUEUED -> CANCELLED succeeds on second job test below; here advance QUEUED -> PROCESSING
    const procStart = await transitionRenderJobInternal({
      projectId,
      jobId,
      targetStatus: "PROCESSING",
      progress: 15,
      stage: "Preparing scene assets",
    });
    expect(procStart.status).toBe("PROCESSING");
    expect(procStart.progress).toBe(15);
    expect(procStart.startedAt).not.toBeNull();

    // Invalid progress values rejected
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: -1 }),
    ).rejects.toThrow(/between 0 and 100/i);
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: 101 }),
    ).rejects.toThrow(/between 0 and 100/i);
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: 42.5 }),
    ).rejects.toThrow(/whole integer/i);
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: 5 }),
    ).rejects.toThrow(/cannot regress/i);

    // PROCESSING cannot be cancelled
    const cancelProcessing = await cancelRenderJobAction({ projectId, jobId });
    expect(cancelProcessing.ok).toBe(false);
    if (!cancelProcessing.ok) expect(cancelProcessing.error).toMatch(/PROCESSING -> CANCELLED/);

    // Cannot mark COMPLETED at 95% or without outputStorageKey
    await expect(
      transitionRenderJobInternal({
        projectId,
        jobId,
        targetStatus: "COMPLETED",
        progress: 95,
        outputStorageKey: "video-studio/out.mp4",
      }),
    ).rejects.toThrow(/requires progress to be 100%/i);
    await expect(
      transitionRenderJobInternal({
        projectId,
        jobId,
        targetStatus: "COMPLETED",
        progress: 100,
        outputStorageKey: "",
      }),
    ).rejects.toThrow(/valid outputStorageKey/i);

    // PROCESSING -> FAILED -> Retry (FAILED -> QUEUED) -> PROCESSING -> COMPLETED
    const failed = await transitionRenderJobInternal({
      projectId,
      jobId,
      targetStatus: "FAILED",
      errorMessage: "Simulated worker crash during concat",
      stage: "FFmpeg muxing",
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.errorMessage).toContain("Simulated worker crash");

    const retried = await retryRenderJobAction({ projectId, jobId });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.data.status).toBe("QUEUED");
    expect(retried.data.progress).toBe(0);
    expect(retried.data.errorMessage).toBeNull();
    expect(retried.data.startedAt).toBeNull();
    expect(retried.data.retryCount).toBe(1);

    await transitionRenderJobInternal({ projectId, jobId, targetStatus: "PROCESSING", progress: 60 });
    const completed = await transitionRenderJobInternal({
      projectId,
      jobId,
      targetStatus: "COMPLETED",
      progress: 100,
      stage: "Uploaded MP4",
      outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
      outputMetadataPatch: { fileSizeBytes: 2048000, renderedDurationSec: 14 },
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.progress).toBe(100);
    expect(completed.completedAt).not.toBeNull();
    expect(completed.outputStorageKey).toBe(`video-studio/${projectId}/renders/render_${jobId}.mp4`);

    // Terminal states (COMPLETED / CANCELLED) reject further transitions
    await expect(
      transitionRenderJobInternal({ projectId, jobId, targetStatus: "QUEUED", progress: 0 }),
    ).rejects.toThrow(/COMPLETED -> QUEUED/);

    // New job -> test cancellation from QUEUED
    const job2 = await createRenderJobAction({ projectId });
    expect(job2.ok).toBe(true);
    if (!job2.ok) return;
    await transitionRenderJobInternal({ projectId, jobId: job2.data.id, targetStatus: "QUEUED", progress: 0 });
    const cancelled = await cancelRenderJobAction({ projectId, jobId: job2.data.id });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.status).toBe("CANCELLED");
    expect(cancelled.data.cancelledAt).not.toBeNull();
  });

  it("7. Preserves immutable render snapshot & referenced storage files after subsequent project edits, while keeping Part A/B workflows intact", async () => {
    const { projectId, sceneIds, imageUrls, audioKeys } = await createRenderReadyProject("Immutability Project");
    const origImg0 = imageUrls[0];
    const origAud0 = audioKeys[0];

    const jobRes = await createRenderJobAction({ projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) return;
    const job = jobRes.data;

    // Verify original snapshot details
    expect(job.snapshot.project.title).toBe("Immutability Project");
    expect(job.snapshot.renderSettings.aspectRatio).toBe("16:9");
    expect(job.snapshot.scenes[0].image.sourceUrl).toBe(origImg0);
    expect(job.snapshot.scenes[0].audio.storageKey).toBe(origAud0);

    // Replace Scene 1 image & audio and edit project metadata/scenes via normal editor actions
    const replaceImgFd = new FormData();
    replaceImgFd.set("projectId", projectId);
    replaceImgFd.set("sceneId", sceneIds[0]);
    replaceImgFd.set(
      "file",
      new File([Buffer.from(`new-img-v2-${Date.now()}`)], "updated_scene1.png", { type: "image/png" }),
    );
    const upNewImg = await uploadSceneImageAction(replaceImgFd);
    expect(upNewImg.ok).toBe(true);
    if (!upNewImg.ok) return;
    localImageUrls.push(upNewImg.data.imageUrl);

    const replaceAudFd = new FormData();
    replaceAudFd.set("projectId", projectId);
    replaceAudFd.set("sceneId", sceneIds[0]);
    replaceAudFd.set(
      "file",
      new File([new Uint8Array(makeMp3Buffer("updated_aud_v2"))], "updated_voice1.mp3", { type: "audio/mpeg" }),
    );
    const upNewAud = await uploadSceneAudioAction(replaceAudFd);
    expect(upNewAud.ok).toBe(true);
    if (!upNewAud.ok) return;
    localAudioKeys.push(upNewAud.data.audio.storageKey);

    const currentProject = await getProjectWithScenes(projectId);
    expect(currentProject).not.toBeNull();
    const saveDraftRes = await saveDraftAction({
      projectId,
      title: "Edited Draft After Render Queued",
      category: "market_update",
      status: "DRAFT",
      language: "English",
      tone: "Friendly",
      duration: 45,
      aspectRatio: "9:16",
      scenes: currentProject!.scenes.map((s, idx) =>
        idx === 0
          ? { ...s, title: "Modified Scene Title", narration: "Completely rewritten narration", duration: 12 }
          : s,
      ),
    });
    expect(saveDraftRes.ok).toBe(true);

    // 1) Because job is still PENDING (active), original image & audio physical files MUST NOT be deleted!
    expect(await privateImageExists(origImg0)).toBe(true);
    expect(await privateAudioExists(origAud0)).toBe(true);

    // 2) Reload render job from DB -> snapshot remains 100% immutable!
    const fetchedJobRes = await getRenderJobAction({ projectId, jobId: job.id });
    expect(fetchedJobRes.ok).toBe(true);
    if (!fetchedJobRes.ok) return;

    const snap = fetchedJobRes.data.snapshot;
    expect(snap.project.title).toBe("Immutability Project");
    expect(snap.renderSettings.aspectRatio).toBe("16:9");
    expect(snap.scenes[0].title).toBe("Grand Entrance");
    expect(snap.scenes[0].durationSec).toBe(6);
    expect(snap.scenes[0].image.sourceUrl).toBe(origImg0);
    expect(snap.scenes[0].audio.storageKey).toBe(origAud0);

    // 3) Verify project list/duplicate/versions still work normally alongside render jobs
    const versions = await getProjectVersions(projectId);
    expect(versions.length).toBeGreaterThanOrEqual(2);

    const dup = await duplicateProjectAction(projectId);
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    createdProjectIds.push(dup.data.id);

    // Duplicated project starts with empty render job history
    const dupJobs = await getProjectRenderJobs(dup.data.id);
    expect(dupJobs).toEqual([]);

    // 4) Cancel active job on original project -> deleting original project cascades its VideoRenderJob rows cleanly
    const delOrig = await deleteProjectAction(projectId);
    expect(delOrig.ok).toBe(true);
    expect(await prisma.videoRenderJob.count({ where: { projectId } })).toBe(0);
    // Unshared original files (no longer in duplicated project or active jobs) are now safely cleaned up!
    expect(await privateImageExists(origImg0)).toBe(false);
    expect(await privateAudioExists(origAud0)).toBe(false);
  });
});

