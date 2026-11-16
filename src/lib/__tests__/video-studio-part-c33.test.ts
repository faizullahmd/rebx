import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeWithFfmpeg } from "@/test/ffmpeg";
import { prisma } from "@/lib/prisma";

class RedirectSignal extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

let mockActor: { id: number; role: "ADMIN" | "AGENT" | "CUSTOMER"; email: string; name: string } | null = null;

type MockS3ObjectEntry = {
  body: Buffer;
  contentType: string;
  acl?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  etag: string;
};

const { mockS3Store, mockS3Puts, mockS3Heads, mockS3Gets, mockS3Deletes, mockS3Send } = vi.hoisted(() => {
  const store = new Map<string, MockS3ObjectEntry>();
  const puts: Array<{ key: string; acl?: string; contentType?: string; metadata?: Record<string, string>; size: number }> = [];
  const heads: string[] = [];
  const gets: Array<{ key: string; range?: string }> = [];
  const deletes: string[] = [];

  async function drainBodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
        else if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
        else chunks.push(Buffer.from(String(chunk)));
      }
      return Buffer.concat(chunks);
    }
    return Buffer.alloc(0);
  }

  const send = vi.fn(async (cmd: { constructor?: { name?: string }; input?: Record<string, unknown> }) => {
    const cmdName = cmd?.constructor?.name ?? "";
    const input = cmd?.input ?? {};
    const bucket = String(input.Bucket ?? "");
    const key = String(input.Key ?? "");
    const storeKey = `${bucket}/${key}`;

    if (cmdName === "MockPutObjectCommand") {
      const bodyBuf = await drainBodyToBuffer(input.Body);
      const etag = `"${createHash("md5").update(bodyBuf).digest("hex")}"`;
      const meta =
        input.Metadata && typeof input.Metadata === "object"
          ? { ...(input.Metadata as Record<string, string>) }
          : undefined;
      store.set(storeKey, {
        body: bodyBuf,
        contentType: String(input.ContentType ?? "application/octet-stream"),
        acl: typeof input.ACL === "string" ? input.ACL : undefined,
        cacheControl: typeof input.CacheControl === "string" ? input.CacheControl : undefined,
        metadata: meta,
        etag,
      });
      puts.push({
        key,
        acl: typeof input.ACL === "string" ? input.ACL : undefined,
        contentType: typeof input.ContentType === "string" ? input.ContentType : undefined,
        metadata: meta,
        size: bodyBuf.length,
      });
      return { ETag: etag };
    }

    if (cmdName === "MockHeadObjectCommand") {
      heads.push(key);
      const item = store.get(storeKey);
      if (!item) {
        const notFound = new Error("The specified key does not exist.");
        notFound.name = "NotFound";
        (notFound as unknown as { Code: string; $metadata: { httpStatusCode: number } }).Code = "NotFound";
        (notFound as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
        throw notFound;
      }
      return {
        ContentLength: item.body.length,
        ContentType: item.contentType,
        ETag: item.etag,
        Metadata: item.metadata ?? {},
      };
    }

    if (cmdName === "MockGetObjectCommand") {
      const rangeStr = typeof input.Range === "string" ? input.Range : undefined;
      gets.push({ key, range: rangeStr });
      const item = store.get(storeKey);
      if (!item) {
        const notFound = new Error("The specified key does not exist.");
        notFound.name = "NoSuchKey";
        (notFound as unknown as { Code: string; $metadata: { httpStatusCode: number } }).Code = "NoSuchKey";
        (notFound as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
        throw notFound;
      }

      let slice = item.body;
      if (rangeStr) {
        const m = /^bytes=(\d+)-(\d+)$/i.exec(rangeStr.trim());
        if (m) {
          const start = Number.parseInt(m[1], 10);
          const end = Math.min(item.body.length - 1, Number.parseInt(m[2], 10));
          slice = item.body.subarray(start, end + 1);
        }
      }

      const byteCopy = Buffer.from(slice);
      return {
        Body: Readable.from([byteCopy]),
        ContentType: item.contentType,
        ContentLength: byteCopy.length,
        ETag: item.etag,
      };
    }

    if (cmdName === "MockDeleteObjectCommand") {
      deletes.push(key);
      store.delete(storeKey);
      return {};
    }

    return {};
  });

  return {
    mockS3Store: store,
    mockS3Puts: puts,
    mockS3Heads: heads,
    mockS3Gets: gets,
    mockS3Deletes: deletes,
    mockS3Send: send,
  };
});

vi.mock("@aws-sdk/client-s3", () => {
  class MockPutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockHeadObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockGetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockDeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class MockS3Client {
    send = mockS3Send;
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
  };
});

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

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => (mockActor ? { user: { ...mockActor, id: String(mockActor.id) } } : null)),
  signOut: vi.fn(),
}));

