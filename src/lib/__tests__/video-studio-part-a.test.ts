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

import {
  bulkUploadImagesAction,
  checkGeminiStatusAction,
  createProjectAction,
  deleteProjectAction,
  deleteSceneImageAction,
  duplicateProjectAction,
  generateScriptWithGeminiAction,
  restoreVersionAction,
  saveDraftAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import { getProjectVersions } from "@/lib/data/video-studio";

const ADMIN_USER = {
  id: 940001,
  role: "ADMIN" as const,
  email: "video-studio-admin94@example.com",
  name: "Studio Admin Test",
};
const CUSTOMER_USER = {
  id: 940002,
  role: "CUSTOMER" as const,
  email: "video-studio-cust94@example.com",
  name: "Studio Customer Test",
};

const createdProjectIds: string[] = [];
const uploadedLocalPaths: string[] = [];

function resolvePrivateImageDiskPath(localUrl: string): string | null {
  if (localUrl.startsWith("/api/admin/video-studio/image/")) {
    const filename = localUrl.slice("/api/admin/video-studio/image/".length);
    return path.join(process.cwd(), "storage", "video-studio", "images", filename);
  }
  if (localUrl.startsWith("/uploads/video-studio/")) {
    const filename = localUrl.slice("/uploads/video-studio/".length);
    return path.join(process.cwd(), "storage", "video-studio", "images", filename);
  }
  return null;
}

async function fileExists(localUrl: string): Promise<boolean> {
  const diskPath = resolvePrivateImageDiskPath(localUrl);
  if (!diskPath) return false;
  try {
    await fs.access(diskPath);
    return true;
  } catch {
    return false;
  }
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
        uploadedLocalPaths.push(url);
      }
    }
  }

  await prisma.videoProject.deleteMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
  });

  for (const url of new Set(uploadedLocalPaths)) {
    const diskPath = resolvePrivateImageDiskPath(url);
    if (diskPath) {
      await fs.unlink(diskPath).catch(() => {});
    }
  }
}

