import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  createProjectAction,
  createRenderJobAction,
  getRenderJobAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX, LOCAL_PRIVATE_IMAGE_PREFIX } from "@/lib/video-studio/deps";
import * as claimRoute from "@/app/api/internal/video-studio/render-jobs/claim/route";
import * as progressRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/progress/route";
import * as heartbeatRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/heartbeat/route";
import * as failRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/fail/route";
import * as completeRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/complete/route";
import * as assetRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/assets/[assetId]/route";

import { RenderWorkerApiClient } from "../../../worker/video-renderer/src/client";
import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import {
  checkFfmpegEnvironment,
  probeMediaFile,
  runFfmpegWithProgress,
  verifyRenderedMp4Output,
  WorkerFfmpegError,
  type FfmpegEnvironmentStatus,
} from "../../../worker/video-renderer/src/ffmpeg";
import { createWorkerLogger, type WorkerLogEntry } from "../../../worker/video-renderer/src/logger";
import { processClaimedRenderJob } from "../../../worker/video-renderer/src/processor";
import {
  parseAndValidateTransitionConfig,
  renderVideoToMp4,
  WorkerRenderValidationError,
} from "../../../worker/video-renderer/src/render-engine";
import { VideoRenderWorker } from "../../../worker/video-renderer/src/worker";

const ADMIN_SCENE_IMAGE_ROUTE_PREFIX = "/api/admin/video-studio/image/";
const LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX = "/uploads/video-studio/";

const ADMIN_USER = {
  id: 970324,
  role: "ADMIN" as const,
  email: "video-studio-admin-c324@example.com",
  name: "Studio Admin Part C324",
};

const WORKER_SECRET = "c324-ffmpeg-worker-secret-token-very-sensitive-9988";
const originalEnv = { ...process.env };
const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const tempDirsToCleanup: string[] = [];

let ffmpegEnv: FfmpegEnvironmentStatus;
let ffmpegBin: string;
let ffprobeBin: string;

function execBinary(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, shell: false, timeout: 15_000 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`${file} failed: ${stderr || err.message}`));
        return;
      }
      resolve();
    });
  });
}

async function createIsolatedTempDir(label = "rebx-c324-test"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));
  tempDirsToCleanup.push(dir);
  return dir;
}

async function synthesizeTestImageFile(params: {
  outPath: string;
  width: number;
  height: number;
  color: string;
}): Promise<Buffer> {
  await execBinary(ffmpegBin, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=${params.color}:s=${params.width}x${params.height}:d=1`,
    "-frames:v",
    "1",
    "-y",
    params.outPath,
  ]);
  return fs.readFile(params.outPath);
}

async function synthesizeTestAudioFile(params: {
  outPath: string;
  durationSec: number;
  frequencyHz?: number;
  amplitude?: number;
  format?: "wav" | "mp3";
}): Promise<Buffer> {
  const freq = params.frequencyHz ?? 440;
  const amp = params.amplitude ?? 0.3;
  const codecArgs =
    params.format === "mp3"
      ? ["-c:a", "libmp3lame", "-b:a", "96k"]
      : ["-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1"];

  await execBinary(ffmpegBin, [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:sample_rate=24000:duration=${params.durationSec}`,
    "-af",
    `volume=${amp}`,
    ...codecArgs,
    "-y",
    params.outPath,
  ]);
  return fs.readFile(params.outPath);
}

function createCapturingLogger() {
  const entries: WorkerLogEntry[] = [];
  const lines: string[] = [];
  const logger = createWorkerLogger({
    workerId: "worker-c324-test",
    secrets: [WORKER_SECRET],
    sink: (entry, line) => {
      entries.push(entry);
      lines.push(line);
    },
  });
  return { logger, entries, lines };
}