import * as videoStudioActions from "@/lib/actions/video-studio";
import {
  cancelRenderJobAction,
  createProjectAction,
  createRenderJobAction,
  deleteProjectAction,
  getRenderJobAction,
  retryRenderJobAction,
  saveDraftAction,
  updateProjectStatusAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import { getProjectsDashboard, getProjectWithScenes } from "@/lib/data/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX, LOCAL_PRIVATE_IMAGE_PREFIX } from "@/lib/video-studio/deps";
import * as claimRoute from "@/app/api/internal/video-studio/render-jobs/claim/route";
import * as progressRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/progress/route";
import * as heartbeatRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/heartbeat/route";
import * as failRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/fail/route";
import * as outputRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/output/route";
import * as completeRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/complete/route";
import * as assetRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/assets/[assetId]/route";
import * as adminVideoRoute from "@/app/api/admin/video-studio/render-jobs/[jobId]/video/route";

import {
  RenderWorkerApiClient,
  WorkerApiHttpError,
} from "../../../worker/video-renderer/src/client";
import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import {
  checkFfmpegEnvironment,
  verifyRenderedMp4Output,
  type FfmpegEnvironmentStatus,
} from "../../../worker/video-renderer/src/ffmpeg";
import { createWorkerLogger, type WorkerLogEntry } from "../../../worker/video-renderer/src/logger";
import { processClaimedRenderJob } from "../../../worker/video-renderer/src/processor";
import { VideoRenderWorker } from "../../../worker/video-renderer/src/worker";

const ADMIN_SCENE_IMAGE_ROUTE_PREFIX = "/api/admin/video-studio/image/";
const LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX = "/uploads/video-studio/";

const ADMIN_USER = {
  id: 970330,
  role: "ADMIN" as const,
  email: "video-studio-admin-c33@example.com",
  name: "Studio Admin Part C33",
};

const CUSTOMER_USER = {
  id: 970331,
  role: "CUSTOMER" as const,
  email: "video-studio-customer-c33@example.com",
  name: "Studio Customer Part C33",
};

const WORKER_SECRET = "c33-worker-secret-token-very-sensitive-776655";
const SPACES_TEST_KEY = "DO00TESTKEY123456";
const SPACES_TEST_SECRET = "do-test-secret-must-never-leak-anywhere-9911";
const originalEnv = { ...process.env };
const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const localOutputFiles: string[] = [];
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

async function createIsolatedTempDir(label = "rebx-c33-test"): Promise<string> {
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
  format?: "wav" | "mp3";
}): Promise<Buffer> {
  const freq = params.frequencyHz ?? 440;
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
    "volume=0.3",
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
    workerId: "worker-c33-test",
    secrets: [WORKER_SECRET, SPACES_TEST_KEY, SPACES_TEST_SECRET],
    sink: (entry, line) => {
      entries.push(entry);
      lines.push(line);
    },
  });
  return { logger, entries, lines };
}

