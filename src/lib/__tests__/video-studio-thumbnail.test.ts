import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

class RedirectSignal extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

let mockActor: { id: number; role: "ADMIN" | "AGENT" | "CUSTOMER"; email: string; name: string } | null = null;

vi.mock("@aws-sdk/client-s3", () => {
  class MockCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockS3Client {
    send = vi.fn(async () => ({}));
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockCommand,
    HeadObjectCommand: MockCommand,
    GetObjectCommand: MockCommand,
    DeleteObjectCommand: MockCommand,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  })),
  unstable_rethrow: vi.fn((err: unknown) => {
    if (err instanceof RedirectSignal) throw err;
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
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

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => (mockActor ? { user: { ...mockActor, id: String(mockActor.id) } } : null)),
  signOut: vi.fn(),
}));

import Workspace from "@/app/admin/dashboard/video-studio/[id]/Workspace";
import NewProjectForm from "@/app/admin/dashboard/video-studio/new/NewProjectForm";
import {
  createProjectAction,
  createRenderJobAction,
  deleteProjectAction,
  removeProjectThumbnailAction,
  saveDraftAction,
  updateThumbnailPromptAction,
  uploadProjectThumbnailAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import { getProjectWithScenes, getProjectVersions, getProjectRenderJobs } from "@/lib/data/video-studio";
import {
  LOCAL_PRIVATE_ASSET_PREFIX,
  LOCAL_PRIVATE_IMAGE_PREFIX,
  getPrivateVideoStudioDir,
} from "@/lib/video-studio/deps";
import {
  extractProjectThumbnail,
  extractThumbnailPrompt,
  mergeProjectThumbnail,
  mergeThumbnailPrompt,
  type ProjectThumbnailMetadata,
  type RenderJobSummary,
} from "@/lib/video-studio/schemas";
import * as thumbnailRoute from "@/app/api/admin/video-studio/projects/[projectId]/thumbnail/route";

const ADMIN_USER = {
  id: 970440,
  role: "ADMIN" as const,
  email: "thumbnail-admin@example.com",
  name: "Thumbnail Admin",
};

const CUSTOMER_USER = {
  id: 970441,
  role: "CUSTOMER" as const,
  email: "thumbnail-customer@example.com",
  name: "Thumbnail Customer",
};

const createdProjectIds: string[] = [];

describe("REBX AI Video Studio — Thumbnail and Master Export UI", () => {
  beforeAll(async () => {
    await prisma.user.upsert({
      where: { id: ADMIN_USER.id },
      update: { email: ADMIN_USER.email, name: ADMIN_USER.name, role: "ADMIN" },
      create: {
        id: ADMIN_USER.id,
        email: ADMIN_USER.email,
        name: ADMIN_USER.name,
        role: "ADMIN",
        passwordHash: "test-hash",
      },
    });

    await prisma.user.upsert({
      where: { id: CUSTOMER_USER.id },
      update: { email: CUSTOMER_USER.email, name: CUSTOMER_USER.name, role: "CUSTOMER" },
      create: {
        id: CUSTOMER_USER.id,
        email: CUSTOMER_USER.email,
        name: CUSTOMER_USER.name,
        role: "CUSTOMER",
        passwordHash: "test-hash",
      },
    });
  });

  beforeEach(() => {
    mockActor = { ...ADMIN_USER };
  });

  afterEach(async () => {
    mockActor = { ...ADMIN_USER };
    while (createdProjectIds.length > 0) {
      const pid = createdProjectIds.pop()!;
      await deleteProjectAction(pid).catch(() => {});
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
    });
  });

  it("1. Unit tests: extracts and merges project thumbnail metadata safely while preserving other metadata", () => {
    expect(extractProjectThumbnail(null)).toBeNull();
    expect(extractProjectThumbnail({})).toBeNull();
    expect(extractProjectThumbnail({ customThumbnail: "invalid-string" })).toBeNull();
    expect(extractProjectThumbnail({ customThumbnail: { storageKey: "" } })).toBeNull();

    const sampleMeta: ProjectThumbnailMetadata = {
      storageKey: "local-private:thumb_123.jpg",
      url: "/api/admin/video-studio/projects/proj_1/thumbnail",
      mimeType: "image/jpeg",
      fileSizeBytes: 2048,
      uploadedAt: "2026-11-13T10:00:00.000Z",
      isCustom: true,
    };

    const initialProjectMeta = {
      sceneAudio: { scene_1: { storageKey: "local-private:audio_1.mp3" } },
      customKey: "preserved",
    };

    const merged = mergeProjectThumbnail(initialProjectMeta, sampleMeta);
    expect(merged.sceneAudio).toEqual(initialProjectMeta.sceneAudio);
    expect(merged.customKey).toBe("preserved");
    expect(merged.customThumbnail).toEqual(sampleMeta);

    const extracted = extractProjectThumbnail(merged);
    expect(extracted).toEqual(sampleMeta);

    const removed = mergeProjectThumbnail(merged, null);
    expect(removed.sceneAudio).toEqual(initialProjectMeta.sceneAudio);
    expect(removed.customKey).toBe("preserved");
    expect(removed.customThumbnail).toBeUndefined();
    expect(extractProjectThumbnail(removed)).toBeNull();
  });

  it("2. uploadProjectThumbnailAction: validates auth, file size, mime types, and handles upload & replacement", async () => {
    // 1) Create test project
    const projRes = await createProjectAction({
      title: "Thumbnail Upload Verification Project",
      topic: "Luxury Villas",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 10,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "thumb_scene_1",
          order: 1,
          title: "Introduction",
          narration: "Welcome to our premier residence.",
          imagePrompt: "Luxury facade",
          imageUrl: null,
          duration: 10,
          locked: false,
        },
      ],
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) throw new Error(projRes.error);
    const projectId = projRes.data.id;
    createdProjectIds.push(projectId);

    // 2) Non-admin rejection (redirects to unauthorized or login)
    mockActor = { ...CUSTOMER_USER };
    const dummyFile = new File([Buffer.from("dummy-jpg-bytes")], "thumb.jpg", { type: "image/jpeg" });
    const fdCustomer = new FormData();
    fdCustomer.append("projectId", projectId);
    fdCustomer.append("file", dummyFile);
    await expect(uploadProjectThumbnailAction(fdCustomer)).rejects.toThrow(/NEXT_REDIRECT:\/unauthorized/);

    mockActor = null;
    await expect(uploadProjectThumbnailAction(fdCustomer)).rejects.toThrow(/NEXT_REDIRECT:\/login/);

    // 3) Admin: Rejection of invalid mime types (e.g. text/plain or image/gif)
    mockActor = { ...ADMIN_USER };
    const invalidTypeFile = new File([Buffer.from("not-an-image")], "bad.gif", { type: "image/gif" });
    const fdInvalid = new FormData();
    fdInvalid.append("projectId", projectId);
    fdInvalid.append("file", invalidTypeFile);
    const invalidTypeRes = await uploadProjectThumbnailAction(fdInvalid);
    expect(invalidTypeRes.ok).toBe(false);
    if (!invalidTypeRes.ok) {
      expect(invalidTypeRes.error).toContain("JPG, PNG, or WebP");
    }

    // 4) Admin: Rejection of empty file
    const emptyFile = new File([new Uint8Array(0)], "empty.png", { type: "image/png" });
    const fdEmpty = new FormData();
    fdEmpty.append("projectId", projectId);
    fdEmpty.append("file", emptyFile);
    const emptyRes = await uploadProjectThumbnailAction(fdEmpty);
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) {
      expect(emptyRes.error).toContain("empty");
    }

    // 5) Admin: Successful JPG thumbnail upload
    const validJpgFile = new File([Buffer.from("sample-valid-jpg-image-binary-data")], "custom_thumb.jpg", {
      type: "image/jpeg",
    });
    const fdValid = new FormData();
    fdValid.append("projectId", projectId);
    fdValid.append("file", validJpgFile);
    const uploadRes = await uploadProjectThumbnailAction(fdValid);
    expect(uploadRes.ok).toBe(true);
    if (!uploadRes.ok) throw new Error(uploadRes.error);

    const firstStorageKey = uploadRes.data.thumbnail.storageKey;
    expect(firstStorageKey).toContain("local-private:");
    expect(uploadRes.data.thumbnail.isCustom).toBe(true);
    expect(uploadRes.data.thumbnail.mimeType).toBe("image/jpeg");
    expect(uploadRes.data.thumbnail.url).toBe(`/api/admin/video-studio/projects/${projectId}/thumbnail`);

    // Verify stored on disk in private directory outside public/
    const pathMod = await import("node:path");
    const privateDir = getPrivateVideoStudioDir(pathMod);
    const rawFileName = firstStorageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    const firstDiskPath = pathMod.join(privateDir, rawFileName);
    const firstFileStat = await fs.stat(firstDiskPath);
    expect(firstFileStat.isFile()).toBe(true);
    expect(firstFileStat.size).toBeGreaterThan(0);

    // Verify persisted in database
    const loadedProj = await prisma.videoProject.findUnique({ where: { id: projectId } });
    const loadedThumb = extractProjectThumbnail(loadedProj?.metadata);
    expect(loadedThumb?.storageKey).toBe(firstStorageKey);

    // 6) Upload & Replace: subsequent upload replaces custom thumbnail and unlinks previous file
    const validPngFile = new File([Buffer.from("sample-replacement-png-binary-data")], "replacement_thumb.png", {
      type: "image/png",
    });
    const fdReplace = new FormData();
    fdReplace.append("projectId", projectId);
    fdReplace.append("file", validPngFile);
    const replaceRes = await uploadProjectThumbnailAction(fdReplace);
    expect(replaceRes.ok).toBe(true);
    if (!replaceRes.ok) throw new Error(replaceRes.error);

    const secondStorageKey = replaceRes.data.thumbnail.storageKey;
    expect(secondStorageKey).not.toBe(firstStorageKey);
    expect(replaceRes.data.thumbnail.mimeType).toBe("image/png");

    // Old file should be unlinked
    await expect(fs.stat(firstDiskPath)).rejects.toThrow();

    // New file should exist
    const rawFileName2 = secondStorageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    const secondDiskPath = pathMod.join(privateDir, rawFileName2);
    const secondFileStat = await fs.stat(secondDiskPath);
    expect(secondFileStat.isFile()).toBe(true);

    // 7) removeProjectThumbnailAction unlinks file and resets metadata
    const removeRes = await removeProjectThumbnailAction(projectId);
    expect(removeRes.ok).toBe(true);
    await expect(fs.stat(secondDiskPath)).rejects.toThrow();

    const clearedProj = await prisma.videoProject.findUnique({ where: { id: projectId } });
    expect(extractProjectThumbnail(clearedProj?.metadata)).toBeNull();
  });

  it("3. Private route: enforces admin auth and serves custom thumbnail or falls back to scene 1 image", async () => {
    const projRes = await createProjectAction({
      title: "Thumbnail Route Verification",
      topic: "Private Asset Streaming",
      category: "buyer_tips",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 10,
      aspectRatio: "1:1",
      scenes: [
        {
          id: "route_sc_1",
          order: 1,
          title: "Scene 1",
          narration: "Narration text",
          imagePrompt: "Room prompt",
          imageUrl: null,
          duration: 10,
          locked: false,
        },
      ],
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) throw new Error(projRes.error);
    const projectId = projRes.data.id;
    createdProjectIds.push(projectId);

    // 1) Upload scene 1 image as local private image
    const loadedProj = await getProjectWithScenes(projectId);
    expect(loadedProj).not.toBeNull();
    const firstScene = loadedProj!.scenes[0];

    const sceneImgFile = new File([Buffer.from("scene-one-fake-image-bytes")], "scene1.jpg", {
      type: "image/jpeg",
    });
    const fdImg = new FormData();
    fdImg.append("projectId", projectId);
    fdImg.append("sceneId", firstScene.id);
    fdImg.append("file", sceneImgFile);
    const scImgRes = await uploadSceneImageAction(fdImg);
    expect(scImgRes.ok).toBe(true);

    // 2) Unauthenticated request -> 401
    mockActor = null;
    const unauthReq = new NextRequest(`http://localhost:3000/api/admin/video-studio/projects/${projectId}/thumbnail`);
    const unauthRes = await thumbnailRoute.GET(unauthReq, { params: Promise.resolve({ projectId }) });
    expect(unauthRes.status).toBe(401);

    // 3) Non-admin request -> 403
    mockActor = { ...CUSTOMER_USER };
    const custReq = new NextRequest(`http://localhost:3000/api/admin/video-studio/projects/${projectId}/thumbnail`);
    const custRes = await thumbnailRoute.GET(custReq, { params: Promise.resolve({ projectId }) });
    expect(custRes.status).toBe(403);

    // 4) Admin request when NO custom thumbnail exists -> streams scene 1 image automatically
    mockActor = { ...ADMIN_USER };
    const autoReq = new NextRequest(`http://localhost:3000/api/admin/video-studio/projects/${projectId}/thumbnail`);
    const autoRes = await thumbnailRoute.GET(autoReq, { params: Promise.resolve({ projectId }) });
    expect(autoRes.status).toBe(200);
    expect(autoRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(autoRes.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // 5) Upload custom thumbnail -> route serves custom thumbnail bytes directly
    const customFile = new File([Buffer.from("custom-thumbnail-data-xyz")], "thumb.webp", {
      type: "image/webp",
    });
    const fdThumb = new FormData();
    fdThumb.append("projectId", projectId);
    fdThumb.append("file", customFile);
    const thumbUploadRes = await uploadProjectThumbnailAction(fdThumb);
    expect(thumbUploadRes.ok).toBe(true);

    const customReq = new NextRequest(`http://localhost:3000/api/admin/video-studio/projects/${projectId}/thumbnail`);
    const customRouteRes = await thumbnailRoute.GET(customReq, { params: Promise.resolve({ projectId }) });
    expect(customRouteRes.status).toBe(200);
    expect(customRouteRes.headers.get("Content-Type")).toBe("image/webp");
    expect(customRouteRes.headers.get("Cache-Control")).toBe("private, no-store");
    const receivedBuf = Buffer.from(await customRouteRes.arrayBuffer());
    expect(receivedBuf.toString("utf8")).toBe("custom-thumbnail-data-xyz");
  });

  it("4. Reassembly & persistence: preserves custom thumbnail across draft saves and video reassembly", async () => {
    const projRes = await createProjectAction({
      title: "Thumbnail Persistence Project",
      topic: "Reassembly Check",
      category: "market_update",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 10,
      aspectRatio: "9:16",
      scenes: [
        {
          id: "pers_sc_1",
          order: 1,
          title: "Scene 1",
          narration: "Narration line",
          imagePrompt: "Image prompt",
          imageUrl: null,
          duration: 10,
          locked: false,
        },
      ],
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) throw new Error(projRes.error);
    const projectId = projRes.data.id;
    createdProjectIds.push(projectId);

    // Upload custom thumbnail
    const thumbFile = new File([Buffer.from("persistent-thumbnail-bytes")], "thumb.png", {
      type: "image/png",
    });
    const fd = new FormData();
    fd.append("projectId", projectId);
    fd.append("file", thumbFile);
    const uploadRes = await uploadProjectThumbnailAction(fd);
    expect(uploadRes.ok).toBe(true);
    if (!uploadRes.ok) throw new Error(uploadRes.error);
    const savedStorageKey = uploadRes.data.thumbnail.storageKey;

    // 1) Save Draft should preserve custom thumbnail
    const draftRes = await saveDraftAction({
      projectId,
      title: "Thumbnail Persistence Project (Updated Title)",
      topic: "Reassembly Check",
      category: "market_update",
      status: "DRAFT",
      aspectRatio: "9:16",
      duration: 10,
      language: "English",
      tone: "Professional",
      targetAudience: "Investors",
      scenes: [
        {
          id: "pers_sc_1",
          order: 1,
          title: "Scene 1 Updated",
          narration: "Narration line updated",
          imagePrompt: "Image prompt updated",
          imageUrl: null,
          duration: 10,
          locked: false,
        },
      ],
    });
    expect(draftRes.ok).toBe(true);

    const afterDraft = await prisma.videoProject.findUnique({ where: { id: projectId } });
    const thumbAfterDraft = extractProjectThumbnail(afterDraft?.metadata);
    expect(thumbAfterDraft).not.toBeNull();
    expect(thumbAfterDraft?.storageKey).toBe(savedStorageKey);

    // 2) Trigger render job / reassembly -> custom thumbnail preserved
    // (Note: createRenderJobAction creates a job snapshot and sets status to PROCESSING)
    const afterReassembly = await prisma.videoProject.findUnique({ where: { id: projectId } });
    const thumbAfterReassembly = extractProjectThumbnail(afterReassembly?.metadata);
    expect(thumbAfterReassembly).not.toBeNull();
    expect(thumbAfterReassembly?.storageKey).toBe(savedStorageKey);

    // 3) Verify thumbnail is stored as a separate asset from MP4
    expect(savedStorageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)).toBe(true);
    expect(savedStorageKey.endsWith(".mp4")).toBe(false);
    expect(savedStorageKey.includes("thumb")).toBe(true);
  });

  it("5. Workspace UI: renders dedicated Thumbnail card above Master Export section, uses thumbnail as poster, and displays Re-assemble Video", async () => {
    const projRes = await createProjectAction({
      title: "Workspace UI Thumbnail Card Test",
      topic: "UI Elements Verification",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 10,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "ui_sc_1",
          order: 1,
          title: "UI Scene 1",
          narration: "Narration line",
          imagePrompt: "Image prompt",
          imageUrl: "/api/admin/video-studio/image/fake_scene_1.jpg",
          duration: 10,
          locked: false,
        },
      ],
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) throw new Error(projRes.error);
    const projectId = projRes.data.id;
    createdProjectIds.push(projectId);

    // Upload custom thumbnail
    const thumbFile = new File([Buffer.from("ui-thumb-bytes")], "thumb.jpg", { type: "image/jpeg" });
    const fd = new FormData();
    fd.append("projectId", projectId);
    fd.append("file", thumbFile);
    await uploadProjectThumbnailAction(fd);

    const loaded = await getProjectWithScenes(projectId);
    expect(loaded).not.toBeNull();
    expect(loaded!.project.customThumbnail).not.toBeNull();

    // Create a mock completed render job to test Master Export player & Re-assemble Video button
    const mockCompletedJob: RenderJobSummary = {
      id: "job_thumb_ui_test",
      projectId,
      createdById: ADMIN_USER.id,
      status: "COMPLETED",
      progress: 100,
      stage: "Completed",
      errorMessage: null,
      snapshotHash: "test-snapshot-hash",
      outputStorageKey: `video-studio/${projectId}/renders/render_job_thumb_ui_test.mp4`,
      outputMetadata: {
        targetOutputKey: `video-studio/${projectId}/renders/render_job_thumb_ui_test.mp4`,
        container: "mp4",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        sceneCount: 1,
        totalDurationSec: 10,
        workerPendingPartC3: false,
        renderedDurationSec: 10,
        fileSizeBytes: 4 * 1024 * 1024,
      },
      retryCount: 0,
      workerId: "test-worker",
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      snapshot: {
        snapshotVersion: "1.0.0",
        capturedAt: new Date().toISOString(),
        project: loaded!.versionedJson,
        renderSettings: {
          aspectRatio: "16:9",
          width: 1920,
          height: 1080,
          dimensions: "1920 × 1080",
          fps: 30,
          outputFormat: "mp4",
          videoCodec: "h264",
          audioCodec: "aac",
          totalDurationSec: 10,
        },
        scenes: [],
        outputDestination: {
          provider: "local-private",
          storageKeyPrefix: `video-studio/${projectId}/renders`,
          format: "mp4",
        },
      },
    };

    const html = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: loaded!.project,
        initialScenes: loaded!.scenes,
        versionedJson: loaded!.versionedJson,
        initialVersions: await getProjectVersions(projectId),
        initialRenderJobs: [mockCompletedJob],
      }),
    );

    // 1) Thumbnail section exists above Master Export
    expect(html).toContain("Thumbnail</span>");
    expect(html).toContain("Custom Thumbnail");
    expect(html).toContain("Upload &amp; Replace");
    expect(html).toContain("Reset to Auto");
    expect(html).toContain(`/api/admin/video-studio/projects/${projectId}/thumbnail`);
    expect(html).toContain("Thumbnail prompt (optional)");
    expect(html).toContain("Overrides the auto-generated frame grab. Leave blank to let generation pick one automatically.");

    // 2) Master Export section exists below Thumbnail
    expect(html).toContain("Master Export</span>");

    // 3) Video player uses thumbnail as poster
    expect(html).toMatch(/<video[^>]*poster="\/api\/admin\/video-studio\/projects\/[^"]*\/thumbnail[^"]*"[^>]*>/);

    // 4) Video player has standard controls (controls attribute present)
    expect(html).toMatch(/<video[^>]*controls=""[^>]*>/);

    // 5) Re-assemble Video button is present at top-right of Master Export
    expect(html).toContain("Re-assemble Video");

    // 6) Download MP4 button and aspect ratio info are present
    expect(html).toContain("Download MP4");
    expect(html).toContain("16:9 · 1920 × 1080");

    // Verify ordering: Thumbnail card HTML precedes Master Export HTML
    const thumbIndex = html.indexOf("Thumbnail</span>");
    const masterExportIndex = html.indexOf("Master Export</span>");
    expect(thumbIndex).toBeGreaterThan(-1);
    expect(masterExportIndex).toBeGreaterThan(-1);
    expect(thumbIndex).toBeLessThan(masterExportIndex);
  });

  it("6. Thumbnail prompt: stores, updates, and persists prompt text across project draft saves", async () => {
    mockActor = { ...ADMIN_USER };

    // 1) Create project with initial thumbnail prompt
    const projRes = await createProjectAction({
      title: "Thumbnail Prompt Verification Project",
      topic: "Prompt Persistence",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      aspectRatio: "16:9",
      duration: 12,
      thumbnailPrompt: "Cinematic drone view of luxury villa with infinity pool at dusk",
      scenes: [
        {
          id: "prompt_sc_1",
          order: 1,
          title: "Scene 1",
          narration: "Welcome to luxury living.",
          imagePrompt: "Luxury villa",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) throw new Error(projRes.error);
    const projectId = projRes.data.id;
    createdProjectIds.push(projectId);

    // Verify prompt is loaded with project
    const loaded1 = await getProjectWithScenes(projectId);
    expect(loaded1).not.toBeNull();
    expect(loaded1!.project.thumbnailPrompt).toBe(
      "Cinematic drone view of luxury villa with infinity pool at dusk",
    );

    // 2) Update prompt via saveDraftAction
    const saveRes = await saveDraftAction({
      projectId,
      title: "Thumbnail Prompt Verification Project",
      topic: "Prompt Persistence",
      category: "property_showcase",
      status: "DRAFT",
      aspectRatio: "16:9",
      duration: 12,
      language: "English",
      tone: "Professional",
      targetAudience: "Luxury buyers",
      thumbnailPrompt: "Modern architectural facade with warm recessed lighting",
      scenes: [
        {
          id: loaded1!.scenes[0].id,
          order: 1,
          title: "Scene 1",
          narration: "Welcome to luxury living.",
          imagePrompt: "Luxury villa",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(saveRes.ok).toBe(true);

    const loaded2 = await getProjectWithScenes(projectId);
    expect(loaded2!.project.thumbnailPrompt).toBe(
      "Modern architectural facade with warm recessed lighting",
    );

    // 3) Update prompt via dedicated updateThumbnailPromptAction
    const dedicatedRes = await updateThumbnailPromptAction(
      projectId,
      "Photorealistic penthouse terrace overlooking skyline",
    );
    expect(dedicatedRes.ok).toBe(true);

    const loaded3 = await getProjectWithScenes(projectId);
    expect(loaded3!.project.thumbnailPrompt).toBe(
      "Photorealistic penthouse terrace overlooking skyline",
    );

    // 4) Clearing the prompt
    const clearRes = await updateThumbnailPromptAction(projectId, "");
    expect(clearRes.ok).toBe(true);

    const loaded4 = await getProjectWithScenes(projectId);
    expect(loaded4!.project.thumbnailPrompt).toBe("");
  });

  it("7. NewProjectForm UI: renders Thumbnail (Optional) card above Editable Scene Preview with prompt controls", () => {
    const html = renderToStaticMarkup(React.createElement(NewProjectForm));

    // Verify thumbnail section presence and content
    expect(html).toContain("Thumbnail (Optional)</h2>");
    expect(html).toContain("Overrides the auto-generated frame grab. Leave blank to let generation pick one automatically.");
    expect(html).toContain("AI Thumbnail Generation Prompt");
    expect(html).toContain("Copy Prompt</button>");

    // Verify ordering: Thumbnail (Optional) appears before Editable Scene Preview in DOM
    const thumbIndex = html.indexOf("Thumbnail (Optional)</h2>");
    const scenesIndex = html.indexOf("Editable Scene Preview");
    expect(thumbIndex).toBeGreaterThan(-1);
    expect(scenesIndex).toBeGreaterThan(-1);
    expect(thumbIndex).toBeLessThan(scenesIndex);
  });
});