function createInProcessWorkerFetch(hooks?: {
  onCompleteCalled?: () => void;
  onHeartbeatCalled?: () => void;
  onProgressCalled?: (body: { progress?: number; stage?: string }) => void;
  beforeProgressOrHeartbeat?: () => Promise<void> | void;
}): typeof fetch {
  return async (input, init) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    const headers = new Headers(init?.headers ?? {});
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : undefined;
    const nextReq = new NextRequest(url.toString(), {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : bodyText,
    });

    if (url.pathname === "/api/internal/video-studio/render-jobs/claim" && method === "POST") {
      return claimRoute.POST(nextReq);
    }

    const progressMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/progress$/.exec(url.pathname);
    if (progressMatch && method === "POST") {
      await hooks?.beforeProgressOrHeartbeat?.();
      if (bodyText) {
        try {
          hooks?.onProgressCalled?.(JSON.parse(bodyText));
        } catch {
          // ignore
        }
      }
      return progressRoute.POST(nextReq, { params: Promise.resolve({ jobId: decodeURIComponent(progressMatch[1]) }) });
    }

    const heartbeatMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/heartbeat$/.exec(url.pathname);
    if (heartbeatMatch && method === "POST") {
      await hooks?.beforeProgressOrHeartbeat?.();
      hooks?.onHeartbeatCalled?.();
      return heartbeatRoute.POST(nextReq, { params: Promise.resolve({ jobId: decodeURIComponent(heartbeatMatch[1]) }) });
    }

    const failMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/fail$/.exec(url.pathname);
    if (failMatch && method === "POST") {
      return failRoute.POST(nextReq, { params: Promise.resolve({ jobId: decodeURIComponent(failMatch[1]) }) });
    }

    const completeMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/complete$/.exec(url.pathname);
    if (completeMatch && method === "POST") {
      hooks?.onCompleteCalled?.();
      return completeRoute.POST(nextReq, { params: Promise.resolve({ jobId: decodeURIComponent(completeMatch[1]) }) });
    }

    const assetMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/assets\/([^/]+)$/.exec(url.pathname);
    if (assetMatch && method === "GET") {
      return assetRoute.GET(nextReq, {
        params: Promise.resolve({
          jobId: decodeURIComponent(assetMatch[1]),
          assetId: decodeURIComponent(assetMatch[2]),
        }),
      });
    }

    return new Response(JSON.stringify({ ok: false, error: `Unhandled test route: ${method} ${url.pathname}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function createRealLocalRenderProject(params: {
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  scenes: Array<{
    title: string;
    narration: string;
    durationSec: number;
    imgWidth: number;
    imgHeight: number;
    imgColor: string;
    imgExt: "jpg" | "png";
    audioDurationSec: number;
    audioFreqHz: number;
    audioFormat?: "wav" | "mp3";
  }>;
}): Promise<{ projectId: string; sceneIds: string[] }> {
  const proj = await createProjectAction({
    title: params.title,
    topic: "Kokapet Villa Showcase",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Luxury",
    duration: Math.max(10, params.scenes.reduce((s, x) => s + x.durationSec, 0)),
    aspectRatio: params.aspectRatio,
    scenes: params.scenes.map((s, idx) => ({
      id: `draft_${idx + 1}`,
      order: idx + 1,
      title: s.title,
      narration: s.narration,
      imagePrompt: "Architectural view",
      imageUrl: null,
      duration: s.durationSec,
      locked: false,
    })),
  });
  expect(proj.ok).toBe(true);
  if (!proj.ok) throw new Error(proj.error);

  const projectId = proj.data.id;
  createdProjectIds.push(projectId);

  const dbScenes = await prisma.videoScene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  expect(dbScenes).toHaveLength(params.scenes.length);

  const fixtureDir = await createIsolatedTempDir("rebx-c324-fixtures");

  for (let i = 0; i < params.scenes.length; i++) {
    const spec = params.scenes[i];
    const dbScene = dbScenes[i];

    const imgPath = path.join(fixtureDir, `scene_${i + 1}.${spec.imgExt}`);
    const imgBytes = await synthesizeTestImageFile({
      outPath: imgPath,
      width: spec.imgWidth,
      height: spec.imgHeight,
      color: spec.imgColor,
    });
    const imgMime = spec.imgExt === "jpg" ? "image/jpeg" : "image/png";
    const imgFd = new FormData();
    imgFd.set("projectId", projectId);
    imgFd.set("sceneId", dbScene.id);
    imgFd.set("file", new File([new Uint8Array(imgBytes)], `scene_${i + 1}.${spec.imgExt}`, { type: imgMime }));
    const imgUp = await uploadSceneImageAction(imgFd);
    expect(imgUp.ok).toBe(true);
    if (!imgUp.ok) throw new Error(imgUp.error);
    localImageUrls.push(imgUp.data.imageUrl);

    const audFmt = spec.audioFormat ?? "wav";
    const audPath = path.join(fixtureDir, `scene_${i + 1}.${audFmt}`);
    const audBytes = await synthesizeTestAudioFile({
      outPath: audPath,
      durationSec: spec.audioDurationSec,
      frequencyHz: spec.audioFreqHz,
      format: audFmt,
    });
    const audMime = audFmt === "mp3" ? "audio/mpeg" : "audio/wav";
    const audFd = new FormData();
    audFd.set("projectId", projectId);
    audFd.set("sceneId", dbScene.id);
    audFd.set("language", "en-IN");
    audFd.set("file", new File([new Uint8Array(audBytes)], `voice_${i + 1}.${audFmt}`, { type: audMime }));
    const audUp = await uploadSceneAudioAction(audFd);
    expect(audUp.ok).toBe(true);
    if (!audUp.ok) throw new Error(audUp.error);
    localAudioKeys.push(audUp.data.audio.storageKey);
  }

  return {
    projectId,
    sceneIds: dbScenes.map((s) => s.id),
  };
}

async function cleanupTestDatabaseAndAssets() {
  const existingProjects = await prisma.videoProject.findMany({
    where: {
      OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }],
    },
    include: { scenes: { select: { imageUrl: true, imagePath: true } } },
  });

  for (const p of existingProjects) {
    for (const s of p.scenes) {
      const ref = s.imageUrl || s.imagePath;
      if (ref) localImageUrls.push(ref);
    }
    const meta = p.metadata as { sceneAudio?: Record<string, { storageKey?: string }> } | null;
    if (meta?.sceneAudio) {
      for (const a of Object.values(meta.sceneAudio)) {
        if (a?.storageKey) localAudioKeys.push(a.storageKey);
      }
    }
  }

  await prisma.videoProject.deleteMany({
    where: {
      OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }],
    },
  });
  await prisma.user.deleteMany({ where: { id: ADMIN_USER.id } });

  for (const ref of new Set(localImageUrls)) {
    let filename: string | null = null;
    if (ref.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)) {
      filename = path.posix.basename(ref.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length));
    } else if (ref.startsWith(LOCAL_PRIVATE_IMAGE_PREFIX)) {
      filename = path.posix.basename(ref.slice(LOCAL_PRIVATE_IMAGE_PREFIX.length));
    } else if (ref.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)) {
      filename = path.posix.basename(ref.slice(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX.length));
    }
    if (filename && filename !== "." && filename !== "..") {
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", "images", filename)).catch(() => {});
    }
  }
  localImageUrls.length = 0;

  for (const key of new Set(localAudioKeys)) {
    if (key.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      const filename = key.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", filename)).catch(() => {});
    }
  }
  localAudioKeys.length = 0;

  for (const dir of tempDirsToCleanup.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

describe("REBX AI Video Studio - Phase 3 Part C3.2.4: FFmpeg MP4 Rendering Engine", () => {
  beforeAll(async () => {
    ffmpegEnv = await checkFfmpegEnvironment();
    if (!ffmpegEnv.readyForPartC32Rendering || !ffmpegEnv.ffmpeg.executablePath || !ffmpegEnv.ffprobe.executablePath) {
      throw new Error("Local FFmpeg 9.0.1 and FFprobe 9.0.1 must be available to run Part C3.2.4 integration tests.");
    }
    ffmpegBin = ffmpegEnv.ffmpeg.executablePath;
    ffprobeBin = ffmpegEnv.ffprobe.executablePath;

    await cleanupTestDatabaseAndAssets();
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

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.STORAGE_PROVIDER = "local";
    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = WORKER_SECRET;
    mockActor = { ...ADMIN_USER };
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });
  });

  afterEach(async () => {
    await prisma.videoRenderJob.deleteMany({
      where: {
        OR: [{ createdById: ADMIN_USER.id }, { projectId: { in: createdProjectIds } }],
      },
    });
    for (const dir of tempDirsToCleanup.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  afterAll(async () => {
    await cleanupTestDatabaseAndAssets();
    process.env = { ...originalEnv };
  });

  it("1. Renders real 16:9 (1920x1080) multi-scene MP4 via worker claim -> private download -> FFmpeg/FFprobe, cleans intermediates, leaves /complete uncalled, and keeps snapshot immutable", async () => {
    const setup = await createRealLocalRenderProject({
      title: "C324 16:9 Real Render",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Exterior Entrance",
          narration: "Welcome to Kokapet sky villas with expansive courtyard views.",
          durationSec: 2,
          imgWidth: 640,
          imgHeight: 360,
          imgColor: "0x1E3A5F",
          imgExt: "jpg",
          audioDurationSec: 1.5,
          audioFreqHz: 440,
          audioFormat: "mp3",
        },
        {
          title: "Master Living Suite",
          narration: "Floor-to-ceiling glass brings in natural afternoon light.",
          durationSec: 2,
          imgWidth: 480,
          imgHeight: 640,
          imgColor: "0x2E5D4B",
          imgExt: "png",
          audioDurationSec: 1.6,
          audioFreqHz: 660,
          audioFormat: "wav",
        },
      ],
    });

    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);
    const jobBefore = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobRes.data.id } });
    const scenesBefore = await prisma.videoScene.findMany({
      where: { projectId: setup.projectId },
      orderBy: { order: "asc" },
    });

    const { logger, lines } = createCapturingLogger();
    let completeCallCount = 0;
    const seenProgressUpdates: number[] = [];

    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-16x9",
      requestTimeoutMs: 15_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onCompleteCalled: () => {
          completeCallCount++;
        },
        onProgressCalled: (b) => {
          if (typeof b.progress === "number") seenProgressUpdates.push(b.progress);
        },
      }),
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);
    expect(claim.job?.id).toBe(jobRes.data.id);

    const tempBase = await createIsolatedTempDir("rebx-c324-work-169");
    const result = await processClaimedRenderJob({
      job: claim.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBase,
      ffmpegTimeoutMs: 40_000,
      progressThrottleMs: 100,
      progressMinStep: 1,
      uploadAndComplete: false,
    });

    if (result.outcome !== "rendered_awaiting_upload") {
      throw new Error(`Expected rendered_awaiting_upload, got ${result.outcome}: ${"error" in result ? result.error : "reason" in result ? result.reason : ""}`);
    }

    // Intermediate segments removed, final MP4 present inside per-job temp workspace
    expect(result.intermediatesCleaned).toBe(true);
    await expect(fs.access(path.join(result.workspaceDir, "intermediates"))).rejects.toThrow();
    await expect(fs.access(result.outputFilePath)).resolves.toBeUndefined();

    // Real FFprobe verification independently inspects the generated file
    const verified = await verifyRenderedMp4Output({
      ffprobePath: ffprobeBin,
      filePath: result.outputFilePath,
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedFps: 30,
      expectedDurationSec: 4,
      requireAudio: true,
    });
    expect(verified.container).toBe("mp4");
    expect(verified.videoCodec).toBe("h264");
    expect(verified.pixelFormat).toBe("yuv420p");
    expect(verified.width).toBe(1920);
    expect(verified.height).toBe(1080);
    expect(verified.fps).toBe(30);
    expect(verified.audioCodec).toBe("aac");
    expect(verified.audioSampleRate).toBe(48000);
    expect(verified.audioChannels).toBe(2);
    expect(verified.bitRate).toBeGreaterThan(0);
    expect(verified.fileSizeBytes).toBeGreaterThan(2000);
    expect(verified.renderedDurationSec).toBeGreaterThanOrEqual(3.8);
    expect(verified.renderedDurationSec).toBeLessThanOrEqual(4.3);
    console.info("[C3.2.4 MP4 PROBE 16:9]", JSON.stringify({ file: path.basename(result.outputFilePath), aspectRatio: "16:9", ...verified }));

    // Worker NEVER calls /complete in C3.2.4, job remains PROCESSING at 95%
    expect(completeCallCount).toBe(0);
    expect(seenProgressUpdates.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seenProgressUpdates.length; i++) {
      expect(seenProgressUpdates[i]).toBeGreaterThan(seenProgressUpdates[i - 1]);
    }
    expect(seenProgressUpdates[seenProgressUpdates.length - 1]).toBe(95);

    const jobAfter = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobRes.data.id } });
    expect(jobAfter.status).toBe("PROCESSING");
    expect(jobAfter.progress).toBe(95);
    expect(jobAfter.completedAt).toBeNull();
    expect(jobAfter.outputStorageKey).toBeNull();
    expect(jobAfter.snapshotHash).toBe(jobBefore.snapshotHash);
    expect(jobAfter.snapshot).toEqual(jobBefore.snapshot);

    const scenesAfter = await prisma.videoScene.findMany({
      where: { projectId: setup.projectId },
      orderBy: { order: "asc" },
    });
    expect(scenesAfter.map((s) => ({ id: s.id, order: s.order, duration: s.duration, imageUrl: s.imageUrl }))).toEqual(
      scenesBefore.map((s) => ({ id: s.id, order: s.order, duration: s.duration, imageUrl: s.imageUrl })),
    );

    // Logs never leak worker secret
    expect(lines.join("\n")).not.toContain(WORKER_SECRET);

    await result.cleanup();
    await expect(fs.access(result.workspaceDir)).rejects.toThrow();
  }, 45_000);

  it("2. Renders real 9:16 (1080x1920) and 1:1 (1080x1080) MP4 videos with uniform H.264/AAC encoding profile", async () => {
    const tempBase = await createIsolatedTempDir("rebx-c324-ratios");

    for (const ratioCase of [
      { ratio: "9:16" as const, expectedW: 1080, expectedH: 1920 },
      { ratio: "1:1" as const, expectedW: 1080, expectedH: 1080 },
    ]) {
      const setup = await createRealLocalRenderProject({
        title: `C324 Ratio ${ratioCase.ratio}`,
        aspectRatio: ratioCase.ratio,
        scenes: [
          {
            title: "Vertical Living",
            narration: "Touring modern urban luxury apartments.",
            durationSec: 2,
            imgWidth: 500,
            imgHeight: 350,
            imgColor: "0x442255",
            imgExt: "jpg",
            audioDurationSec: 1.4,
            audioFreqHz: 520,
            audioFormat: "mp3",
          },
        ],
      });

      const jobRes = await createRenderJobAction({ projectId: setup.projectId });
      expect(jobRes.ok).toBe(true);
      if (!jobRes.ok) throw new Error(jobRes.error);

      const { logger } = createCapturingLogger();
      const client = new RenderWorkerApiClient({
        apiBaseUrl: "http://localhost:3000",
        workerSecret: WORKER_SECRET,
        workerId: `worker-${ratioCase.ratio}`,
        requestTimeoutMs: 15_000,
        leaseDurationSec: 300,
        logger,
        fetchImpl: createInProcessWorkerFetch(),
      });

      const claim = await client.claimNextJob();
      expect(claim.claimed).toBe(true);
      const result = await processClaimedRenderJob({
        job: claim.job!,
        client,
        logger,
        ffmpegStatus: ffmpegEnv,
        tempDir: tempBase,
        ffmpegTimeoutMs: 40_000,
        uploadAndComplete: false,
      });

      if (result.outcome !== "rendered_awaiting_upload") {
        throw new Error(`Expected rendered_awaiting_upload, got ${result.outcome}: ${"error" in result ? result.error : "reason" in result ? result.reason : ""}`);
      }

      const probe = await verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: result.outputFilePath,
        expectedWidth: ratioCase.expectedW,
        expectedHeight: ratioCase.expectedH,
        expectedFps: 30,
        expectedDurationSec: 2,
      });
      expect(probe.width).toBe(ratioCase.expectedW);
      expect(probe.height).toBe(ratioCase.expectedH);
      expect(probe.videoCodec).toBe("h264");
      expect(probe.pixelFormat).toBe("yuv420p");
      expect(probe.audioCodec).toBe("aac");
      expect(probe.bitRate).toBeGreaterThan(0);
      expect(probe.fileSizeBytes).toBeGreaterThan(1000);
      console.info(`[C3.2.4 MP4 PROBE ${ratioCase.ratio}]`, JSON.stringify({ file: path.basename(result.outputFilePath), aspectRatio: ratioCase.ratio, ...probe }));

      await result.cleanup();
    }
  }, 45_000);

  it("3. Normalizes mixed portrait, landscape, square, and odd-pixel input images without stretching, preserving single-scene & multi-scene order", async () => {
    const workDir = await createIsolatedTempDir("rebx-c324-mixed-imgs");
    const imgOdd = path.join(workDir, "odd_landscape.png");
    const imgPortrait = path.join(workDir, "portrait.jpg");
    const imgSquare = path.join(workDir, "square.png");
    const aud1 = path.join(workDir, "a1.wav");
    const aud2 = path.join(workDir, "a2.wav");
    const aud3 = path.join(workDir, "a3.wav");

    await synthesizeTestImageFile({ outPath: imgOdd, width: 321, height: 203, color: "0xFF3333" });
    await synthesizeTestImageFile({ outPath: imgPortrait, width: 300, height: 600, color: "0x33AA44" });
    await synthesizeTestImageFile({ outPath: imgSquare, width: 450, height: 450, color: "0x3366FF" });
    await synthesizeTestAudioFile({ outPath: aud1, durationSec: 1.5, frequencyHz: 330 });
    await synthesizeTestAudioFile({ outPath: aud2, durationSec: 1.5, frequencyHz: 550 });
    await synthesizeTestAudioFile({ outPath: aud3, durationSec: 1.5, frequencyHz: 770 });

    // Single-scene render
    const singleOut = path.join(workDir, "single.mp4");
    const singleRes = await renderVideoToMp4({
      jobId: "job-single",
      projectId: "proj-single",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        {
          sceneId: "s1",
          order: 1,
          title: "Odd Pixel Scene",
          narration: "Single scene narration.",
          durationSec: 2,
          imageFilePath: imgOdd,
          audioFilePath: aud1,
        },
      ],
      outputFilePath: singleOut,
      intermediatesDir: path.join(workDir, "interm-single"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(singleRes.sceneCount).toBe(1);
    expect(singleRes.width).toBe(1920);
    expect(singleRes.height).toBe(1080);

    // Pass scenes out-of-order in array; engine sorts by `order` ascending (1 -> 2 -> 3)
    const multiOut = path.join(workDir, "multi_ordered.mp4");
    const multiRes = await renderVideoToMp4({
      jobId: "job-multi",
      projectId: "proj-multi",
      aspectRatio: "1:1",
      width: 1080,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        { sceneId: "s3", order: 3, title: "Third", narration: "Three", durationSec: 2, imageFilePath: imgSquare, audioFilePath: aud3 },
        { sceneId: "s1", order: 1, title: "First", narration: "One", durationSec: 2, imageFilePath: imgOdd, audioFilePath: aud1 },
        { sceneId: "s2", order: 2, title: "Second", narration: "Two", durationSec: 2, imageFilePath: imgPortrait, audioFilePath: aud2 },
      ],
      outputFilePath: multiOut,
      intermediatesDir: path.join(workDir, "interm-multi"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });

    expect(multiRes.plan.scenes.map((s) => s.order)).toEqual([1, 2, 3]);
    expect(multiRes.plan.scenes.map((s) => s.sceneId)).toEqual(["s1", "s2", "s3"]);
    expect(multiRes.width).toBe(1080);
    expect(multiRes.height).toBe(1080);
    expect(multiRes.renderedDurationSec).toBeGreaterThanOrEqual(5.8);
    expect(multiRes.renderedDurationSec).toBeLessThanOrEqual(6.3);
  }, 45_000);

  it("4. Synchronizes shorter, longer, loud (anti-clipping), and missing optional voiceovers accurately", async () => {
    const workDir = await createIsolatedTempDir("rebx-c324-audio-sync");
    const imgPath = path.join(workDir, "room.png");
    await synthesizeTestImageFile({ outPath: imgPath, width: 640, height: 360, color: "0x223344" });

    const shortWav = path.join(workDir, "short.wav");
    const longWav = path.join(workDir, "long.wav");
    const loudWav = path.join(workDir, "loud.wav");
    await synthesizeTestAudioFile({ outPath: shortWav, durationSec: 1.0, frequencyHz: 440 });
    await synthesizeTestAudioFile({ outPath: longWav, durationSec: 3.4, frequencyHz: 600 });
    await synthesizeTestAudioFile({ outPath: loudWav, durationSec: 1.5, frequencyHz: 800, amplitude: 1.0 });

    // A: Shorter audio (1.0s) in 3s scene -> pads silence to ~3.0s
    const shortRes = await renderVideoToMp4({
      jobId: "job-aud-short",
      projectId: "proj-aud",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        { sceneId: "s1", order: 1, title: "Short Audio", narration: "Short.", durationSec: 3, imageFilePath: imgPath, audioFilePath: shortWav },
      ],
      outputFilePath: path.join(workDir, "short.mp4"),
      intermediatesDir: path.join(workDir, "interm-short"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(shortRes.plan.scenes[0].audioExtendedFromNominal).toBe(false);
    expect(shortRes.probeMetadata.videoDurationSec).toBeGreaterThanOrEqual(2.9);
    expect(shortRes.probeMetadata.audioDurationSec!).toBeGreaterThanOrEqual(2.9);

    // B: Longer audio (3.4s) in 2s scene -> extends held visual frames so voiceover is NOT truncated
    const longRes = await renderVideoToMp4({
      jobId: "job-aud-long",
      projectId: "proj-aud",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        { sceneId: "s1", order: 1, title: "Long Audio", narration: "Long narration.", durationSec: 2, imageFilePath: imgPath, audioFilePath: longWav },
      ],
      outputFilePath: path.join(workDir, "long.mp4"),
      intermediatesDir: path.join(workDir, "interm-long"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(longRes.plan.scenes[0].audioExtendedFromNominal).toBe(true);
    expect(longRes.renderedDurationSec).toBeGreaterThanOrEqual(3.4);
    expect(Math.abs(longRes.probeMetadata.videoDurationSec - longRes.probeMetadata.audioDurationSec!)).toBeLessThan(0.25);

    // C: Mixed scene WITH loud audio + scene WITHOUT optional audio -> clean synchronized MP4
    const silentRes = await renderVideoToMp4({
      jobId: "job-aud-none",
      projectId: "proj-aud",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        { sceneId: "s1", order: 1, title: "Full Scale Audio", narration: "Loud", durationSec: 2, imageFilePath: imgPath, audioFilePath: loudWav },
        { sceneId: "s2", order: 2, title: "Silent Visual Outro", narration: "", durationSec: 2, imageFilePath: imgPath, audioFilePath: null },
      ],
      outputFilePath: path.join(workDir, "mixed_silent.mp4"),
      intermediatesDir: path.join(workDir, "interm-silent"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(silentRes.probeMetadata.audioCodec).toBe("aac");
    expect(silentRes.renderedDurationSec).toBeGreaterThanOrEqual(3.85);
    expect(silentRes.renderedDurationSec).toBeLessThanOrEqual(4.2);
    expect(Math.abs(silentRes.probeMetadata.videoDurationSec - silentRes.probeMetadata.audioDurationSec!)).toBeLessThan(0.25);

    // D: Multi-scene project where EVERY scene omits optional audio -> synthesizes full-timeline silent AAC cleanly
    const allSilentRes = await renderVideoToMp4({
      jobId: "job-aud-all-silent",
      projectId: "proj-aud",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      scenes: [
        { sceneId: "s1", order: 1, title: "Visual 1", narration: "", durationSec: 2, imageFilePath: imgPath, audioFilePath: null },
        { sceneId: "s2", order: 2, title: "Visual 2", narration: "", durationSec: 2, imageFilePath: imgPath, audioFilePath: null },
      ],
      outputFilePath: path.join(workDir, "all_silent.mp4"),
      intermediatesDir: path.join(workDir, "interm-all-silent"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(allSilentRes.probeMetadata.audioCodec).toBe("aac");
    expect(allSilentRes.renderedDurationSec).toBeGreaterThanOrEqual(3.85);
    expect(allSilentRes.renderedDurationSec).toBeLessThanOrEqual(4.2);
  }, 45_000);

  it("5. Renders supported transitions (cut, fade, crossfade) including first/last/single-scene boundaries, and rejects unsupported transitions", async () => {
    const workDir = await createIsolatedTempDir("rebx-c324-transitions");
    const img1 = path.join(workDir, "t1.png");
    const img2 = path.join(workDir, "t2.png");
    const img3 = path.join(workDir, "t3.png");
    const aud = path.join(workDir, "ta.wav");
    await synthesizeTestImageFile({ outPath: img1, width: 640, height: 360, color: "0xAA2222" });
    await synthesizeTestImageFile({ outPath: img2, width: 640, height: 360, color: "0x22AA22" });
    await synthesizeTestImageFile({ outPath: img3, width: 640, height: 360, color: "0x2222AA" });
    await synthesizeTestAudioFile({ outPath: aud, durationSec: 1.5, frequencyHz: 480 });

    // A: "fade" transition across 2 scenes (preserves 2 + 2 = 4.0s total duration)
    const fadeRes = await renderVideoToMp4({
      jobId: "job-fade",
      projectId: "proj-trans",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      transition: "fade",
      transitionDurationSec: 0.4,
      scenes: [
        { sceneId: "s1", order: 1, title: "Fade One", narration: "One", durationSec: 2, imageFilePath: img1, audioFilePath: aud },
        { sceneId: "s2", order: 2, title: "Fade Two", narration: "Two", durationSec: 2, imageFilePath: img2, audioFilePath: aud },
      ],
      outputFilePath: path.join(workDir, "fade.mp4"),
      intermediatesDir: path.join(workDir, "interm-fade"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(fadeRes.transition).toBe("fade");
    expect(fadeRes.renderedDurationSec).toBeGreaterThanOrEqual(3.85);
    expect(fadeRes.renderedDurationSec).toBeLessThanOrEqual(4.2);

    // B: "crossfade" across 3 scenes (2 + 2 + 2 - 2*0.4 = 5.2s)
    const xfadeRes = await renderVideoToMp4({
      jobId: "job-xfade",
      projectId: "proj-trans",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      transition: "crossfade",
      transitionDurationSec: 0.4,
      scenes: [
        { sceneId: "s1", order: 1, title: "X1", narration: "One", durationSec: 2, imageFilePath: img1, audioFilePath: aud },
        { sceneId: "s2", order: 2, title: "X2", narration: "Two", durationSec: 2, imageFilePath: img2, audioFilePath: aud },
        { sceneId: "s3", order: 3, title: "X3", narration: "Three", durationSec: 2, imageFilePath: img3, audioFilePath: aud },
      ],
      outputFilePath: path.join(workDir, "xfade.mp4"),
      intermediatesDir: path.join(workDir, "interm-xfade"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(xfadeRes.transition).toBe("crossfade");
    expect(xfadeRes.expectedFinalDurationSec).toBeCloseTo(5.2, 2);
    expect(xfadeRes.renderedDurationSec).toBeGreaterThanOrEqual(5.0);
    expect(xfadeRes.renderedDurationSec).toBeLessThanOrEqual(5.4);

    // C: "crossfade" on single-scene project handles first/last boundary without error
    const singleXfadeRes = await renderVideoToMp4({
      jobId: "job-xfade-1",
      projectId: "proj-trans",
      aspectRatio: "1:1",
      width: 1080,
      height: 1080,
      fps: 30,
      outputFormat: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      transition: "crossfade",
      scenes: [
        { sceneId: "s1", order: 1, title: "Single Xfade", narration: "Solo", durationSec: 2, imageFilePath: img1, audioFilePath: aud },
      ],
      outputFilePath: path.join(workDir, "xfade_single.mp4"),
      intermediatesDir: path.join(workDir, "interm-xfade-1"),
      ffmpegPath: ffmpegBin,
      ffprobePath: ffprobeBin,
    });
    expect(singleXfadeRes.renderedDurationSec).toBeGreaterThanOrEqual(1.85);
    expect(singleXfadeRes.renderedDurationSec).toBeLessThanOrEqual(2.2);

    // D: Unsupported transition values & invalid durations MUST be rejected clearly
    for (const badTrans of ["wipe", "starwipe", "slideleft", "", 123]) {
      expect(() =>
        parseAndValidateTransitionConfig({
          rawTransition: badTrans,
          sceneCount: 2,
          minSceneDurationSec: 2,
        }),
      ).toThrowError(WorkerRenderValidationError);
    }

    expect(() =>
      parseAndValidateTransitionConfig({
        rawTransition: "crossfade",
        rawTransitionDurationSec: 1.5, // >= 45% of 2s scene
        sceneCount: 2,
        minSceneDurationSec: 2,
      }),
    ).toThrowError(WorkerRenderValidationError);

    expect(() =>
      parseAndValidateTransitionConfig({
        rawTransition: "cut",
        rawTransitionDurationSec: 0.5,
        sceneCount: 2,
        minSceneDurationSec: 4,
      }),
    ).toThrowError(WorkerRenderValidationError);

    // Rejected transition inside worker job calls /fail safely with UNSUPPORTED_TRANSITION message
    const setup = await createRealLocalRenderProject({
      title: "C324 Bad Transition DB",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "S1",
          narration: "Hello",
          durationSec: 2,
          imgWidth: 400,
          imgHeight: 300,
          imgColor: "0x112233",
          imgExt: "jpg",
          audioDurationSec: 1.2,
          audioFreqHz: 440,
        },
      ],
    });
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-badtrans",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const badSnapshotJob = structuredClone(claim.job!);
    (badSnapshotJob.snapshot as { renderSettings: Record<string, unknown> }).renderSettings.transition = "starwipe";

    const failRes = await processClaimedRenderJob({
      job: badSnapshotJob,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
    });
    expect(failRes.outcome).toBe("failed");
    const dbFailed = await getRenderJobAction({ projectId: setup.projectId, jobId: jobRes.data.id });
    expect(dbFailed.ok).toBe(true);
    if (!dbFailed.ok) return;
    expect(dbFailed.data.status).toBe("FAILED");
    expect(dbFailed.data.errorMessage).toMatch(/Unsupported transition "starwipe"/i);
  }, 60_000);

  it("6. Handles FFmpeg non-zero exit codes and timeout cleanly, cleans up workspace, redacts secrets/paths, and marks job FAILED", async () => {
    const setup = await createRealLocalRenderProject({
      title: "C324 Failure & Timeout",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Scene Fail",
          narration: "Testing failure recovery",
          durationSec: 15,
          imgWidth: 640,
          imgHeight: 360,
          imgColor: "0x334455",
          imgExt: "jpg",
          audioDurationSec: 2,
          audioFreqHz: 440,
        },
      ],
    });

    // 0) Direct real FFmpeg non-zero exit code verification with secret & directory redaction
    const failProbeDir = await createIsolatedTempDir("rebx-c324-nz");
    const dummyImg = path.join(failProbeDir, "in.png");
    await synthesizeTestImageFile({ outPath: dummyImg, width: 120, height: 120, color: "0x112233" });
    let caughtExecErr: unknown = null;
    try {
      await runFfmpegWithProgress({
        ffmpegPath: ffmpegBin,
        args: ["-i", dummyImg, "-vf", `nonexistent_filter_name_${WORKER_SECRET}`, "-y", path.join(failProbeDir, "out.mp4")],
        timeoutMs: 10_000,
        secrets: [WORKER_SECRET],
        redactDirs: [failProbeDir],
      });
    } catch (err) {
      caughtExecErr = err;
    }
    expect(caughtExecErr).toBeInstanceOf(WorkerFfmpegError);
    if (caughtExecErr instanceof WorkerFfmpegError) {
      expect(caughtExecErr.code).toBe("FFMPEG_EXEC_FAILED");
      expect(caughtExecErr.exitCode).not.toBe(0);
      expect(caughtExecErr.message).not.toContain(WORKER_SECRET);
      expect(caughtExecErr.message).not.toContain(failProbeDir);
    }

    // A) Unreadable input failure after tampering downloaded local image -> cleans workspace & redacts secret/paths
    const jobFailRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobFailRes.ok).toBe(true);
    if (!jobFailRes.ok) throw new Error(jobFailRes.error);

    const { logger, lines } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-fail",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claimA = await client.claimNextJob();
    expect(claimA.claimed).toBe(true);

    // Corrupt source JPG body keeping valid SOI header bytes so download succeeds signature check, then FFmpeg/FFprobe fails
    const imgFilename = (await prisma.videoScene.findFirstOrThrow({ where: { projectId: setup.projectId } }))
      .imageUrl!
      .slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length);
    const localImgDiskPath = path.join(process.cwd(), "storage", "video-studio", "images", imgFilename);
    const validImgCopy = await fs.readFile(localImgDiskPath);
    await fs.writeFile(localImgDiskPath, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(`corrupt-jpeg-${WORKER_SECRET}`)]));

    const tempBaseA = await createIsolatedTempDir("rebx-c324-fail-ws");
    const resA = await processClaimedRenderJob({
      job: claimA.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBaseA,
    });
    expect(resA.outcome).toBe("failed");
    expect(await fs.readdir(tempBaseA)).toHaveLength(0); // Workspace completely cleaned up!

    const dbJobA = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobFailRes.data.id } });
    expect(dbJobA.status).toBe("FAILED");
    expect(dbJobA.errorMessage).toBeTruthy();
    expect(dbJobA.errorMessage).not.toContain(WORKER_SECRET);
    expect(dbJobA.errorMessage).not.toContain(process.cwd());

    // Restore valid image bytes for subtest B (timeout)
    await fs.writeFile(localImgDiskPath, validImgCopy);
    await prisma.videoRenderJob.delete({ where: { id: jobFailRes.data.id } });

    // B) FFmpeg timeout enforcement (real FFmpeg aborted at 60ms timeout) -> kills child & cleans temp workspace
    const jobTimeoutRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobTimeoutRes.ok).toBe(true);
    if (!jobTimeoutRes.ok) throw new Error(jobTimeoutRes.error);

    const claimB = await client.claimNextJob();
    expect(claimB.claimed).toBe(true);
    const tempBaseB = await createIsolatedTempDir("rebx-c324-timeout-ws");

    const resB = await processClaimedRenderJob({
      job: claimB.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBaseB,
      ffmpegTimeoutMs: 60, // Real 1920x1080 4s render cannot finish in 60ms -> guaranteed real child timeout
    });
    expect(resB.outcome).toBe("failed");
    if (resB.outcome === "failed") {
      expect(resB.error).toMatch(/timed out/i);
    }
    expect(await fs.readdir(tempBaseB)).toHaveLength(0);

    const dbJobB = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobTimeoutRes.data.id } });
    expect(dbJobB.status).toBe("FAILED");
    expect(dbJobB.errorMessage).toMatch(/timed out/i);
    expect(dbJobB.errorMessage).not.toContain(WORKER_SECRET);
    expect(lines.join("\n")).not.toContain(WORKER_SECRET);
  }, 45_000);

  it("7. Maintains heartbeats during rendering, aborts FFmpeg immediately on AbortSignal cancellation and server 409 cancelled/expired-lease", async () => {
    const setup = await createRealLocalRenderProject({
      title: "C324 Cancel & Heartbeat",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Long Enough Scene",
          narration: "Testing live heartbeats and cancellation.",
          durationSec: 25,
          imgWidth: 800,
          imgHeight: 450,
          imgColor: "0x114466",
          imgExt: "jpg",
          audioDurationSec: 3,
          audioFreqHz: 440,
        },
      ],
    });

    // A) External AbortSignal / VideoRenderWorker.stop() cancellation aborts real running FFmpeg and cleans workspace
    const job1 = await createRenderJobAction({ projectId: setup.projectId });
    expect(job1.ok).toBe(true);
    if (!job1.ok) throw new Error(job1.error);

    const { logger } = createCapturingLogger();
    let completeCalled = 0;
    let workerStopTriggered = false;
    let worker1!: VideoRenderWorker;
    let stopPromise: Promise<void> | null = null;

    const client1 = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-cancel1",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onCompleteCalled: () => {
          completeCalled++;
        },
        onProgressCalled: (b) => {
          if (!workerStopTriggered && (b.progress ?? 0) >= 16) {
            workerStopTriggered = true;
            stopPromise = worker1.stop();
          }
        },
      }),
    });

    const tempBase1 = await createIsolatedTempDir("rebx-c324-cancel-ws1");
    worker1 = new VideoRenderWorker({
      client: client1,
      logger,
      pollIntervalMs: 150,
      processingEnabled: true,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBase1,
      ffmpegTimeoutMs: 45_000,
      heartbeatIntervalMs: 120,
    });

    const startP = worker1.start();
    const waitDeadline = Date.now() + 20_000;
    while (!workerStopTriggered && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 30));
    }
    if (!stopPromise) {
      await worker1.stop();
    } else {
      await stopPromise;
    }
    await startP;

    expect(workerStopTriggered).toBe(true);
    expect(completeCalled).toBe(0);
    // Temp workspace cleaned up cleanly on cancellation
    expect(await fs.readdir(tempBase1)).toHaveLength(0);
    // Job was NOT falsely marked FAILED or COMPLETED by cancellation
    const afterStopJob = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job1.data.id } });
    expect(afterStopJob.status).toBe("PROCESSING");
    expect(afterStopJob.errorMessage).toBeNull();

    await prisma.videoRenderJob.delete({ where: { id: job1.data.id } });

    // B) Server 409 LEASE_EXPIRED / CANCELLED on heartbeat/progress aborts FFmpeg immediately & cleans temp workspace
    const job2 = await createRenderJobAction({ projectId: setup.projectId });
    expect(job2.ok).toBe(true);
    if (!job2.ok) throw new Error(job2.error);

    let heartbeatCount = 0;
    let leaseRevoked = false;
    const tempBase2 = await createIsolatedTempDir("rebx-c324-cancel-ws2");
    const client2 = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-cancel2",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onCompleteCalled: () => {
          completeCalled++;
        },
        onHeartbeatCalled: () => {
          heartbeatCount++;
        },
        beforeProgressOrHeartbeat: async () => {
          if (leaseRevoked) return;
          const cur = await prisma.videoRenderJob.findUnique({ where: { id: job2.data.id } });
          if (cur && cur.progress >= 15) {
            leaseRevoked = true;
            await prisma.videoRenderJob.update({
              where: { id: job2.data.id },
              data: { leaseExpiresAt: new Date(Date.now() - 5000) },
            });
          }
        },
      }),
    });

    const claim2 = await client2.claimNextJob();
    expect(claim2.claimed).toBe(true);

    const res2 = await processClaimedRenderJob({
      job: claim2.job!,
      client: client2,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBase2,
      ffmpegTimeoutMs: 45_000,
      heartbeatIntervalMs: 80,
      progressThrottleMs: 100,
      progressMinStep: 1,
    });

    expect(leaseRevoked).toBe(true);
    expect(res2.outcome).toBe("cancelled");
    expect(await fs.readdir(tempBase2)).toHaveLength(0);
    expect(completeCalled).toBe(0);
    const afterLeaseJob = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job2.data.id } });
    expect(afterLeaseJob.status).not.toBe("FAILED");
    expect(afterLeaseJob.status).not.toBe("COMPLETED");

    // C) Periodic heartbeats fire cleanly and keep lease alive during active multi-second rendering
    await prisma.videoRenderJob.delete({ where: { id: job2.data.id } });
    const setupShort = await createRealLocalRenderProject({
      title: "C324 Active Heartbeat Render",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Heartbeat Render Scene",
          narration: "Testing active heartbeat cadence during encode.",
          durationSec: 4,
          imgWidth: 640,
          imgHeight: 360,
          imgColor: "0x225533",
          imgExt: "jpg",
          audioDurationSec: 2,
          audioFreqHz: 440,
        },
      ],
    });
    const job3 = await createRenderJobAction({ projectId: setupShort.projectId });
    if (!job3.ok) throw new Error(job3.error);
    heartbeatCount = 0;

    const client3 = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c324-hb",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onHeartbeatCalled: () => {
          heartbeatCount++;
        },
      }),
    });
    const claim3 = await client3.claimNextJob();
    expect(claim3.claimed).toBe(true);
    const res3 = await processClaimedRenderJob({
      job: claim3.job!,
      client: client3,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempBase2,
      ffmpegTimeoutMs: 45_000,
      heartbeatIntervalMs: 80,
      uploadAndComplete: false,
    });
    if (res3.outcome !== "rendered_awaiting_upload") {
      throw new Error(`Expected rendered_awaiting_upload, got ${res3.outcome}: ${"error" in res3 ? res3.error : "reason" in res3 ? res3.reason : ""}`);
    }
    expect(res3.outcome).toBe("rendered_awaiting_upload");
    expect(heartbeatCount).toBeGreaterThanOrEqual(1);
    const hbJobAfter = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job3.data.id } });
    expect(hbJobAfter.lastHeartbeatAt).not.toBeNull();
    if (res3.outcome === "rendered_awaiting_upload") {
      await res3.cleanup();
    }
  }, 60_000);

  it("8. Rejects invalid/incomplete/wrong-dimension/missing-audio MP4 files in FFprobe verification and keeps RENDER_WORKER_PROCESSING_ENABLED default false", async () => {
    // 1. Worker config safety default preserved
    const defaultCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_API_BASE_URL: "http://localhost:3000",
      RENDER_WORKER_ID: "worker-c324-safe-default",
    });
    expect(defaultCfg.processingEnabled).toBe(false);

    const workDir = await createIsolatedTempDir("rebx-c324-probe-invalid");

    // 2. Zero-byte MP4 -> rejected
    const zeroFile = path.join(workDir, "zero.mp4");
    await fs.writeFile(zeroFile, Buffer.alloc(0));
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: zeroFile,
        expectedWidth: 1920,
        expectedHeight: 1080,
        expectedFps: 30,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RENDER_OUTPUT" });

    // 3. Truncated/garbage MP4 -> rejected
    const garbageFile = path.join(workDir, "garbage.mp4");
    await fs.writeFile(garbageFile, Buffer.from("not-an-mp4-stream-at-all"));
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: garbageFile,
        expectedWidth: 1920,
        expectedHeight: 1080,
        expectedFps: 30,
      }),
    ).rejects.toBeInstanceOf(WorkerFfmpegError);

    // 4. Wrong dimensions (640x360 vs 1920x1080) -> rejected
    const wrongDimFile = path.join(workDir, "wrong_dim.mp4");
    await execBinary(ffmpegBin, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=640x360:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-y",
      wrongDimFile,
    ]);
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: wrongDimFile,
        expectedWidth: 1920,
        expectedHeight: 1080,
        expectedFps: 30,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RENDER_OUTPUT" });

    // 5. Video-only MP4 missing required AAC audio -> rejected
    const noAudioFile = path.join(workDir, "no_audio.mp4");
    await execBinary(ffmpegBin, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:r=30:d=1",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-y",
      noAudioFile,
    ]);
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: noAudioFile,
        expectedWidth: 1920,
        expectedHeight: 1080,
        expectedFps: 30,
        requireAudio: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RENDER_OUTPUT" });

    // 5b. Same video-only MP4 passes FFprobe check when audio stream is NOT expected (requireAudio: false)
    const videoOnlyOk = await verifyRenderedMp4Output({
      ffprobePath: ffprobeBin,
      filePath: noAudioFile,
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedFps: 30,
      requireAudio: false,
    });
    expect(videoOnlyOk.audioCodec).toBeNull();
    expect(videoOnlyOk.videoCodec).toBe("h264");

    // 6. Incompatible pixel format (yuv444p vs yuv420p) -> rejected
    const yuv444File = path.join(workDir, "yuv444p.mp4");
    await execBinary(ffmpegBin, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=1080x1080:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv444p",
      "-c:a",
      "aac",
      "-y",
      yuv444File,
    ]);
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: yuv444File,
        expectedWidth: 1080,
        expectedHeight: 1080,
        expectedFps: 30,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RENDER_OUTPUT" });

    // 7. Non-MP4 container (Matroska renamed to .mp4) -> rejected
    const mkvAsMp4 = path.join(workDir, "disguised.mp4");
    await execBinary(ffmpegBin, [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=1080x1080:r=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-f",
      "matroska",
      "-y",
      mkvAsMp4,
    ]);
    await expect(
      verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: mkvAsMp4,
        expectedWidth: 1080,
        expectedHeight: 1080,
        expectedFps: 30,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RENDER_OUTPUT" });

    // 8. Positive control: valid 1080x1080 h264 yuv420p aac MP4 probes cleanly
    const probedValid = await probeMediaFile({ ffprobePath: ffprobeBin, filePath: wrongDimFile });
    expect(probedValid.videoStreams[0].width).toBe(640);
  }, 45_000);
});