function createInProcessWorkerFetch(hooks?: {
  onOutputCalled?: (url: string, headers: Headers) => Promise<Response | void> | Response | void;
  onCompleteCalled?: (body: unknown) => Promise<Response | void> | Response | void;
  onProgressCalled?: (body: { progress?: number; stage?: string }) => void;
  beforeOutputUpload?: (jobId: string) => Promise<void> | void;
}): typeof fetch {
  return async (input, init) => {
    const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(urlStr);
    const headers = new Headers(init?.headers ?? {});
    const method = (init?.method ?? "GET").toUpperCase();
    const isBodyMethod = method !== "GET" && method !== "HEAD";
    const bodyText = typeof init?.body === "string" ? init.body : undefined;

    const nextReqInit: ConstructorParameters<typeof NextRequest>[1] & { duplex?: "half" } = {
      method,
      headers,
      body: isBodyMethod ? (init?.body as BodyInit | undefined) : undefined,
      ...(isBodyMethod && init?.body && typeof init.body !== "string" ? { duplex: "half" } : {}),
    };
    const nextReq = new NextRequest(url.toString(), nextReqInit);

    if (url.pathname === "/api/internal/video-studio/render-jobs/claim" && method === "POST") {
      return claimRoute.POST(nextReq);
    }

    const progressMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/progress$/.exec(url.pathname);
    if (progressMatch && method === "POST") {
      if (bodyText) {
        try {
          hooks?.onProgressCalled?.(JSON.parse(bodyText));
        } catch {
          // ignore
        }
      }
      return progressRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: decodeURIComponent(progressMatch[1]) }),
      });
    }

    const heartbeatMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/heartbeat$/.exec(url.pathname);
    if (heartbeatMatch && method === "POST") {
      return heartbeatRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: decodeURIComponent(heartbeatMatch[1]) }),
      });
    }

    const failMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/fail$/.exec(url.pathname);
    if (failMatch && method === "POST") {
      return failRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: decodeURIComponent(failMatch[1]) }),
      });
    }

    const outputMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/output$/.exec(url.pathname);
    if (outputMatch && (method === "PUT" || method === "POST")) {
      const jid = decodeURIComponent(outputMatch[1]);
      await hooks?.beforeOutputUpload?.(jid);
      const override = await hooks?.onOutputCalled?.(url.pathname, headers);
      if (override) return override;
      return outputRoute.PUT(nextReq, {
        params: Promise.resolve({ jobId: jid }),
      });
    }

    const completeMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/complete$/.exec(url.pathname);
    if (completeMatch && method === "POST") {
      let parsedBody: unknown = null;
      if (bodyText) {
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          parsedBody = null;
        }
      }
      const override = await hooks?.onCompleteCalled?.(parsedBody);
      if (override) return override;
      return completeRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: decodeURIComponent(completeMatch[1]) }),
      });
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

    return new Response(JSON.stringify({ ok: false, error: `Unhandled route: ${method} ${url.pathname}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

async function createRenderReadyProject(params: {
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  color?: string;
  durationSec?: number;
}): Promise<{ projectId: string; sceneIds: string[] }> {
  const dur = params.durationSec ?? 2;
  const proj = await createProjectAction({
    title: params.title,
    topic: "Kokapet Villa Showcase",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Luxury",
    duration: Math.max(10, dur),
    aspectRatio: params.aspectRatio,
    scenes: [
      {
        id: "draft_1",
        order: 1,
        title: "Opening Aerial View",
        narration: "Presenting modern residences in Kokapet.",
        imagePrompt: "Modern architectural villa facade",
        imageUrl: null,
        duration: dur,
        locked: false,
      },
    ],
  });
  expect(proj.ok).toBe(true);
  if (!proj.ok) throw new Error(proj.error);

  const projectId = proj.data.id;
  createdProjectIds.push(projectId);

  const dbScene = await prisma.videoScene.findFirstOrThrow({
    where: { projectId },
    orderBy: { order: "asc" },
  });

  const fixtureDir = await createIsolatedTempDir("rebx-c33-fixtures");
  const imgPath = path.join(fixtureDir, "scene_1.jpg");
  const imgBytes = await synthesizeTestImageFile({
    outPath: imgPath,
    width: 640,
    height: 360,
    color: params.color ?? "0x1E3A5F",
  });
  const imgFd = new FormData();
  imgFd.set("projectId", projectId);
  imgFd.set("sceneId", dbScene.id);
  imgFd.set("file", new File([new Uint8Array(imgBytes)], "scene_1.jpg", { type: "image/jpeg" }));
  const imgUp = await uploadSceneImageAction(imgFd);
  expect(imgUp.ok).toBe(true);
  if (!imgUp.ok) throw new Error(imgUp.error);
  localImageUrls.push(imgUp.data.imageUrl);

  const audPath = path.join(fixtureDir, "voice_1.mp3");
  const audBytes = await synthesizeTestAudioFile({
    outPath: audPath,
    durationSec: 1.4,
    frequencyHz: 480,
    format: "mp3",
  });
  const audFd = new FormData();
  audFd.set("projectId", projectId);
  audFd.set("sceneId", dbScene.id);
  audFd.set("language", "en-IN");
  audFd.set("file", new File([new Uint8Array(audBytes)], "voice_1.mp3", { type: "audio/mpeg" }));
  const audUp = await uploadSceneAudioAction(audFd);
  expect(audUp.ok).toBe(true);
  if (!audUp.ok) throw new Error(audUp.error);
  localAudioKeys.push(audUp.data.audio.storageKey);

  return { projectId, sceneIds: [dbScene.id] };
}

function makeWorkerHttpPost(urlPath: string, body: unknown, secret = WORKER_SECRET): NextRequest {
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function cleanupTestDatabaseAndAssets() {
  const existingProjects = await prisma.videoProject.findMany({
    where: {
      OR: [{ createdById: ADMIN_USER.id }, { id: { in: createdProjectIds } }],
    },
    include: {
      scenes: { select: { imageUrl: true, imagePath: true } },
      renderJobs: { select: { id: true, outputStorageKey: true } },
    },
  });

  for (const p of existingProjects) {
    createdProjectIds.push(p.id);
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
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } } });

  for (const ref of new Set(localImageUrls.splice(0))) {
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

  for (const key of new Set(localAudioKeys.splice(0))) {
    if (key.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)) {
      const filename = key.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", filename)).catch(() => {});
    }
  }

  for (const f of new Set(localOutputFiles.splice(0))) {
    await fs.unlink(f).catch(() => {});
  }

  for (const pid of new Set(createdProjectIds.splice(0))) {
    await fs.rm(path.join(process.cwd(), "storage", "video-studio", pid), { recursive: true, force: true }).catch(() => {});
  }

  for (const dir of tempDirsToCleanup.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  mockS3Store.clear();
  mockS3Puts.length = 0;
  mockS3Heads.length = 0;
  mockS3Gets.length = 0;
  mockS3Deletes.length = 0;
}

describeWithFfmpeg("REBX AI Video Studio - Phase 3 Part C3.3: MP4 Storage, Completion & Admin Preview", () => {
  beforeAll(async () => {
    ffmpegEnv = await checkFfmpegEnvironment();
    if (!ffmpegEnv.readyForPartC32Rendering || !ffmpegEnv.ffmpeg.executablePath || !ffmpegEnv.ffprobe.executablePath) {
      throw new Error("Local FFmpeg 9.0.1 and FFprobe 9.0.1 are required for Part C3.3 tests.");
    }
    ffmpegBin = ffmpegEnv.ffmpeg.executablePath;
    ffprobeBin = ffmpegEnv.ffprobe.executablePath;

    await cleanupTestDatabaseAndAssets();
    await prisma.user.createMany({
      data: [
        {
          id: ADMIN_USER.id,
          name: ADMIN_USER.name,
          email: ADMIN_USER.email,
          role: "ADMIN",
          passwordHash: "x",
        },
        {
          id: CUSTOMER_USER.id,
          name: CUSTOMER_USER.name,
          email: CUSTOMER_USER.email,
          role: "CUSTOMER",
          passwordHash: "x",
        },
      ],
    });
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.STORAGE_PROVIDER = "local";
    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = WORKER_SECRET;
    mockActor = { ...ADMIN_USER };
    mockS3Store.clear();
    mockS3Puts.length = 0;
    mockS3Heads.length = 0;
    mockS3Gets.length = 0;
    mockS3Deletes.length = 0;
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

  it("1. Completes full local render lifecycle across 16:9, 9:16, and 1:1 (render -> private storage upload -> verified /complete -> temp cleanup), keeps public/ empty, and supports admin streaming/Range/download", async () => {
    const tempRoot = await createIsolatedTempDir("rebx-c33-e2e-ws");

    for (const ratioSpec of [
      { aspectRatio: "16:9" as const, expectedW: 1920, expectedH: 1080 },
      { aspectRatio: "9:16" as const, expectedW: 1080, expectedH: 1920 },
      { aspectRatio: "1:1" as const, expectedW: 1080, expectedH: 1080 },
    ]) {
      const setup = await createRenderReadyProject({
        title: `C33 Full Render ${ratioSpec.aspectRatio}`,
        aspectRatio: ratioSpec.aspectRatio,
      });

      const jobRes = await createRenderJobAction({ projectId: setup.projectId });
      expect(jobRes.ok).toBe(true);
      if (!jobRes.ok) throw new Error(jobRes.error);
      const jobId = jobRes.data.id;

      const { logger, lines } = createCapturingLogger();
      const client = new RenderWorkerApiClient({
        apiBaseUrl: "http://localhost:3000",
        workerSecret: WORKER_SECRET,
        workerId: `worker-c33-${ratioSpec.aspectRatio}`,
        requestTimeoutMs: 20_000,
        leaseDurationSec: 300,
        logger,
        fetchImpl: createInProcessWorkerFetch(),
      });

      const claim = await client.claimNextJob();
      expect(claim.claimed).toBe(true);
      expect(claim.job?.id).toBe(jobId);

      const result = await processClaimedRenderJob({
        job: claim.job!,
        client,
        logger,
        ffmpegStatus: ffmpegEnv,
        tempDir: tempRoot,
        ffmpegTimeoutMs: 45_000,
        progressThrottleMs: 50,
        progressMinStep: 1,
      });

      if (result.outcome !== "completed") {
        throw new Error(`Expected completed outcome, got ${result.outcome}: ${"error" in result ? result.error : ""}`);
      }

      const expectedKey = `video-studio/${setup.projectId}/renders/render_${jobId}.mp4`;
      expect(result.outputStorageKey).toBe(expectedKey);
      expect(result.workspaceCleaned).toBe(true);
      expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
      // Temp workspace (MP4 + intermediates + scene downloads) must be completely removed after /complete
      await expect(fs.access(path.join(tempRoot, jobId))).rejects.toThrow();

      // Stored output lives outside public/, under storage/video-studio/<projectId>/renders/
      const expectedLocalDiskPath = path.join(
        process.cwd(),
        "storage",
        "video-studio",
        setup.projectId,
        "renders",
        `render_${jobId}.mp4`,
      );
      localOutputFiles.push(expectedLocalDiskPath);
      const storedBytes = await fs.readFile(expectedLocalDiskPath);
      expect(storedBytes.length).toBe(result.outputMetadata.fileSizeBytes);
      expect(createHash("sha256").update(storedBytes).digest("hex")).toBe(result.checksumSha256);

      // Ensure NO video renders landed in Next.js public/
      await expect(
        fs.access(path.join(process.cwd(), "public", "uploads", "video-studio", `render_${jobId}.mp4`)),
      ).rejects.toThrow();

      // Independently probe the durably stored MP4 in private storage
      const storedProbe = await verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: expectedLocalDiskPath,
        expectedWidth: ratioSpec.expectedW,
        expectedHeight: ratioSpec.expectedH,
        expectedFps: 30,
        expectedDurationSec: 2,
      });
      expect(storedProbe.width).toBe(ratioSpec.expectedW);
      expect(storedProbe.height).toBe(ratioSpec.expectedH);

      // Verify DB record transitioned cleanly to COMPLETED at 100% with persisted metadata & cleared lease
      const dbJob = await getRenderJobAction({ projectId: setup.projectId, jobId });
      expect(dbJob.ok).toBe(true);
      if (!dbJob.ok) throw new Error(dbJob.error);
      expect(dbJob.data.status).toBe("COMPLETED");
      expect(dbJob.data.progress).toBe(100);
      expect(dbJob.data.outputStorageKey).toBe(expectedKey);
      expect(dbJob.data.completedAt).toBeTruthy();
      expect(dbJob.data.leaseExpiresAt).toBeNull();
      expect(dbJob.data.outputMetadata?.workerPendingPartC3).toBe(false);
      expect(dbJob.data.outputMetadata?.checksumSha256).toBe(result.checksumSha256);
      expect(dbJob.data.outputMetadata?.fileSizeBytes).toBe(storedBytes.length);
      expect(dbJob.data.outputMetadata?.videoCodec).toBe("h264");
      expect(dbJob.data.outputMetadata?.audioCodec).toBe("aac");
      expect(dbJob.data.outputMetadata?.pixelFormat).toBe("yuv420p");
      expect(dbJob.data.outputMetadata?.storageProvider).toBe("local-private");

      // Admin preview & HTTP Range playback check for the stored MP4
      mockActor = { ...ADMIN_USER };
      const fullVideoRes = await adminVideoRoute.GET(
        new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${jobId}/video`),
        { params: Promise.resolve({ jobId }) },
      );
      expect(fullVideoRes.status).toBe(200);
      expect(fullVideoRes.headers.get("content-type")).toBe("video/mp4");
      expect(fullVideoRes.headers.get("accept-ranges")).toBe("bytes");
      expect(fullVideoRes.headers.get("cache-control")).toBe("private, no-store");
      expect(fullVideoRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(fullVideoRes.headers.get("content-disposition")).toMatch(/^inline;\s*filename="[^"]+\.mp4"$/);
      const streamedFull = Buffer.from(await fullVideoRes.arrayBuffer());
      expect(streamedFull.equals(storedBytes)).toBe(true);

      // HTTP Range 206 Partial Content check (seeking)
      const rangeEnd = Math.min(2047, storedBytes.length - 1);
      const rangeRes = await adminVideoRoute.GET(
        new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${jobId}/video`, {
          headers: { Range: `bytes=0-${rangeEnd}` },
        }),
        { params: Promise.resolve({ jobId }) },
      );
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get("content-range")).toBe(`bytes 0-${rangeEnd}/${storedBytes.length}`);
      expect(rangeRes.headers.get("content-length")).toBe(String(rangeEnd + 1));
      const rangeSlice = Buffer.from(await rangeRes.arrayBuffer());
      expect(rangeSlice.equals(storedBytes.subarray(0, rangeEnd + 1))).toBe(true);

      // Admin download (?download=1) attachment disposition check
      const downloadRes = await adminVideoRoute.GET(
        new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${jobId}/video?download=1`),
        { params: Promise.resolve({ jobId }) },
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-disposition")).toMatch(/^attachment;\s*filename="[^"]+\.mp4"$/);
      await downloadRes.body?.cancel();

      // Secrets never leak in worker logs
      expect(lines.join("\n")).not.toContain(WORKER_SECRET);
    }
  }, 90_000);

  it("2. Deletes completed render MP4 cleanly when parent VideoProject is deleted and still preserves draft/scene editing", async () => {
    const setup = await createRenderReadyProject({
      title: "C33 Project Cleanup & Edit Preserved",
      aspectRatio: "16:9",
    });

    // Confirm project status update still works normally (existing features untouched)
    const statusRes = await updateProjectStatusAction(setup.projectId, "DRAFT");
    expect(statusRes.ok).toBe(true);

    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c33-delete",
      requestTimeoutMs: 15_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const tempRoot = await createIsolatedTempDir("rebx-c33-delete-ws");
    const res = await processClaimedRenderJob({
      job: claim.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempRoot,
    });
    expect(res.outcome).toBe("completed");

    const diskPath = path.join(
      process.cwd(),
      "storage",
      "video-studio",
      setup.projectId,
      "renders",
      `render_${jobRes.data.id}.mp4`,
    );
    await expect(fs.access(diskPath)).resolves.toBeUndefined();

    // Delete project as ADMIN -> stored render MP4 must also be removed cleanly
    mockActor = { ...ADMIN_USER };
    const delRes = await deleteProjectAction(setup.projectId);
    expect(delRes.ok).toBe(true);
    await expect(fs.access(diskPath)).rejects.toThrow();
  }, 45_000);

  it("3. Uploads privately to DigitalOcean Spaces (ACL: private, video/mp4, streaming Body), verifies via HeadObject, blocks missing Spaces config in production, and prevents silent fallback", async () => {
    process.env.STORAGE_PROVIDER = "spaces";
    process.env.SPACES_REGION = "nyc3";
    process.env.SPACES_BUCKET = "rebx-private-media";
    process.env.SPACES_ENDPOINT = "https://nyc3.digitaloceanspaces.com";
    process.env.SPACES_KEY = SPACES_TEST_KEY;
    process.env.SPACES_SECRET = SPACES_TEST_SECRET;

    const setup = await createRenderReadyProject({
      title: "C33 Spaces Render",
      aspectRatio: "9:16",
    });

    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);
    const jobId = jobRes.data.id;

    const { logger, lines } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c33-spaces",
      requestTimeoutMs: 20_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const tempRoot = await createIsolatedTempDir("rebx-c33-spaces-ws");
    const result = await processClaimedRenderJob({
      job: claim.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempRoot,
      ffmpegTimeoutMs: 45_000,
    });

    if (result.outcome !== "completed") {
      throw new Error(`Expected completed outcome in Spaces test, got ${result.outcome}: ${"error" in result ? result.error : ""}`);
    }

    const expectedKey = `video-studio/${setup.projectId}/renders/render_${jobId}.mp4`;
    expect(result.outputStorageKey).toBe(expectedKey);
    expect(result.workspaceCleaned).toBe(true);

    // Inspect recorded S3 PutObject + HeadObject calls
    const putCall = mockS3Puts.find((p) => p.key === expectedKey);
    expect(putCall).toBeTruthy();
    expect(putCall?.acl).toBe("private");
    expect(putCall?.contentType).toBe("video/mp4");
    expect(putCall?.metadata?.["rebx-project-id"]).toBe(setup.projectId);
    expect(putCall?.metadata?.["rebx-job-id"]).toBe(jobId);
    expect(putCall?.metadata?.["rebx-sha256"]).toBe(result.checksumSha256);
    expect(putCall?.size).toBe(result.outputMetadata.fileSizeBytes);
    // HeadObject invoked both after upload and during /complete verification
    expect(mockS3Heads.filter((k) => k === expectedKey).length).toBeGreaterThanOrEqual(2);

    const storedObj = mockS3Store.get(`rebx-private-media/${expectedKey}`);
    expect(storedObj?.acl).toBe("private");
    expect(storedObj?.cacheControl).toBe("private, no-store");
    expect(storedObj?.body.length).toBe(result.outputMetadata.fileSizeBytes);

    // Ensure zero local fallback file created when Spaces is active
    await expect(
      fs.access(path.join(process.cwd(), "storage", "video-studio", setup.projectId, "renders", `render_${jobId}.mp4`)),
    ).rejects.toThrow();

    // Admin video endpoint streams & Range-seeks from private Spaces cleanly
    mockActor = { ...ADMIN_USER };
    const spacesRangeRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${jobId}/video`, {
        headers: { Range: "bytes=0-511" },
      }),
      { params: Promise.resolve({ jobId }) },
    );
    expect(spacesRangeRes.status).toBe(206);
    expect(spacesRangeRes.headers.get("content-range")).toBe(`bytes 0-511/${storedObj!.body.length}`);
    const rangeBuf = Buffer.from(await spacesRangeRes.arrayBuffer());
    expect(rangeBuf.equals(storedObj!.body.subarray(0, 512))).toBe(true);

    // Missing Spaces credentials in production mode fails explicitly without silent local fallback
    const savedNodeEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.SPACES_KEY;
    delete process.env.SPACES_SECRET;
    try {
      const noCredsRes = await adminVideoRoute.GET(
        new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${jobId}/video`),
        { params: Promise.resolve({ jobId }) },
      );
      expect(noCredsRes.status).toBe(500);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
      process.env.SPACES_KEY = SPACES_TEST_KEY;
      process.env.SPACES_SECRET = SPACES_TEST_SECRET;
    }

    // Secrets never leak to worker logs
    const logText = lines.join("\n");
    expect(logText).not.toContain(WORKER_SECRET);
    expect(logText).not.toContain(SPACES_TEST_KEY);
    expect(logText).not.toContain(SPACES_TEST_SECRET);

    // Provider mismatch: switching STORAGE_PROVIDER="local" while snapshot targets "spaces" is rejected explicitly (no silent fallback)
    const { projectId: pMismatch } = setup;
    const jobMismatchRes = await createRenderJobAction({ projectId: pMismatch });
    // Force snapshot target to spaces, switch runtime STORAGE_PROVIDER=local -> fail closed on /output
    expect(jobMismatchRes.ok).toBe(true);
    if (jobMismatchRes.ok) {
      await prisma.videoRenderJob.update({
        where: { id: jobMismatchRes.data.id },
        data: {
          status: "PROCESSING",
          workerId: "worker-mismatch",
          leaseExpiresAt: new Date(Date.now() + 120_000),
          snapshot: {
            ...(jobMismatchRes.data.snapshot as object),
            outputDestination: {
              provider: "spaces",
              storageKeyPrefix: `video-studio/${pMismatch}/renders`,
              format: "mp4",
            },
          },
        },
      });
      process.env.STORAGE_PROVIDER = "local";
      const fakeMp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), Buffer.alloc(64)]);
      const mismatchOut = await outputRoute.PUT(
        new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${jobMismatchRes.data.id}/output`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${WORKER_SECRET}`,
            "X-REBX-Worker-Id": "worker-mismatch",
            "Content-Type": "video/mp4",
            "Content-Length": String(fakeMp4.length),
          },
          body: new Uint8Array(fakeMp4),
        }),
        { params: Promise.resolve({ jobId: jobMismatchRes.data.id }) },
      );
      expect(mismatchOut.status).toBe(422);
      const mismatchJson = (await mismatchOut.json()) as { code?: string };
      expect(mismatchJson.code).toBe("STORAGE_PROVIDER_MISMATCH");
    }
  }, 60_000);

  it("4. Preserves recoverable temp MP4 when upload or /complete fails, blocks interrupted/corrupt/mismatched uploads, and handles duplicate retries safely", async () => {
    const setup = await createRenderReadyProject({
      title: "C33 Failure Recovery & Idempotency",
      aspectRatio: "16:9",
    });

    // A) Upload interruption/failure during worker execution -> preserves temp MP4 on disk & never marks COMPLETED
    const jobUploadFail = await createRenderJobAction({ projectId: setup.projectId });
    if (!jobUploadFail.ok) throw new Error(jobUploadFail.error);

    const tempRoot = await createIsolatedTempDir("rebx-c33-preserve-ws");
    const { logger } = createCapturingLogger();
    const failUploadClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c33-upload-fail",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onOutputCalled: () =>
          new Response(JSON.stringify({ ok: false, code: "STORAGE_UNAVAILABLE", error: "Simulated 422 storage error" }), {
            status: 422,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    });

    const claimFail = await failUploadClient.claimNextJob();
    expect(claimFail.claimed).toBe(true);
    const failRes = await processClaimedRenderJob({
      job: claimFail.job!,
      client: failUploadClient,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempRoot,
    });
    expect(failRes.outcome).toBe("failed");
    if (failRes.outcome === "failed") {
      expect(failRes.preservedOutputFilePath).toBeTruthy();
      await expect(fs.access(failRes.preservedOutputFilePath!)).resolves.toBeUndefined();
      // Manual cleanup by test after asserting preservation
      await fs.rm(path.join(tempRoot, jobUploadFail.data.id), { recursive: true, force: true });
    }
    const dbUploadFailed = await getRenderJobAction({ projectId: setup.projectId, jobId: jobUploadFail.data.id });
    expect(dbUploadFailed.ok).toBe(true);
    if (dbUploadFailed.ok) {
      expect(dbUploadFailed.data.status).toBe("FAILED");
      expect(dbUploadFailed.data.completedAt).toBeNull();
      expect(dbUploadFailed.data.outputStorageKey).toBeNull();
    }

    // B) Server-side verification in /complete rejects missing/corrupt/empty/wrong-size/wrong-key/mismatched metadata
    const jobVerifyRes = await createRenderJobAction({ projectId: setup.projectId });
    if (!jobVerifyRes.ok) throw new Error(jobVerifyRes.error);
    const verifyJobId = jobVerifyRes.data.id;

    const claimVerify = await claimRoute.POST(
      makeWorkerHttpPost("/api/internal/video-studio/render-jobs/claim", {
        workerId: "worker-c33-verify",
        leaseDurationSec: 300,
      }),
    );
    expect(claimVerify.status).toBe(200);

    const canonicalKey = `video-studio/${setup.projectId}/renders/render_${verifyJobId}.mp4`;
    const baseMeta = {
      container: "mp4",
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      fps: 30,
      sceneCount: 1,
      totalDurationSec: 2,
      fileSizeBytes: 512,
      renderedDurationSec: 2,
    };

    // 1. Missing output in storage -> rejected 422
    const missingFileRes = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: baseMeta,
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(missingFileRes.status).toBe(422);

    // 2. Arbitrary / traversal / wrong-project outputStorageKey -> rejected 422
    const wrongProjKeyRes = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: `video-studio/other-proj/renders/render_${verifyJobId}.mp4`,
        outputMetadata: baseMeta,
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(wrongProjKeyRes.status).toBe(422);

    // 3. Corrupt (non-MP4) upload rejected at /output (422) and leaves no committed file
    const badBytes = Buffer.from("not-an-mp4-video-header-at-all");
    const badOutRes = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${verifyJobId}/output`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          "X-REBX-Worker-Id": "worker-c33-verify",
          "Content-Type": "video/mp4",
          "Content-Length": String(badBytes.length),
        },
        body: new Uint8Array(badBytes),
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(badOutRes.status).toBe(422);

    // 4. Truncated stream (Content-Length mismatch) rejected 422 and leaves no orphan file
    const validHeader = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]),
      Buffer.alloc(100),
    ]);
    const truncOutRes = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${verifyJobId}/output`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          "X-REBX-Worker-Id": "worker-c33-verify",
          "Content-Type": "video/mp4",
          "Content-Length": String(validHeader.length + 500),
        },
        body: new Uint8Array(validHeader),
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(truncOutRes.status).toBe(422);

    // 5. Valid MP4 upload -> 200, then retry identical upload (idempotent reuse -> 200), then wrong metadata rejected (422)
    const sha = createHash("sha256").update(validHeader).digest("hex");
    const okOut1 = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${verifyJobId}/output`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          "X-REBX-Worker-Id": "worker-c33-verify",
          "X-REBX-Content-SHA256": sha,
          "Content-Type": "video/mp4",
          "Content-Length": String(validHeader.length),
        },
        body: new Uint8Array(validHeader),
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(okOut1.status).toBe(200);
    const localStoredPath = path.join(
      process.cwd(),
      "storage",
      "video-studio",
      setup.projectId,
      "renders",
      `render_${verifyJobId}.mp4`,
    );
    localOutputFiles.push(localStoredPath);

    // Duplicate retry upload with same SHA256 reuses verified object without error or extra files
    const okOutRetry = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${verifyJobId}/output`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          "X-REBX-Worker-Id": "worker-c33-verify",
          "X-REBX-Content-SHA256": sha,
          "Content-Type": "video/mp4",
          "Content-Length": String(validHeader.length),
        },
        body: new Uint8Array(validHeader),
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(okOutRetry.status).toBe(200);
    expect(((await okOutRetry.json()) as { idempotentReuse?: boolean }).idempotentReuse).toBe(true);

    // Wrong fileSizeBytes reported to /complete -> rejected 422
    const wrongSizeComplete = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: { ...baseMeta, fileSizeBytes: validHeader.length + 10, checksumSha256: sha },
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(wrongSizeComplete.status).toBe(422);

    // Wrong dimensions vs snapshot -> rejected 422
    const wrongDimsComplete = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: { ...baseMeta, width: 1080, height: 1920, fileSizeBytes: validHeader.length, checksumSha256: sha },
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(wrongDimsComplete.status).toBe(422);

    // Accurate /complete succeeds (200), and identical retry /complete returns 200 idempotently, while mismatched replay returns 409
    const goodComplete = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: { ...baseMeta, fileSizeBytes: validHeader.length, checksumSha256: sha },
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(goodComplete.status).toBe(200);

    const idempotentComplete = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: { ...baseMeta, fileSizeBytes: validHeader.length, checksumSha256: sha },
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(idempotentComplete.status).toBe(200);

    const conflictingComplete = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${verifyJobId}/complete`, {
        workerId: "worker-c33-verify",
        outputStorageKey: canonicalKey,
        outputMetadata: { ...baseMeta, fileSizeBytes: validHeader.length + 1, checksumSha256: sha },
      }),
      { params: Promise.resolve({ jobId: verifyJobId }) },
    );
    expect(conflictingComplete.status).toBe(409);
  }, 60_000);

  it("5. Blocks completion/upload for cancelled jobs and expired leases, handles cancellation mid-upload without false COMPLETED, and prevents browser/non-admin/unauthenticated access", async () => {
    const setup = await createRenderReadyProject({
      title: "C33 Security & Cancellation",
      aspectRatio: "1:1",
    });

    // A) Job cancelled right before upload -> worker sees 409, aborts cleanly, leaves CANCELLED (not COMPLETED/FAILED), cleans temp dir
    const cancelJobRes = await createRenderJobAction({ projectId: setup.projectId });
    if (!cancelJobRes.ok) throw new Error(cancelJobRes.error);
    const cancelJobId = cancelJobRes.data.id;

    const { logger } = createCapturingLogger();
    const cancelClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c33-cancel",
      requestTimeoutMs: 15_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        beforeOutputUpload: async (jid) => {
          await prisma.videoRenderJob.update({
            where: { id: jid },
            data: {
              status: "CANCELLED",
              stage: "Cancelled during upload",
              cancelledAt: new Date(),
              workerId: null,
              leaseExpiresAt: null,
            },
          });
        },
      }),
    });

    const cancelClaim = await cancelClient.claimNextJob();
    expect(cancelClaim.claimed).toBe(true);
    const tempCancel = await createIsolatedTempDir("rebx-c33-cancel-ws");
    const cancelRun = await processClaimedRenderJob({
      job: cancelClaim.job!,
      client: cancelClient,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempCancel,
      ffmpegTimeoutMs: 45_000,
    });
    expect(cancelRun.outcome).toBe("cancelled");
    expect(await fs.readdir(tempCancel)).toHaveLength(0);
    const afterCancel = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: cancelJobId } });
    expect(afterCancel.status).toBe("CANCELLED");
    expect(afterCancel.outputStorageKey).toBeNull();

    // B) Expired lease cannot upload or complete (409)
    const expJobRes = await createRenderJobAction({ projectId: setup.projectId });
    if (!expJobRes.ok) throw new Error(expJobRes.error);
    const expJobId = expJobRes.data.id;
    await claimRoute.POST(
      makeWorkerHttpPost("/api/internal/video-studio/render-jobs/claim", {
        workerId: "worker-c33-expired",
        leaseDurationSec: 60,
      }),
    );
    await prisma.videoRenderJob.update({
      where: { id: expJobId },
      data: { leaseExpiresAt: new Date(Date.now() - 10_000) },
    });

    const dummyMp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]),
      Buffer.alloc(32),
    ]);
    const expOutRes = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${expJobId}/output`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${WORKER_SECRET}`,
          "X-REBX-Worker-Id": "worker-c33-expired",
          "Content-Type": "video/mp4",
          "Content-Length": String(dummyMp4.length),
        },
        body: new Uint8Array(dummyMp4),
      }),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(expOutRes.status).toBe(409);

    const expCompRes = await completeRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${expJobId}/complete`, {
        workerId: "worker-c33-expired",
        outputStorageKey: `video-studio/${setup.projectId}/renders/render_${expJobId}.mp4`,
        outputMetadata: {
          container: "mp4",
          aspectRatio: "1:1",
          width: 1080,
          height: 1080,
          fps: 30,
          sceneCount: 1,
          totalDurationSec: 2,
          fileSizeBytes: dummyMp4.length,
          renderedDurationSec: 2,
        },
      }),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(expCompRes.status).toBe(409);

    // C) Unauthenticated / non-worker cannot call /output or /complete, and no completion Server Action exists
    const unauthOut = await outputRoute.PUT(
      new NextRequest(`http://localhost:3000/api/internal/video-studio/render-jobs/${expJobId}/output`, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(dummyMp4.length) },
        body: new Uint8Array(dummyMp4),
      }),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(unauthOut.status).toBe(401);

    const badSecretComp = await completeRoute.POST(
      makeWorkerHttpPost(
        `/api/internal/video-studio/render-jobs/${expJobId}/complete`,
        { workerId: "worker-c33-expired" },
        "wrong-secret",
      ),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(badSecretComp.status).toBe(403);
    expect(Object.keys(videoStudioActions).filter((k) => /completeRenderJob|uploadRenderOutput/i.test(k))).toEqual([]);

    // D) Admin preview /video route auth, incomplete status, missing file, and invalid Range handling
    // Incomplete job -> 409 for admin, 401 for anon, 403 for CUSTOMER
    mockActor = null;
    const anonVideoRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${expJobId}/video`),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(anonVideoRes.status).toBe(401);

    mockActor = { ...CUSTOMER_USER };
    const custVideoRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${expJobId}/video`),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(custVideoRes.status).toBe(403);

    mockActor = { ...ADMIN_USER };
    const incompleteVideoRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${expJobId}/video`),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(incompleteVideoRes.status).toBe(409);

    // Completed job whose physical file was removed -> graceful 404 (plus invalid range 416 when present)
    const missingKey = `video-studio/${setup.projectId}/renders/render_${expJobId}.mp4`;
    await prisma.videoRenderJob.update({
      where: { id: expJobId },
      data: {
        status: "COMPLETED",
        progress: 100,
        outputStorageKey: missingKey,
        completedAt: new Date(),
        leaseExpiresAt: null,
      },
    });
    const missingOutputVideoRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${expJobId}/video`),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(missingOutputVideoRes.status).toBe(404);

    // Write valid small file, test out-of-bounds Range -> 416 with Content-Range: bytes */<size>
    const validFilePath = path.join(process.cwd(), "storage", "video-studio", setup.projectId, "renders", `render_${expJobId}.mp4`);
    await fs.mkdir(path.dirname(validFilePath), { recursive: true });
    await fs.writeFile(validFilePath, dummyMp4);
    localOutputFiles.push(validFilePath);

    const invalidRangeRes = await adminVideoRoute.GET(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/render-jobs/${expJobId}/video`, {
        headers: { Range: `bytes=${dummyMp4.length + 50}-` },
      }),
      { params: Promise.resolve({ jobId: expJobId }) },
    );
    expect(invalidRangeRes.status).toBe(416);
    expect(invalidRangeRes.headers.get("content-range")).toBe(`bytes */${dummyMp4.length}`);

    // E) Worker safety default RENDER_WORKER_PROCESSING_ENABLED remains false
    const safeCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_API_BASE_URL: "http://localhost:3000",
      RENDER_WORKER_ID: "worker-c33-default-safe",
    });
    expect(safeCfg.processingEnabled).toBe(false);
    const idleWorker = new VideoRenderWorker({
      client: cancelClient,
      logger,
      pollIntervalMs: 200,
      processingEnabled: safeCfg.processingEnabled,
    });
    expect(await idleWorker.runOnce()).toEqual({ status: "idle", reason: "processing_disabled" });
  }, 60_000);

  it("6. Automatically syncs VideoProject.status across render creation, worker failure/retry, cancellation, and MP4 completion", async () => {
    await prisma.videoRenderJob.deleteMany({
      where: { status: { in: ["PENDING", "QUEUED", "PROCESSING"] } },
    });

    const setup = await createRenderReadyProject({
      title: "C33 Project Status Auto Sync",
      aspectRatio: "16:9",
      durationSec: 2,
    });

    // Starts in DRAFT
    const initialProj = await getProjectWithScenes(setup.projectId);
    expect(initialProj?.project.status).toBe("DRAFT");

    // 1) Creating render job moves VideoProject.status -> PROCESSING
    const j1Res = await createRenderJobAction({ projectId: setup.projectId });
    expect(j1Res.ok).toBe(true);
    if (!j1Res.ok) throw new Error(j1Res.error);

    let dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("PROCESSING");
    let dashProcessing = await getProjectsDashboard({ status: "PROCESSING", q: "C33 Project Status Auto Sync" });
    expect(dashProcessing.projects.some((p) => p.id === setup.projectId && p.status === "PROCESSING")).toBe(true);

    // 2) Cancelling the only active render job restores DRAFT
    const cancel1 = await cancelRenderJobAction({ projectId: setup.projectId, jobId: j1Res.data.id });
    expect(cancel1.ok).toBe(true);
    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("DRAFT");

    // 3) Queue second job, worker claims -> PROCESSING, worker fails -> FAILED, retry -> PROCESSING
    const j2Res = await createRenderJobAction({ projectId: setup.projectId });
    expect(j2Res.ok).toBe(true);
    if (!j2Res.ok) throw new Error(j2Res.error);

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c33-status-sync",
      requestTimeoutMs: 15_000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });

    const claimFail = await client.claimNextJob();
    expect(claimFail.claimed).toBe(true);
    expect(claimFail.job?.id).toBe(j2Res.data.id);

    const failRes = await failRoute.POST(
      makeWorkerHttpPost(`/api/internal/video-studio/render-jobs/${j2Res.data.id}/fail`, {
        workerId: "worker-c33-status-sync",
        errorMessage: "Simulated encoder failure",
        stage: "FFmpeg encode",
      }),
      { params: Promise.resolve({ jobId: j2Res.data.id }) },
    );
    expect(failRes.status).toBe(200);

    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("FAILED");
    const dashFailed = await getProjectsDashboard({ status: "FAILED", q: "C33 Project Status Auto Sync" });
    expect(dashFailed.projects.some((p) => p.id === setup.projectId && p.status === "FAILED")).toBe(true);

    const retryRes = await retryRenderJobAction({ projectId: setup.projectId, jobId: j2Res.data.id });
    expect(retryRes.ok).toBe(true);
    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("PROCESSING");

    // 4) Full worker claim + render + upload + /complete moves VideoProject.status -> COMPLETED & sets approvedAt
    const claimPass = await client.claimNextJob();
    expect(claimPass.claimed).toBe(true);
    expect(claimPass.job?.id).toBe(j2Res.data.id);

    const tempRoot = await createIsolatedTempDir("rebx-c33-status-sync");
    const outcome = await processClaimedRenderJob({
      job: claimPass.job!,
      client,
      logger,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempRoot,
    });
    expect(outcome.outcome).toBe("completed");
    localOutputFiles.push(
      path.join(process.cwd(), "storage", "video-studio", setup.projectId, "renders", `render_${j2Res.data.id}.mp4`),
    );

    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("COMPLETED");
    expect(dbProj.approvedAt).not.toBeNull();

    const dashCompleted = await getProjectsDashboard({ status: "COMPLETED", q: "C33 Project Status Auto Sync" });
    expect(
      dashCompleted.projects.some(
        (p) =>
          p.id === setup.projectId &&
          p.status === "COMPLETED" &&
          p.latestRenderJob?.status === "COMPLETED",
      ),
    ).toBe(true);

    // 5) Re-render after editing, then cancel -> because an earlier COMPLETED render exists, restores COMPLETED
    const loadedForEdit = await getProjectWithScenes(setup.projectId);
    expect(loadedForEdit).not.toBeNull();
    const editRes = await saveDraftAction({
      projectId: setup.projectId,
      title: "C33 Project Status Auto Sync (v2)",
      category: "property_showcase",
      status: loadedForEdit!.project.status,
      language: "English",
      tone: "Luxury",
      duration: 10,
      aspectRatio: "16:9",
      scenes: loadedForEdit!.scenes,
    });
    expect(editRes.ok).toBe(true);

    const j3Res = await createRenderJobAction({ projectId: setup.projectId });
    expect(j3Res.ok).toBe(true);
    if (!j3Res.ok) throw new Error(j3Res.error);

    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("PROCESSING");

    const cancel3 = await cancelRenderJobAction({ projectId: setup.projectId, jobId: j3Res.data.id });
    expect(cancel3.ok).toBe(true);

    dbProj = await prisma.videoProject.findUniqueOrThrow({ where: { id: setup.projectId } });
    expect(dbProj.status).toBe("COMPLETED");
  }, 60_000);
});
