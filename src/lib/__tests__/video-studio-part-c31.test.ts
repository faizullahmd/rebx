import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
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
  getRenderJobAction,
  retryRenderJobAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX } from "@/lib/video-studio/deps";
import {
  recoverExpiredRenderJobs,
  transitionRenderJobInternal,
} from "@/lib/video-studio/render-jobs";
import { verifyWorkerAuthHeaders } from "@/lib/video-studio/worker-auth";
import * as claimRoute from "@/app/api/internal/video-studio/render-jobs/claim/route";
import * as recoverRoute from "@/app/api/internal/video-studio/render-jobs/recover/route";
import * as progressRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/progress/route";
import * as heartbeatRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/heartbeat/route";
import * as completeRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/complete/route";
import * as failRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/fail/route";

import {
  RenderWorkerApiClient,
  WorkerApiConnectionError,
  WorkerApiHttpError,
  WorkerApiTimeoutError,
} from "../../../worker/video-renderer/src/client";
import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import { checkFfmpegEnvironment } from "../../../worker/video-renderer/src/ffmpeg";
import { createWorkerLogger, type WorkerLogEntry } from "../../../worker/video-renderer/src/logger";
import {
  PART_C31_NOT_IMPLEMENTED_MESSAGE,
  processClaimedRenderJobPlaceholder,
} from "../../../worker/video-renderer/src/processor";
import { VideoRenderWorker } from "../../../worker/video-renderer/src/worker";

const ADMIN_USER = {
  id: 970001,
  role: "ADMIN" as const,
  email: "video-studio-admin97@example.com",
  name: "Studio Admin Part C31",
};

const WORKER_SECRET = "c31-super-secret-worker-token-value-9876543210";
const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const localOutputFiles: string[] = [];
const originalEnv = { ...process.env };

function makeValidMinimalMp4Buffer(totalBytes: number): Buffer {
  const header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, // box size 24
    0x66, 0x74, 0x79, 0x70, // "ftyp"
    0x69, 0x73, 0x6f, 0x6d, // "isom"
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x6d, 0x70, 0x34, 0x31,
  ]);
  const buf = Buffer.alloc(totalBytes, 0);
  header.copy(buf, 0, 0, Math.min(header.length, totalBytes));
  return buf;
}

async function stageTestOutputMp4File(relParts: string[], totalBytes: number): Promise<void> {
  const targetPath = path.join(process.cwd(), "storage", ...relParts);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, makeValidMinimalMp4Buffer(totalBytes));
  localOutputFiles.push(targetPath);
}

function makeMp3Buffer(tag = "c31"): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const payload = Buffer.from(`rebx-c31-audio-${tag}`, "utf8");
  return Buffer.concat([header, frame, payload]);
}

function makeWorkerRequest(urlPath: string, opts: {
  secret?: string | null;
  authHeader?: string | null;
  body?: unknown;
  rawBody?: string;
} = {}): NextRequest {
  const headers = new Headers();
  if (opts.authHeader !== undefined) {
    if (opts.authHeader !== null) headers.set("Authorization", opts.authHeader);
  } else if (opts.secret !== null) {
    headers.set("Authorization", `Bearer ${opts.secret ?? WORKER_SECRET}`);
  }
  headers.set("Content-Type", "application/json");

  const bodyStr =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined;

  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: "POST",
    headers,
    body: bodyStr,
  });
}

/**
 *Routes real fetch calls from RenderWorkerApiClient directly through the Next.js Route Handlers
 *against rebx_test without requiring an external bound HTTP port.
 */
function createInProcessRouteFetch(): typeof fetch {
  return async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname;

    const req = new NextRequest(rawUrl, {
      method: init?.method ?? "POST",
      headers: init?.headers,
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal ?? undefined,
    });

    if (pathname === "/api/internal/video-studio/render-jobs/claim") {
      return claimRoute.POST(req);
    }
    if (pathname === "/api/internal/video-studio/render-jobs/recover") {
      return recoverRoute.POST(req);
    }

    const match = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/(progress|heartbeat|complete|fail)$/.exec(
      pathname,
    );
    if (match) {
      const jobId = decodeURIComponent(match[1]);
      const action = match[2];
      const ctx = { params: Promise.resolve({ jobId }) };
      if (action === "progress") return progressRoute.POST(req, ctx);
      if (action === "heartbeat") return heartbeatRoute.POST(req, ctx);
      if (action === "complete") return completeRoute.POST(req, ctx);
      if (action === "fail") return failRoute.POST(req, ctx);
    }

    return new Response(JSON.stringify({ ok: false, error: "Not found" }), { status: 404 });
  };
}