describe("REBX AI Video Studio - Part A Integration & Security Verification", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.createMany({
      data: [
        { id: ADMIN_USER.id, name: ADMIN_USER.name, email: ADMIN_USER.email, role: "ADMIN", passwordHash: "x" },
        { id: CUSTOMER_USER.id, name: CUSTOMER_USER.name, email: CUSTOMER_USER.email, role: "CUSTOMER", passwordHash: "x" },
      ],
    });
  });

  beforeEach(() => {
    mockActor = ADMIN_USER;
    process.env.STORAGE_PROVIDER = "local";
  });

  afterAll(cleanup);

  it("1. Enforces ADMIN role across studio & version actions (rethrows redirects cleanly)", async () => {
    mockActor = CUSTOMER_USER;
    await expect(checkGeminiStatusAction()).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);
    await expect(
      generateScriptWithGeminiAction({
        topic: "Test",
        category: "property_showcase",
        language: "English",
        tone: "Professional",
        desiredDuration: 30,
        aspectRatio: "16:9",
      }),
    ).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);
    await expect(restoreVersionAction("proj_fake", "ver_fake")).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);

    mockActor = null;
    await expect(deleteSceneImageAction({ projectId: "proj_fake", sceneId: "s_fake" })).rejects.toThrow(
      /NEXT_REDIRECT:\/login/,
    );
  });

  it("2. Replaces and deletes scene images cleanly without leaving orphaned files", async () => {
    const createRes = await createProjectAction({
      title: "Part A Image Lifecycle Project",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Living Room",
          narration: "Sunlight fills the living area.",
          imagePrompt: "Living room 4k",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    createdProjectIds.push(createRes.data.id);

    const dbScene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: createRes.data.id } });

    // Upload image #1
    const fd1 = new FormData();
    fd1.set("projectId", createRes.data.id);
    fd1.set("sceneId", dbScene.id);
    fd1.set("file", new File([Buffer.from("image-v1-bytes")], "living1.jpg", { type: "image/jpeg" }));
    const up1 = await uploadSceneImageAction(fd1);
    expect(up1.ok).toBe(true);
    if (!up1.ok) return;
    uploadedLocalPaths.push(up1.data.imageUrl);
    expect(await fileExists(up1.data.imageUrl)).toBe(true);

    // Ensure unique timestamp if same millisecond
    await new Promise((r) => setTimeout(r, 15));

    // Replace with image #2 -> image #1 should be deleted safely
    const fd2 = new FormData();
    fd2.set("projectId", createRes.data.id);
    fd2.set("sceneId", dbScene.id);
    fd2.set("file", new File([Buffer.from("image-v2-bytes")], "living2.png", { type: "image/png" }));
    const up2 = await uploadSceneImageAction(fd2);
    expect(up2.ok).toBe(true);
    if (!up2.ok) return;
    uploadedLocalPaths.push(up2.data.imageUrl);

    expect(up2.data.imageUrl).not.toBe(up1.data.imageUrl);
    expect(await fileExists(up2.data.imageUrl)).toBe(true);
    expect(await fileExists(up1.data.imageUrl)).toBe(false);

    // Delete image #2 via deleteSceneImageAction -> file removed & DB cleared
    const delRes = await deleteSceneImageAction({
      projectId: createRes.data.id,
      sceneId: dbScene.id,
      imageUrl: up2.data.imageUrl,
    });
    expect(delRes.ok).toBe(true);
    expect(await fileExists(up2.data.imageUrl)).toBe(false);

    const refreshedScene = await prisma.videoScene.findUniqueOrThrow({ where: { id: dbScene.id } });
    expect(refreshedScene.imageUrl).toBeNull();
  });

  it("3. Protects shared images referenced by duplicated projects until the final copy deletes them", async () => {
    const createRes = await createProjectAction({
      title: "Original Shared Project",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Balcony View",
          narration: "Panoramic city view.",
          imagePrompt: "Skyline sunset",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const origId = createRes.data.id;
    createdProjectIds.push(origId);

    const origScene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: origId } });
    const fd = new FormData();
    fd.set("projectId", origId);
    fd.set("sceneId", origScene.id);
    fd.set("file", new File([Buffer.from("shared-image-data")], "shared.webp", { type: "image/webp" }));
    const up = await uploadSceneImageAction(fd);
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const sharedUrl = up.data.imageUrl;
    uploadedLocalPaths.push(sharedUrl);
    expect(await fileExists(sharedUrl)).toBe(true);

    // Duplicate project -> copy references same imageUrl
    const dupRes = await duplicateProjectAction(origId);
    expect(dupRes.ok).toBe(true);
    if (!dupRes.ok) return;
    const copyId = dupRes.data.id;
    createdProjectIds.push(copyId);

    // Delete original project -> shared image MUST remain on disk for duplicated copy
    const delOrig = await deleteProjectAction(origId);
    expect(delOrig.ok).toBe(true);
    expect(await fileExists(sharedUrl)).toBe(true);

    // Delete duplicated copy -> now zero scenes reference it, so asset MUST be deleted
    const delCopy = await deleteProjectAction(copyId);
    expect(delCopy.ok).toBe(true);
    expect(await fileExists(sharedUrl)).toBe(false);
  });

  it("4. Rolls back uploaded asset when DB update fails and rejects cross-project scene upload", async () => {
    const p1 = await createProjectAction({
      title: "Project One",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "S1", narration: "N1", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
      ],
    });
    const p2 = await createProjectAction({
      title: "Project Two",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "S2", narration: "N2", imagePrompt: "P2", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    createdProjectIds.push(p1.data.id, p2.data.id);

    const p2Scene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: p2.data.id } });
    const privateImagesDir = path.join(process.cwd(), "storage", "video-studio", "images");
    await fs.mkdir(privateImagesDir, { recursive: true });
    const filesBefore = await fs.readdir(privateImagesDir);

    // Attempt to upload into project 1 while specifying project 2's sceneId
    const crossFd = new FormData();
    crossFd.set("projectId", p1.data.id);
    crossFd.set("sceneId", p2Scene.id);
    crossFd.set("file", new File([Buffer.from("bad-upload")], "cross.jpg", { type: "image/jpeg" }));
    const crossRes = await uploadSceneImageAction(crossFd);
    expect(crossRes.ok).toBe(false);
    if (!crossRes.ok) {
      expect(crossRes.error).toMatch(/Scene not found in this project/);
    }

    const filesAfterCross = await fs.readdir(privateImagesDir);
    expect(filesAfterCross.length).toBe(filesBefore.length);

    // Simulate unexpected DB write failure after file upload -> newly written file must be cleaned up
    const p1Scene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: p1.data.id } });
    const origUpdate = prisma.videoScene.update.bind(prisma.videoScene);

    Object.defineProperty(prisma.videoScene, "update", {
      configurable: true,
      writable: true,
      enumerable: true,
      value: async () => {
        throw new Error("Simulated DB failure");
      },
    });

    const failFd = new FormData();
    failFd.set("projectId", p1.data.id);
    failFd.set("sceneId", p1Scene.id);
    failFd.set("file", new File([Buffer.from("rollback-test")], "rollback.jpg", { type: "image/jpeg" }));

    let failRes;
    try {
      failRes = await uploadSceneImageAction(failFd);
    } finally {
      Object.defineProperty(prisma.videoScene, "update", {
        configurable: true,
        writable: true,
        enumerable: true,
        value: origUpdate,
      });
    }

    expect(failRes.ok).toBe(false);
    const filesAfterRollback = await fs.readdir(privateImagesDir);
    expect(filesAfterRollback.length).toBe(filesBefore.length);
  });

  it("5. Enforces project ownership on restoreVersionAction and restores snapshots with history", async () => {
    const pA = await createProjectAction({
      title: "Versioned Project A",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "Original Scene A", narration: "Version 1 text", imagePrompt: "Prompt 1", imageUrl: null, duration: 5, locked: false },
      ],
    });
    const pB = await createProjectAction({
      title: "Other Project B",
      category: "market_update",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "Secret B Scene", narration: "Project B only", imagePrompt: "Prompt B", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(pA.ok && pB.ok).toBe(true);
    if (!pA.ok || !pB.ok) return;
    createdProjectIds.push(pA.data.id, pB.data.id);

    const pAVersionsInitial = await getProjectVersions(pA.data.id);
    const pBVersions = await getProjectVersions(pB.data.id);
    expect(pAVersionsInitial.length).toBe(1);
    expect(pBVersions.length).toBe(1);

    // Cross-project IDOR attempt: try restoring Project B's snapshot onto Project A
    const crossRestore = await restoreVersionAction(pA.data.id, pBVersions[0].id);
    expect(crossRestore.ok).toBe(false);
    if (!crossRestore.ok) {
      expect(crossRestore.error).toMatch(/does not belong to this project/i);
    }

    // Save a modified version 2 for Project A
    const pAScene = await prisma.videoScene.findFirstOrThrow({ where: { projectId: pA.data.id } });
    const saveRes = await saveDraftAction({
      projectId: pA.data.id,
      title: "Versioned Project A",
      category: "property_showcase",
      status: "DRAFT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: pAScene.id, order: 1, title: "Modified Scene A", narration: "Version 2 text", imagePrompt: "Prompt 2", imageUrl: null, duration: 8, locked: false },
      ],
    });
    expect(saveRes.ok).toBe(true);
    if (!saveRes.ok) return;
    expect(saveRes.data.scenes[0].title).toBe("Modified Scene A");

    // Restore Project A back to its initial Version 1 snapshot
    const validRestore = await restoreVersionAction(pA.data.id, pAVersionsInitial[0].id);
    expect(validRestore.ok).toBe(true);
    if (!validRestore.ok) return;

    expect(validRestore.data.scenes[0].title).toBe("Original Scene A");
    expect(validRestore.data.scenes[0].narration).toBe("Version 1 text");
    expect(validRestore.data.versions.length).toBe(3);
    expect(validRestore.data.versions[0].reason).toMatch(/Restored from snapshot/);
  });

  it("6. Preserves explicit scene targeting in bulkUploadImagesAction", async () => {
    const pRes = await createProjectAction({
      title: "Bulk Targeting Project",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 30,
      aspectRatio: "16:9",
      scenes: [
        { id: "init_1", order: 1, title: "First Scene", narration: "One", imagePrompt: "P1", imageUrl: null, duration: 5, locked: false },
        { id: "init_2", order: 2, title: "Second Scene", narration: "Two", imagePrompt: "P2", imageUrl: null, duration: 5, locked: false },
      ],
    });
    expect(pRes.ok).toBe(true);
    if (!pRes.ok) return;
    createdProjectIds.push(pRes.data.id);

    const dbScenes = await prisma.videoScene.findMany({
      where: { projectId: pRes.data.id },
      orderBy: { order: "asc" },
    });

    // Pass reversed sceneIds order (matching an unsaved reorder on the client)
    const fd = new FormData();
    fd.set("projectId", pRes.data.id);
    fd.set("sceneIds", JSON.stringify([dbScenes[1].id, dbScenes[0].id]));
    fd.append("files", new File([Buffer.from("first-picked-file")], "picked1.jpg", { type: "image/jpeg" }));

    const bulkRes = await bulkUploadImagesAction(fd);
    if (!bulkRes.ok) {
      throw new Error(`bulkUploadImagesAction failed: ${bulkRes.error}`);
    }
    expect(bulkRes.ok).toBe(true);

    expect(bulkRes.data.assigned).toBe(1);
    expect(bulkRes.data.assignments.length).toBe(1);
    expect(bulkRes.data.assignments[0].sceneId).toBe(dbScenes[1].id);
    uploadedLocalPaths.push(bulkRes.data.assignments[0].imageUrl);
    expect(await fileExists(bulkRes.data.assignments[0].imageUrl)).toBe(true);
  });
});