async function createRenderReadyProject(title = "C31 Render Project"): Promise<{
  projectId: string;
  sceneIds: string[];
}> {
  const proj = await createProjectAction({
    title,
    topic: "Gachibowli Luxury Tower Walkthrough",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Professional",
    duration: 24,
    aspectRatio: "16:9",
    scenes: [
      {
        id: "init_1",
        order: 1,
        title: "Exterior Arrival",
        narration: "Welcome to Skyline Residences in Gachibowli.",
        imagePrompt: "Modern tower facade",
        imageUrl: null,
        duration: 6,
        locked: false,
      },
      {
        id: "init_2",
        order: 2,
        title: "Living Area",
        narration: "Spacious double-height living room bathed in daylight.",
        imagePrompt: "Minimalist luxury living room",
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

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const imgFd = new FormData();
    imgFd.set("projectId", projectId);
    imgFd.set("sceneId", s.id);
    imgFd.set(
      "file",
      new File([Buffer.from(`c31-img-${i}-${Date.now()}`)], `scene_${i + 1}.jpg`, { type: "image/jpeg" }),
    );
    const imgRes = await uploadSceneImageAction(imgFd);
    expect(imgRes.ok).toBe(true);
    if (!imgRes.ok) throw new Error(imgRes.error);
    localImageUrls.push(imgRes.data.imageUrl);

    const audFd = new FormData();
    audFd.set("projectId", projectId);
    audFd.set("sceneId", s.id);
    audFd.set("language", "en-IN");
    audFd.set(
      "file",
      new File([new Uint8Array(makeMp3Buffer(`c31_${i}`))], `voice_${i + 1}.mp3`, { type: "audio/mpeg" }),
    );
    const audRes = await uploadSceneAudioAction(audFd);
    expect(audRes.ok).toBe(true);
    if (!audRes.ok) throw new Error(audRes.error);
    localAudioKeys.push(audRes.data.audio.storageKey);
  }

  return {
    projectId,
    sceneIds: scenes.map((s) => s.id),
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
        if (a?.storageKey?.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) localAudioKeys.push(a.storageKey);
      }
    }
  }

  await prisma.videoProject.deleteMany({
    where: { OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }] },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_USER.id] } },
  });

  for (const url of new Set(localImageUrls)) {
    if (url.startsWith("/api/admin/video-studio/image/")) {
      const filename = url.slice("/api/admin/video-studio/image/".length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", "images", filename)).catch(() => {});
    } else if (url.startsWith("/uploads/video-studio/")) {
      const filename = url.slice("/uploads/video-studio/".length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", "images", filename)).catch(() => {});
    }
  }
  for (const key of new Set(localAudioKeys)) {
    if (key.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      const filename = key.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", filename)).catch(() => {});
    }
  }
  for (const outPath of new Set(localOutputFiles.splice(0))) {
    await fs.unlink(outPath).catch(() => {});
  }
}

describe("REBX AI Video Studio - Phase 3 Part C3.1: Background Worker Foundation", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: ADMIN_USER.id,
        name: ADMIN_USER.name,
        email: ADMIN_USER.email,
        role: "ADMIN",
        passwordHash: "x",
      },
    });
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STORAGE_PROVIDER = "local";
    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = WORKER_SECRET;
    mockActor = { ...ADMIN_USER };
  });

  afterAll(async () => {
    await cleanup();
    process.env = { ...originalEnv };
  });

  it("1. Enforces worker authentication (401/403), fail-closed config, constant-time compare, and never exposes secrets", async () => {
    // Direct constant-time verifier unit tests
    expect(
      verifyWorkerAuthHeaders({
        authHeader: `Bearer ${WORKER_SECRET}`,
        workerEnabled: "true",
        configuredSecret: WORKER_SECRET,
      }),
    ).toEqual({ ok: true });

    expect(
      verifyWorkerAuthHeaders({
        authHeader: null,
        workerEnabled: "true",
        configuredSecret: WORKER_SECRET,
      }),
    ).toMatchObject({ ok: false, status: 401 });

    expect(
      verifyWorkerAuthHeaders({
        authHeader: "Basic abc123",
        workerEnabled: "true",
        configuredSecret: WORKER_SECRET,
      }),
    ).toMatchObject({ ok: false, status: 401 });

    expect(
      verifyWorkerAuthHeaders({
        authHeader: `Bearer ${WORKER_SECRET}`,
        workerEnabled: "false",
        configuredSecret: WORKER_SECRET,
      }),
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      verifyWorkerAuthHeaders({
        authHeader: `Bearer ${WORKER_SECRET}`,
        workerEnabled: "true",
        configuredSecret: "",
      }),
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      verifyWorkerAuthHeaders({
        authHeader: "Bearer short-wrong-token",
        workerEnabled: "true",
        configuredSecret: WORKER_SECRET,
      }),
    ).toMatchObject({ ok: false, status: 403 });

    // HTTP endpoint authentication tests
    const missingAuthRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        secret: null,
        body: { workerId: "worker-1" },
      }),
    );
    expect(missingAuthRes.status).toBe(401);
    const missingText = await missingAuthRes.text();
    expect(missingText).not.toContain(WORKER_SECRET);

    const wrongSecretRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        secret: "invalid-secret-token",
        body: { workerId: "worker-1" },
      }),
    );
    expect(wrongSecretRes.status).toBe(403);
    const wrongText = await wrongSecretRes.text();
    expect(wrongText).not.toContain(WORKER_SECRET);

    process.env.RENDER_WORKER_ENABLED = "false";
    const disabledRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        secret: WORKER_SECRET,
        body: { workerId: "worker-1" },
      }),
    );
    expect(disabledRes.status).toBe(403);

    // Confirm server actions NEVER expose worker mutation functions to browser callers
    const exportedActionNames = Object.keys(videoStudioActions);
    expect(exportedActionNames).not.toContain("claimNextRenderJobForWorker");
    expect(exportedActionNames).not.toContain("completeRenderJobForWorker");
    expect(exportedActionNames).not.toContain("updateRenderJobProgressForWorker");
    expect(exportedActionNames).not.toContain("heartbeatRenderJobForWorker");
    expect(exportedActionNames).not.toContain("failRenderJobForWorker");
    expect(exportedActionNames).not.toContain("recoverExpiredRenderJobs");
  });

  it("2. Atomically claims PENDING & QUEUED jobs, returns immutable snapshots, and prevents double-claiming under concurrent worker race", async () => {
    // Isolate queue in test DB so only this test's jobs exist
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const { projectId } = await createRenderReadyProject("Atomic Claim Project");
    const created = await createRenderJobAction({ projectId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Two workers race concurrently to claim the same single PENDING job
    const [resA, resB] = await Promise.all([
      claimRoute.POST(
        makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
          body: { workerId: "worker-alpha", leaseDurationSec: 120 },
        }),
      ),
      claimRoute.POST(
        makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
          body: { workerId: "worker-beta", leaseDurationSec: 120 },
        }),
      ),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const jsonA = (await resA.json()) as { ok: boolean; claimed: boolean; job: { id: string; workerId: string; status: string; startedAt: string; leaseExpiresAt: string; snapshot: unknown } | null };
    const jsonB = (await resB.json()) as { ok: boolean; claimed: boolean; job: { id: string; workerId: string; status: string; startedAt: string; leaseExpiresAt: string; snapshot: unknown } | null };

    const claims = [jsonA, jsonB];
    const winners = claims.filter((c) => c.claimed);
    const losers = claims.filter((c) => !c.claimed);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].job).toBeNull();

    const winnerJob = winners[0].job!;
    expect(winnerJob.id).toBe(created.data.id);
    expect(winnerJob.status).toBe("PROCESSING");
    expect(["worker-alpha", "worker-beta"]).toContain(winnerJob.workerId);
    expect(winnerJob.startedAt).toBeTruthy();
    expect(winnerJob.leaseExpiresAt).toBeTruthy();
    expect((winnerJob.snapshot as { scenes: unknown[] }).scenes).toHaveLength(2);

    // Now test claiming a QUEUED job cleanly
    const failedJob = await transitionRenderJobInternal({
      projectId,
      jobId: created.data.id,
      targetStatus: "FAILED",
      errorMessage: "Reset for queue claim test",
    });
    expect(failedJob.status).toBe("FAILED");

    const retried = await retryRenderJobAction({ projectId, jobId: created.data.id });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.data.status).toBe("QUEUED");
    expect(retried.data.workerId).toBeNull();

    const queuedClaimRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "worker-gamma", leaseDurationSec: 180 },
      }),
    );
    expect(queuedClaimRes.status).toBe(200);
    const queuedClaimJson = (await queuedClaimRes.json()) as {
      claimed: boolean;
      job: { id: string; status: string; workerId: string } | null;
    };
    expect(queuedClaimJson.claimed).toBe(true);
    expect(queuedClaimJson.job?.id).toBe(created.data.id);
    expect(queuedClaimJson.job?.status).toBe("PROCESSING");
    expect(queuedClaimJson.job?.workerId).toBe("worker-gamma");
  });

  it("3. Validates worker payloads via Zod and rejects arbitrary/unverified outputStorageKey or mismatched output metadata", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const { projectId } = await createRenderReadyProject("Payload Validation Project");
    const created = await createRenderJobAction({ projectId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.data.id;

    // Invalid claim payloads
    const badJsonRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", { rawBody: "{broken" }),
    );
    expect(badJsonRes.status).toBe(400);

    const badWorkerIdRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "bad worker/with spaces!" },
      }),
    );
    expect(badWorkerIdRes.status).toBe(400);

    const badLeaseRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "worker-valid", leaseDurationSec: 5 },
      }),
    );
    expect(badLeaseRes.status).toBe(400);

    // Valid claim
    const claimRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "worker-valid" },
      }),
    );
    expect(claimRes.status).toBe(200);

    // Invalid progress payloads (out of range / decimal)
    const decimalProgRes = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "worker-valid", progress: 42.5 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(decimalProgRes.status).toBe(400);

    const over100ProgRes = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "worker-valid", progress: 105 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(over100ProgRes.status).toBe(400);

    // Valid metadata template for completion validation tests
    const validMeta = {
      container: "mp4",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      sceneCount: 2,
      totalDurationSec: 14,
      fileSizeBytes: 512000,
      renderedDurationSec: 14,
    };

    // Arbitrary outputStorageKey -> rejected 422
    const traversalKeyRes = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "worker-valid",
          outputStorageKey: "../../etc/passwd.mp4",
          outputMetadata: validMeta,
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(traversalKeyRes.status).toBe(422);

    const otherProjectKeyRes = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "worker-valid",
          outputStorageKey: `video-studio/wrong_project/renders/render_${jobId}.mp4`,
          outputMetadata: validMeta,
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(otherProjectKeyRes.status).toBe(422);

    const urlKeyRes = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "worker-valid",
          outputStorageKey: "https://evil.example.com/render.mp4",
          outputMetadata: validMeta,
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(urlKeyRes.status).toBe(422);

    // Mismatched dimensions vs snapshot -> rejected 422
    const badDimsRes = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "worker-valid",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: { ...validMeta, width: 1080, height: 1920 },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(badDimsRes.status).toBe(422);

    // Clean completion with authorized key + matching metadata + verified stored MP4 -> 200
    await stageTestOutputMp4File(["video-studio", `render_${jobId}.mp4`], validMeta.fileSizeBytes);
    const okCompleteRes = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "worker-valid",
          outputStorageKey: `local-private:render_${jobId}.mp4`,
          outputMetadata: validMeta,
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(okCompleteRes.status).toBe(200);
    const completeJson = (await okCompleteRes.json()) as { ok: boolean; job: { status: string; progress: number; outputStorageKey: string } };
    expect(completeJson.job.status).toBe("COMPLETED");
    expect(completeJson.job.progress).toBe(100);
    expect(completeJson.job.outputStorageKey).toBe(`local-private:render_${jobId}.mp4`);
  });

  it("4. Supports progress + heartbeat lease extension, rejects progress regression, blocks unclaimed workers (403), and enforces invalid state transitions (409)", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const { projectId } = await createRenderReadyProject("Progress & Ownership Project");
    const created = await createRenderJobAction({ projectId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.data.id;

    // Unclaimed PENDING job: worker attempting completion or progress -> 403
    const unclaimedProgress = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "rogue-worker", progress: 50 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(unclaimedProgress.status).toBe(403);

    const unclaimedComplete = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "rogue-worker",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: {
            container: "mp4",
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            fps: 30,
            sceneCount: 2,
            totalDurationSec: 14,
            fileSizeBytes: 1000,
            renderedDurationSec: 14,
          },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(unclaimedComplete.status).toBe(403);

    // Owner claims job
    const claimRes = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "owner-worker", leaseDurationSec: 60 },
      }),
    );
    expect(claimRes.status).toBe(200);
    const claimJson = (await claimRes.json()) as { job: { leaseExpiresAt: string } };
    const initialLeaseMs = new Date(claimJson.job.leaseExpiresAt).getTime();

    // Update progress forward (35%)
    const prog35 = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "owner-worker", progress: 35, stage: "Downloading assets" },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(prog35.status).toBe(200);
    const prog35Json = (await prog35.json()) as { job: { progress: number; stage: string } };
    expect(prog35Json.job.progress).toBe(35);
    expect(prog35Json.job.stage).toBe("Downloading assets");

    // Heartbeat extends lease cleanly while preserving progress
    const hbRes = await heartbeatRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/heartbeat`, {
        body: { workerId: "owner-worker", leaseDurationSec: 300 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(hbRes.status).toBe(200);
    const hbJson = (await hbRes.json()) as { job: { progress: number; leaseExpiresAt: string } };
    expect(hbJson.job.progress).toBe(35);
    expect(new Date(hbJson.job.leaseExpiresAt).getTime()).toBeGreaterThan(initialLeaseMs);

    // Advance to 60%, then attempt regression to 25% -> 409
    const prog60 = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "owner-worker", progress: 60 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(prog60.status).toBe(200);

    const regressed = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "owner-worker", progress: 25 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(regressed.status).toBe(409);

    // Another worker attempting progress/complete/fail -> 403
    const wrongWorkerComplete = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "imposter-worker",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: {
            container: "mp4",
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            fps: 30,
            sceneCount: 2,
            totalDurationSec: 14,
            fileSizeBytes: 1000,
            renderedDurationSec: 14,
          },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(wrongWorkerComplete.status).toBe(403);

    // Owner completes job cleanly after storing verified MP4
    await stageTestOutputMp4File(
      ["video-studio", projectId, "renders", `render_${jobId}.mp4`],
      1024000,
    );
    const completeOk = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "owner-worker",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: {
            container: "mp4",
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            fps: 30,
            sceneCount: 2,
            totalDurationSec: 14,
            fileSizeBytes: 1024000,
            renderedDurationSec: 14,
          },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(completeOk.status).toBe(200);

    // Idempotent retry of exact same completion payload -> 200 without duplicating/mutating state;
    // conflicting completion or post-complete progress -> 409
    const idempotentReplay = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "owner-worker",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: {
            container: "mp4",
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            fps: 30,
            sceneCount: 2,
            totalDurationSec: 14,
            fileSizeBytes: 1024000,
            renderedDurationSec: 14,
          },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(idempotentReplay.status).toBe(200);

    const conflictingComplete = await completeRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/complete`, {
        body: {
          workerId: "owner-worker",
          outputStorageKey: `video-studio/${projectId}/renders/render_${jobId}.mp4`,
          outputMetadata: {
            container: "mp4",
            aspectRatio: "16:9",
            width: 1920,
            height: 1080,
            fps: 30,
            sceneCount: 2,
            totalDurationSec: 14,
            fileSizeBytes: 2048000,
            renderedDurationSec: 14,
          },
        },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(conflictingComplete.status).toBe(409);

    const postCompleteProgress = await progressRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/progress`, {
        body: { workerId: "owner-worker", progress: 100 },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(postCompleteProgress.status).toBe(409);

    // Verify cancelling a queued/pending job leaves worker fields null and prevents completion
    const job2Res = await createRenderJobAction({ projectId });
    expect(job2Res.ok).toBe(true);
    if (!job2Res.ok) return;
    const cancelRes = await cancelRenderJobAction({ projectId, jobId: job2Res.data.id });
    expect(cancelRes.ok).toBe(true);
    if (!cancelRes.ok) return;
    expect(cancelRes.data.workerId).toBeNull();
    expect(cancelRes.data.leaseExpiresAt).toBeNull();
  });

  it("5. Recovers abandoned PROCESSING jobs on lease expiry and stops retrying after maxAutoRetries", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const { projectId } = await createRenderReadyProject("Lease Expiry Project");
    const created = await createRenderJobAction({ projectId });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.data.id;

    // Claim by crashing-worker-1
    const claim1 = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "crashing-worker-1", leaseDurationSec: 60 },
      }),
    );
    expect(claim1.status).toBe(200);

    // Simulate lease expiry in the past
    const expiredDate = new Date(Date.now() - 60_000);
    await prisma.videoRenderJob.update({
      where: { id: jobId },
      data: {
        leaseExpiresAt: expiredDate,
        progress: 45,
      },
    });

    // Stale zombie worker cannot update after lease expired
    const zombieHb = await heartbeatRoute.POST(
      makeWorkerRequest(`/api/internal/video-studio/render-jobs/${jobId}/heartbeat`, {
        body: { workerId: "crashing-worker-1" },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(zombieHb.status).toBe(409);

    // Recover expired leases endpoint re-queues cleanly with retryCount incremented (0 -> 1)
    const recoverRes = await recoverRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/recover", {
        body: { maxAutoRetries: 3 },
      }),
    );
    expect(recoverRes.status).toBe(200);
    const recoverJson = (await recoverRes.json()) as { requeuedJobIds: string[]; failedJobIds: string[] };
    expect(recoverJson.requeuedJobIds).toContain(jobId);

    const afterRecover = await getRenderJobAction({ projectId, jobId });
    expect(afterRecover.ok).toBe(true);
    if (!afterRecover.ok) return;
    expect(afterRecover.data.status).toBe("QUEUED");
    expect(afterRecover.data.progress).toBe(0);
    expect(afterRecover.data.retryCount).toBe(1);
    expect(afterRecover.data.workerId).toBeNull();
    expect(afterRecover.data.leaseExpiresAt).toBeNull();
    expect(afterRecover.data.startedAt).toBeNull();

    // Reclaim by healthy worker, then simulate max retries reached (retryCount: 3) + expired lease -> permanently FAILED (no infinite retries!)
    const claim2 = await claimRoute.POST(
      makeWorkerRequest("/api/internal/video-studio/render-jobs/claim", {
        body: { workerId: "worker-2", leaseDurationSec: 60 },
      }),
    );
    expect(claim2.status).toBe(200);

    await prisma.videoRenderJob.update({
      where: { id: jobId },
      data: {
        retryCount: 3,
        leaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    const exhaustedRecovery = await recoverExpiredRenderJobs({ maxAutoRetries: 3 });
    expect(exhaustedRecovery.requeuedJobIds).not.toContain(jobId);
    expect(exhaustedRecovery.failedJobIds).toContain(jobId);

    const permanentlyFailed = await getRenderJobAction({ projectId, jobId });
    expect(permanentlyFailed.ok).toBe(true);
    if (!permanentlyFailed.ok) return;
    expect(permanentlyFailed.data.status).toBe("FAILED");
    expect(permanentlyFailed.data.retryCount).toBe(3);
    expect(permanentlyFailed.data.workerId).toBeNull();
    expect(permanentlyFailed.data.errorMessage).toMatch(/Exceeded maximum automatic recovery attempts/i);
  });

  it("6. Standalone worker polls safely when idle, preserves C3.1 placeholder no-op without calling /fail or /complete, handles timeouts & network failures, and supports graceful shutdown", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const capturedLogs: WorkerLogEntry[] = [];
    const capturedLines: string[] = [];
    const logger = createWorkerLogger({
      workerId: "c31-e2e-worker",
      secrets: [WORKER_SECRET],
      sink: (entry, line) => {
        capturedLogs.push(entry);
        capturedLines.push(line);
      },
    });

    const config = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_API_BASE_URL: "http://localhost:3000/",
      RENDER_WORKER_ID: "c31-e2e-worker",
      RENDER_POLL_INTERVAL_MS: "250",
      RENDER_REQUEST_TIMEOUT_MS: "5000",
      RENDER_LEASE_DURATION_SEC: "120",
      RENDER_WORKER_PROCESSING_ENABLED: "true",
    });
    expect(config.apiBaseUrl).toBe("http://localhost:3000");
    expect(config.processingEnabled).toBe(true);

    const ffmpegStatus = await checkFfmpegEnvironment({
      ffmpegPath: "non-existent-ffmpeg-binary-check",
      ffprobePath: "non-existent-ffprobe-binary-check",
    });
    expect(ffmpegStatus.ffmpeg.tool).toBe("ffmpeg");
    expect(ffmpegStatus.ffprobe.tool).toBe("ffprobe");

    const routeClient = new RenderWorkerApiClient({
      apiBaseUrl: config.apiBaseUrl,
      workerSecret: config.workerSecret,
      workerId: config.workerId,
      requestTimeoutMs: config.requestTimeoutMs,
      leaseDurationSec: config.leaseDurationSec,
      logger,
      fetchImpl: createInProcessRouteFetch(),
    });

    const failSpy = vi.spyOn(routeClient, "reportFailure");
    const completeSpy = vi.spyOn(routeClient, "reportCompletion");

    const worker = new VideoRenderWorker({
      client: routeClient,
      logger,
      pollIntervalMs: config.pollIntervalMs,
      processingEnabled: config.processingEnabled,
      ffmpegStatus,
      jobHandler: processClaimedRenderJobPlaceholder,
    });

    // A) Queue empty -> worker remains idle safely
    const idleCycle = await worker.runOnce();
    expect(idleCycle).toEqual({ status: "idle", reason: "empty_queue" });

    // B) When processing IS explicitly enabled with C3.1 placeholder processor:
    // claims cleanly, validates snapshot, NEVER calls /fail or /complete, and NEVER falsely marks FAILED or COMPLETED
    const { projectId } = await createRenderReadyProject("End-to-End Worker Foundation Project");
    const createdJobRes = await createRenderJobAction({ projectId });
    expect(createdJobRes.ok).toBe(true);
    if (!createdJobRes.ok) return;
    const realJobId = createdJobRes.data.id;

    const processedCycle = await worker.runOnce();
    expect(processedCycle.status).toBe("processed");
    if (processedCycle.status === "processed") {
      expect(processedCycle.result).toEqual({
        outcome: "not_implemented_skipped",
        jobId: realJobId,
      });
    }

    expect(failSpy).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();

    const updatedJobRes = await getRenderJobAction({ projectId, jobId: realJobId });
    expect(updatedJobRes.ok).toBe(true);
    if (!updatedJobRes.ok) return;
    expect(updatedJobRes.data.status).toBe("PROCESSING");
    expect(updatedJobRes.data.outputStorageKey).toBeNull();
    expect(updatedJobRes.data.completedAt).toBeNull();
    expect(updatedJobRes.data.errorMessage).toBeNull();
    expect(updatedJobRes.data.workerId).toBe("c31-e2e-worker");

    failSpy.mockRestore();
    completeSpy.mockRestore();

    // Clean up active processing job before next subcheck
    await prisma.videoRenderJob.delete({ where: { id: realJobId } });

    // Ensure logs NEVER contain the worker secret
    const joinedLogs = capturedLines.join("\n");
    expect(joinedLogs).not.toContain(WORKER_SECRET);
    expect(joinedLogs).toContain(PART_C31_NOT_IMPLEMENTED_MESSAGE);

    // C) Request timeout handling
    const timeoutClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "timeout-worker",
      requestTimeoutMs: 60,
      leaseDurationSec: 120,
      logger,
      fetchImpl: ((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("Aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        })) as typeof fetch,
    });
    await expect(timeoutClient.claimNextJob()).rejects.toBeInstanceOf(WorkerApiTimeoutError);

    // D) Network connection failure handling (secret never leaked even if underlying error includes token)
    const unreachableClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://127.0.0.1:59999",
      workerSecret: WORKER_SECRET,
      workerId: "offline-worker",
      requestTimeoutMs: 1000,
      leaseDurationSec: 120,
      logger,
      fetchImpl: (async () => {
        throw new TypeError(`connect ECONNREFUSED 127.0.0.1:59999 token=${WORKER_SECRET}`);
      }) as typeof fetch,
    });
    try {
      await unreachableClient.claimNextJob();
      expect.fail("Should have thrown WorkerApiConnectionError");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkerApiConnectionError);
      expect((err as Error).message).not.toContain(WORKER_SECRET);
      expect((err as Error).message).toContain("[REDACTED]");
    }

    // E) Unauthorized HTTP error mapped cleanly
    const badAuthClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: "wrong-client-secret",
      workerId: "bad-auth-worker",
      requestTimeoutMs: 1000,
      leaseDurationSec: 120,
      logger,
      fetchImpl: createInProcessRouteFetch(),
    });
    await expect(badAuthClient.claimNextJob()).rejects.toBeInstanceOf(WorkerApiHttpError);

    // F) Graceful shutdown finishes in-flight job (with custom handler) and refuses to claim additional queued work
    const { projectId: shutdownProj } = await createRenderReadyProject("Graceful Shutdown Project");
    const j1 = await createRenderJobAction({ projectId: shutdownProj });
    expect(j1.ok).toBe(true);
    if (!j1.ok) return;

    let releaseInFlight!: () => void;
    let inFlightStarted = false;
    const inFlightGate = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });

    let jobsHandledCount = 0;
    const gracefulWorker = new VideoRenderWorker({
      client: routeClient,
      logger,
      pollIntervalMs: 200,
      processingEnabled: true,
      ffmpegStatus,
      jobHandler: async (handlerParams) => {
        jobsHandledCount++;
        inFlightStarted = true;
        await inFlightGate;
        await handlerParams.client.reportProgress(handlerParams.job.id, {
          progress: 50,
          stage: "Graceful shutdown test checkpoint",
        });
        return processClaimedRenderJobPlaceholder(handlerParams);
      },
    });

    const startPromise = gracefulWorker.start();
    while (!inFlightStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const stopPromise = gracefulWorker.stop();
    expect(gracefulWorker.isStopping()).toBe(true);

    releaseInFlight();
    await stopPromise;
    await startPromise;

    expect(jobsHandledCount).toBe(1);
    expect(gracefulWorker.isRunning()).toBe(false);

    const postShutdownJob = await getRenderJobAction({ projectId: shutdownProj, jobId: j1.data.id });
    expect(postShutdownJob.ok).toBe(true);
    if (!postShutdownJob.ok) return;
    expect(postShutdownJob.data.status).toBe("PROCESSING");
    expect(postShutdownJob.data.progress).toBe(50);
    expect(postShutdownJob.data.errorMessage).toBeNull();
    expect(capturedLogs.length).toBeGreaterThan(0);
    expect(capturedLines.join("\n")).not.toContain(WORKER_SECRET);
  });

  it("7. Keeps worker strictly idle without claiming or modifying PENDING/QUEUED jobs when RENDER_WORKER_PROCESSING_ENABLED is false (default)", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    // Config defaults processingEnabled to false when unset
    const defaultCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_API_BASE_URL: "http://localhost:3000",
      RENDER_WORKER_ID: "disabled-mode-worker",
    });
    expect(defaultCfg.processingEnabled).toBe(false);

    // Explicit "false" works and invalid values are rejected cleanly
    const falseCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "FALSE",
    });
    expect(falseCfg.processingEnabled).toBe(false);
    expect(() =>
      loadWorkerConfig({
        RENDER_WORKER_SECRET: WORKER_SECRET,
        RENDER_WORKER_PROCESSING_ENABLED: "sometimes",
      }),
    ).toThrow(/RENDER_WORKER_PROCESSING_ENABLED/);

    // Create two eligible jobs: one PENDING and one QUEUED
    const { projectId: projPending } = await createRenderReadyProject("Disabled Worker Pending Project");
    const pendingJobRes = await createRenderJobAction({ projectId: projPending });
    expect(pendingJobRes.ok).toBe(true);
    if (!pendingJobRes.ok) return;

    const { projectId: projQueued } = await createRenderReadyProject("Disabled Worker Queued Project");
    const queuedJobRes = await createRenderJobAction({ projectId: projQueued });
    expect(queuedJobRes.ok).toBe(true);
    if (!queuedJobRes.ok) return;
    await transitionRenderJobInternal({
      projectId: projQueued,
      jobId: queuedJobRes.data.id,
      targetStatus: "QUEUED",
      progress: 0,
    });

    const capturedLogs: WorkerLogEntry[] = [];
    const logger = createWorkerLogger({
      workerId: "disabled-mode-worker",
      secrets: [WORKER_SECRET],
      sink: (entry) => capturedLogs.push(entry),
    });

    const routeClient = new RenderWorkerApiClient({
      apiBaseUrl: defaultCfg.apiBaseUrl,
      workerSecret: defaultCfg.workerSecret,
      workerId: defaultCfg.workerId,
      requestTimeoutMs: defaultCfg.requestTimeoutMs,
      leaseDurationSec: defaultCfg.leaseDurationSec,
      logger,
      fetchImpl: createInProcessRouteFetch(),
    });

    const claimSpy = vi.spyOn(routeClient, "claimNextJob");
    const failSpy = vi.spyOn(routeClient, "reportFailure");
    const completeSpy = vi.spyOn(routeClient, "reportCompletion");

    const disabledWorker = new VideoRenderWorker({
      client: routeClient,
      logger,
      pollIntervalMs: 200,
      processingEnabled: defaultCfg.processingEnabled,
    });

    // Single poll cycle stays idle and never calls claim/fail/complete
    const cycle = await disabledWorker.runOnce();
    expect(cycle).toEqual({ status: "idle", reason: "processing_disabled" });

    // Background polling loop also stays idle without touching DB jobs
    const loopPromise = disabledWorker.start();
    await new Promise((r) => setTimeout(r, 300));
    await disabledWorker.stop();
    await loopPromise;

    expect(claimSpy).not.toHaveBeenCalled();
    expect(failSpy).not.toHaveBeenCalled();
    expect(completeSpy).not.toHaveBeenCalled();
    expect(
      capturedLogs.some(
        (entry) =>
          entry.level === "info" &&
          /disabled/i.test(entry.message) &&
          entry.meta?.processingEnabled === false,
      ),
    ).toBe(true);

    // Verify neither job in MySQL was marked PROCESSING, FAILED, or COMPLETED
    const afterPending = await getRenderJobAction({ projectId: projPending, jobId: pendingJobRes.data.id });
    expect(afterPending.ok).toBe(true);
    if (!afterPending.ok) return;
    expect(afterPending.data.status).toBe("PENDING");
    expect(afterPending.data.progress).toBe(0);
    expect(afterPending.data.workerId).toBeNull();
    expect(afterPending.data.startedAt).toBeNull();
    expect(afterPending.data.errorMessage).toBeNull();

    const afterQueued = await getRenderJobAction({ projectId: projQueued, jobId: queuedJobRes.data.id });
    expect(afterQueued.ok).toBe(true);
    if (!afterQueued.ok) return;
    expect(afterQueued.data.status).toBe("QUEUED");
    expect(afterQueued.data.progress).toBe(0);
    expect(afterQueued.data.workerId).toBeNull();
    expect(afterQueued.data.startedAt).toBeNull();
    expect(afterQueued.data.errorMessage).toBeNull();
  });
});

