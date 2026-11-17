import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
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

type MockS3ObjectEntry = {
  body: Buffer;
  contentType: string;
  contentLength?: number;
  omitContentLength?: boolean;
};

const { mockS3Store, mockS3Send } = vi.hoisted(() => {
  const store = new Map<string, MockS3ObjectEntry>();
  const send = vi.fn(async (cmd: { constructor?: { name?: string }; input?: Record<string, unknown> }) => {
    const cmdName = cmd?.constructor?.name ?? "";
    const input = cmd?.input ?? {};
    const bucket = String(input.Bucket ?? "");
    const key = String(input.Key ?? "");
    const storeKey = `${bucket}/${key}`;

    if (cmdName === "MockPutObjectCommand") {
      const body = Buffer.isBuffer(input.Body)
        ? input.Body
        : Buffer.from(input.Body as Uint8Array);
      store.set(storeKey, {
        body,
        contentType: String(input.ContentType ?? "application/octet-stream"),
      });
      return {};
    }

    if (cmdName === "MockGetObjectCommand") {
      const item = store.get(storeKey);
      if (!item) {
        const notFound = new Error("The specified key does not exist.");
        notFound.name = "NoSuchKey";
        (notFound as unknown as { Code: string; $metadata: { httpStatusCode: number } }).Code = "NoSuchKey";
        (notFound as unknown as { $metadata: { httpStatusCode: number } }).$metadata = { httpStatusCode: 404 };
        throw notFound;
      }

      const byteCopy = new Uint8Array(item.body);
      return {
        Body: Readable.from([Buffer.from(byteCopy)]),
        ContentType: item.contentType,
        ...(item.omitContentLength
          ? {}
          : { ContentLength: item.contentLength ?? item.body.length }),
      };
    }

    if (cmdName === "MockDeleteObjectCommand") {
      store.delete(storeKey);
      return {};
    }

    return {};
  });

  return { mockS3Store: store, mockS3Send: send };
});

vi.mock("@aws-sdk/client-s3", () => {
  class MockPutObjectCommand {
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

import {
  cancelRenderJobAction,
  createProjectAction,
  createRenderJobAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
} from "@/lib/actions/video-studio";
import {
  getPrivateVideoStudioImagesDir,
  LOCAL_PRIVATE_ASSET_PREFIX,
  LOCAL_PRIVATE_IMAGE_PREFIX,
} from "@/lib/video-studio/deps";
import { migrateLegacyPublicSceneImages } from "@/lib/video-studio/migrate-local-images";
import {
  authorizeWorkerJobAssetDownload,
  hashRenderSnapshot,
  transitionRenderJobInternal,
} from "@/lib/video-studio/render-jobs";
import type { RenderJobSnapshot } from "@/lib/video-studio/schemas";
import {
  ADMIN_SCENE_IMAGE_ROUTE_PREFIX,
  LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX,
} from "@/lib/video-studio/script-utils";
import {
  extractAuthorizedSnapshotAssetManifest,
  MAX_RENDER_AUDIO_BYTES,
  MAX_RENDER_IMAGE_BYTES,
} from "@/lib/video-studio/snapshot-assets";
import { GET as audioAdminRouteGet } from "@/app/api/admin/video-studio/audio/route";
import { GET as imageAdminRouteGet } from "@/app/api/admin/video-studio/image/[filename]/route";
import * as claimRoute from "@/app/api/internal/video-studio/render-jobs/claim/route";
import * as recoverRoute from "@/app/api/internal/video-studio/render-jobs/recover/route";
import * as progressRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/progress/route";
import * as heartbeatRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/heartbeat/route";
import * as completeRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/complete/route";
import * as failRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/fail/route";
import * as assetRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/assets/[assetId]/route";

import {
  createJobAssetDownloader,
  createJobTempWorkspace,
  stageJobAssetsToTempWorkspace,
  validateAndPlanSnapshotAssets,
  verifyAssetBinarySignature,
  WorkerAssetValidationError,
} from "../../../worker/video-renderer/src/assets";
import {
  RenderWorkerApiClient,
  WorkerApiHttpError,
  WorkerApiTimeoutError,
} from "../../../worker/video-renderer/src/client";
import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import { createWorkerLogger, type WorkerLogEntry } from "../../../worker/video-renderer/src/logger";

const ADMIN_USER = {
  id: 980001,
  role: "ADMIN" as const,
  email: "video-studio-admin98@example.com",
  name: "Studio Admin Part C323",
};

const CUSTOMER_USER = {
  id: 980002,
  role: "CUSTOMER" as const,
  email: "video-studio-cust98@example.com",
  name: "Studio Customer Part C323",
};

const WORKER_SECRET = "c323-worker-secret-token-very-sensitive-9988776655";
const TEST_SPACES_KEY = "DO_SPACES_KEY_SECRET_TEST_12345";
const TEST_SPACES_SECRET = "DO_SPACES_SECRET_TOKEN_XYZ_987654";
const TEST_SPACES_BUCKET = "rebx-private-studio-test";
const TEST_SPACES_REGION = "blr1";

const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const tempDirsToCleanup: string[] = [];
const originalEnv = { ...process.env };

function makeValidJpgBuffer(tag = "jpg"): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00,
  ]);
  const body = Buffer.from(`rebx-jpg-${tag}`, "utf8");
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, body, eoi]);
}

function makeValidPngBuffer(tag = "png"): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.from([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const payload = Buffer.from(`rebx-png-${tag}`, "utf8");
  return Buffer.concat([sig, ihdr, payload]);
}

function makeValidWebpBuffer(tag = "webp"): Buffer {
  const body = Buffer.from(`rebx-webp-${tag}`, "utf8");
  const riffSize = 4 + 4 + 4 + body.length;
  const header = Buffer.alloc(16);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WEBP", 8, "ascii");
  header.write("VP8 ", 12, "ascii");
  return Buffer.concat([header, body]);
}

function makeValidMp3Buffer(tag = "mp3"): Buffer {
  const header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]);
  const frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const payload = Buffer.from(`rebx-mp3-${tag}`, "utf8");
  return Buffer.concat([header, frame, payload]);
}

function makeValidWavBuffer(durationSec = 1): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * durationSec;
  const buf = Buffer.alloc(44 + dataSize, 0x80);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function createCapturingLogger(): {
  logger: ReturnType<typeof createWorkerLogger>;
  entries: WorkerLogEntry[];
} {
  const entries: WorkerLogEntry[] = [];
  const logger = createWorkerLogger({
    workerId: "worker-c323-test",
    secrets: [WORKER_SECRET, TEST_SPACES_KEY, TEST_SPACES_SECRET],
    sink: (entry) => entries.push(entry),
  });
  return { logger, entries };
}

function createInProcessWorkerFetch(opts?: {
  onAssetGet?: (info: { jobId: string; assetId: string; pathname: string; search: string }) => void;
}): typeof fetch {
  return async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname;

    const req = new NextRequest(rawUrl, {
      method: init?.method ?? "GET",
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

    const assetMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/assets\/([^/]+)$/.exec(pathname);
    if (assetMatch) {
      const jobId = decodeURIComponent(assetMatch[1]);
      const assetId = decodeURIComponent(assetMatch[2]);
      opts?.onAssetGet?.({ jobId, assetId, pathname, search: parsed.search });
      return assetRoute.GET(req, { params: Promise.resolve({ jobId, assetId }) });
    }

    const actionMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/(progress|heartbeat|complete|fail)$/.exec(
      pathname,
    );
    if (actionMatch) {
      const jobId = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const ctx = { params: Promise.resolve({ jobId }) };
      if (action === "progress") return progressRoute.POST(req, ctx);
      if (action === "heartbeat") return heartbeatRoute.POST(req, ctx);
      if (action === "complete") return completeRoute.POST(req, ctx);
      if (action === "fail") return failRoute.POST(req, ctx);
    }

    return new Response(JSON.stringify({ ok: false, error: "Not found" }), { status: 404 });
  };
}

function makeAssetGetRequest(
  urlPath: string,
  opts: {
    secret?: string | null;
    authHeader?: string | null;
    workerIdHeader?: string | null;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (opts.authHeader !== undefined) {
    if (opts.authHeader !== null) headers.set("Authorization", opts.authHeader);
  } else if (opts.secret !== null) {
    headers.set("Authorization", `Bearer ${opts.secret ?? WORKER_SECRET}`);
  }

  if (opts.workerIdHeader !== undefined) {
    if (opts.workerIdHeader !== null) headers.set("X-REBX-Worker-Id", opts.workerIdHeader);
  } else {
    headers.set("X-REBX-Worker-Id", "worker-c323-alpha");
  }

  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: "GET",
    headers,
  });
}

async function createIsolatedTempBase(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rebx-c323-test-"));
  tempDirsToCleanup.push(dir);
  return dir;
}

async function createMultiFormatLocalProject(title = "C323 Multi-Format Local Project") {
  const jpgBytes = makeValidJpgBuffer("scene1_shared");
  const pngBytes = makeValidPngBuffer("scene2");
  const webpBytes = makeValidWebpBuffer("scene3");
  const mp3Bytes = makeValidMp3Buffer("scene1_shared");
  const wavBytes = makeValidWavBuffer(1);

  const proj = await createProjectAction({
    title,
    topic: "Kokapet & Tellapur Realty Showcase",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Luxury",
    duration: 24,
    aspectRatio: "16:9",
    scenes: [
      {
        id: "init_1",
        order: 1,
        title: "Scene 1 JPG + MP3",
        narration: "Welcome to Kokapet Neopolis skyline.",
        imagePrompt: "Aerial sunset tower",
        imageUrl: null,
        duration: 6,
        locked: false,
      },
      {
        id: "init_2",
        order: 2,
        title: "Scene 2 PNG + WAV",
        narration: "Italian marble lobby with double-height ceilings.",
        imagePrompt: "Grand marble lobby",
        imageUrl: null,
        duration: 6,
        locked: false,
      },
      {
        id: "init_3",
        order: 3,
        title: "Scene 3 WebP + MP3",
        narration: "Private sky deck overlooking the lake.",
        imagePrompt: "Sky deck infinity view",
        imageUrl: null,
        duration: 6,
        locked: false,
      },
      {
        id: "init_4",
        order: 4,
        title: "Scene 4 Shared Reused Assets",
        narration: "Welcome to Kokapet Neopolis skyline.",
        imagePrompt: "Aerial sunset tower outro",
        imageUrl: null,
        duration: 6,
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
  expect(scenes).toHaveLength(4);

  // Scene 1: JPG + MP3
  const fdImg1 = new FormData();
  fdImg1.set("projectId", projectId);
  fdImg1.set("sceneId", scenes[0].id);
  fdImg1.set("file", new File([new Uint8Array(jpgBytes)], "untrusted_scene_1.jpg", { type: "image/jpeg" }));
  const upImg1 = await uploadSceneImageAction(fdImg1);
  expect(upImg1.ok).toBe(true);
  if (!upImg1.ok) throw new Error(upImg1.error);
  localImageUrls.push(upImg1.data.imageUrl);

  const fdAud1 = new FormData();
  fdAud1.set("projectId", projectId);
  fdAud1.set("sceneId", scenes[0].id);
  fdAud1.set("language", "en-IN");
  fdAud1.set("file", new File([new Uint8Array(mp3Bytes)], "untrusted_voice_1.mp3", { type: "audio/mpeg" }));
  const upAud1 = await uploadSceneAudioAction(fdAud1);
  expect(upAud1.ok).toBe(true);
  if (!upAud1.ok) throw new Error(upAud1.error);
  localAudioKeys.push(upAud1.data.audio.storageKey);

  // Scene 2: PNG + WAV
  const fdImg2 = new FormData();
  fdImg2.set("projectId", projectId);
  fdImg2.set("sceneId", scenes[1].id);
  fdImg2.set("file", new File([new Uint8Array(pngBytes)], "scene_2.png", { type: "image/png" }));
  const upImg2 = await uploadSceneImageAction(fdImg2);
  expect(upImg2.ok).toBe(true);
  if (!upImg2.ok) throw new Error(upImg2.error);
  localImageUrls.push(upImg2.data.imageUrl);

  const fdAud2 = new FormData();
  fdAud2.set("projectId", projectId);
  fdAud2.set("sceneId", scenes[1].id);
  fdAud2.set("language", "en-IN");
  fdAud2.set("file", new File([new Uint8Array(wavBytes)], "voice_2.wav", { type: "audio/wav" }));
  const upAud2 = await uploadSceneAudioAction(fdAud2);
  expect(upAud2.ok).toBe(true);
  if (!upAud2.ok) throw new Error(upAud2.error);
  localAudioKeys.push(upAud2.data.audio.storageKey);

  // Scene 3: WebP + MP3 (distinct MP3)
  const webpMp3Bytes = makeValidMp3Buffer("scene3_unique");
  const fdImg3 = new FormData();
  fdImg3.set("projectId", projectId);
  fdImg3.set("sceneId", scenes[2].id);
  fdImg3.set("file", new File([new Uint8Array(webpBytes)], "scene_3.webp", { type: "image/webp" }));
  const upImg3 = await uploadSceneImageAction(fdImg3);
  expect(upImg3.ok).toBe(true);
  if (!upImg3.ok) throw new Error(upImg3.error);
  localImageUrls.push(upImg3.data.imageUrl);

  const fdAud3 = new FormData();
  fdAud3.set("projectId", projectId);
  fdAud3.set("sceneId", scenes[2].id);
  fdAud3.set("language", "en-IN");
  fdAud3.set("file", new File([new Uint8Array(webpMp3Bytes)], "voice_3.mp3", { type: "audio/mpeg" }));
  const upAud3 = await uploadSceneAudioAction(fdAud3);
  expect(upAud3.ok).toBe(true);
  if (!upAud3.ok) throw new Error(upAud3.error);
  localAudioKeys.push(upAud3.data.audio.storageKey);

  // Scene 4: Reuse exact same imageUrl & audio storageKey from Scene 1 to verify deduplication
  await prisma.videoScene.update({
    where: { id: scenes[3].id },
    data: {
      imageUrl: upImg1.data.imageUrl,
      imagePath: upImg1.data.imageUrl,
    },
  });

  const latestProj = await prisma.videoProject.findUniqueOrThrow({
    where: { id: projectId },
    select: { metadata: true },
  });
  const meta = (latestProj.metadata ?? {}) as Record<string, unknown>;
  const sceneAudio = ((meta.sceneAudio ?? {}) as Record<string, unknown>) || {};
  sceneAudio[scenes[3].id] = upAud1.data.audio;
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { metadata: { ...meta, sceneAudio } as never },
  });

  return {
    projectId,
    scenes,
    expectedBytesByRef: new Map<string, Buffer>([
      [upImg1.data.imageUrl, jpgBytes],
      [`${LOCAL_PRIVATE_IMAGE_PREFIX}${path.posix.basename(upImg1.data.imageUrl)}`, jpgBytes],
      [upImg2.data.imageUrl, pngBytes],
      [`${LOCAL_PRIVATE_IMAGE_PREFIX}${path.posix.basename(upImg2.data.imageUrl)}`, pngBytes],
      [upImg3.data.imageUrl, webpBytes],
      [`${LOCAL_PRIVATE_IMAGE_PREFIX}${path.posix.basename(upImg3.data.imageUrl)}`, webpBytes],
      [upAud1.data.audio.storageKey, mp3Bytes],
      [upAud2.data.audio.storageKey, wavBytes],
      [upAud3.data.audio.storageKey, webpMp3Bytes],
    ]),
    firstAudioKey: upAud1.data.audio.storageKey,
    firstImageUrl: upImg1.data.imageUrl,
  };
}

async function createSimpleLocalRenderReadyProject(title = "C323 Simple Project") {
  const jpgBytes = makeValidJpgBuffer("simple");
  const mp3Bytes = makeValidMp3Buffer("simple");

  const proj = await createProjectAction({
    title,
    topic: "Simple Single Scene Tower Tour",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Professional",
    duration: 12,
    aspectRatio: "16:9",
    scenes: [
      {
        id: "init_1",
        order: 1,
        title: "Main Entrance",
        narration: "Explore REBX verified luxury properties today.",
        imagePrompt: "Luxury gatehouse",
        imageUrl: null,
        duration: 6,
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

  const imgFd = new FormData();
  imgFd.set("projectId", projectId);
  imgFd.set("sceneId", scenes[0].id);
  imgFd.set("file", new File([new Uint8Array(jpgBytes)], "scene_simple.jpg", { type: "image/jpeg" }));
  const imgRes = await uploadSceneImageAction(imgFd);
  expect(imgRes.ok).toBe(true);
  if (!imgRes.ok) throw new Error(imgRes.error);
  localImageUrls.push(imgRes.data.imageUrl);

  const audFd = new FormData();
  audFd.set("projectId", projectId);
  audFd.set("sceneId", scenes[0].id);
  audFd.set("language", "en-IN");
  audFd.set("file", new File([new Uint8Array(mp3Bytes)], "voice_simple.mp3", { type: "audio/mpeg" }));
  const audRes = await uploadSceneAudioAction(audFd);
  expect(audRes.ok).toBe(true);
  if (!audRes.ok) throw new Error(audRes.error);
  localAudioKeys.push(audRes.data.audio.storageKey);

  return {
    projectId,
    sceneId: scenes[0].id,
    imageUrl: imgRes.data.imageUrl,
    audioKey: audRes.data.audio.storageKey,
    jpgBytes,
    mp3Bytes,
  };
}

async function cleanupAllTestData() {
  const projects = await prisma.videoProject.findMany({
    where: {
      OR: [
        { createdById: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
        { id: { in: createdProjectIds } },
      ],
    },
    include: { scenes: { select: { imageUrl: true, imagePath: true } } },
  });

  for (const p of projects) {
    for (const s of p.scenes) {
      const url = s.imageUrl || s.imagePath;
      if (
        url?.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX) ||
        url?.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX) ||
        url?.startsWith(LOCAL_PRIVATE_IMAGE_PREFIX)
      ) {
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
    where: {
      OR: [
        { createdById: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
        { id: { in: createdProjectIds } },
      ],
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
  });

  for (const url of new Set(localImageUrls)) {
    let filename: string | null = null;
    if (url.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)) {
      filename = path.posix.basename(url.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length));
    } else if (url.startsWith(LOCAL_PRIVATE_IMAGE_PREFIX)) {
      filename = path.posix.basename(url.slice(LOCAL_PRIVATE_IMAGE_PREFIX.length));
    } else if (url.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)) {
      filename = path.posix.basename(url.slice(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX.length));
    }
    if (filename && filename !== "." && filename !== "..") {
      await fs.unlink(path.join(process.cwd(), "storage", "video-studio", "images", filename)).catch(() => {});
      await fs.unlink(path.join(process.cwd(), "public", "uploads", "video-studio", filename)).catch(() => {});
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

describe("REBX AI Video Studio - Phase 3 Part C3.2.3: Secure Worker Asset Access", () => {
  beforeAll(async () => {
    await cleanupAllTestData();
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

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STORAGE_PROVIDER = "local";
    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = WORKER_SECRET;
    mockActor = { ...ADMIN_USER };
    mockS3Store.clear();
    mockS3Send.mockClear();
  });

  afterEach(async () => {
    await prisma.videoRenderJob.deleteMany({
      where: {
        OR: [
          { createdById: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } },
          { projectId: { in: createdProjectIds } },
        ],
      },
    });
    for (const dir of tempDirsToCleanup.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  afterAll(async () => {
    await cleanupAllTestData();
    process.env = { ...originalEnv };
  });

  it("1. Streams valid JPG/PNG/WebP images & MP3/WAV audio via authenticated endpoint, deduplicates shared assets, keeps snapshot immutable, and uses safe temp filenames", async () => {
    const setup = await createMultiFormatLocalProject();
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const jobBefore = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobRes.data.id } });

    const downloadedAssetIds: string[] = [];
    const { logger, entries } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-alpha",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch({
        onAssetGet: ({ assetId }) => downloadedAssetIds.push(assetId),
      }),
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);
    expect(claim.job?.id).toBe(jobRes.data.id);

    const tempBase = await createIsolatedTempBase();
    const staged = await stageJobAssetsToTempWorkspace({
      job: claim.job!,
      transport: client,
      logger,
      tempDir: tempBase,
    });

    expect(staged.stats.totalSceneAssetRefs).toBe(8);
    expect(staged.stats.uniqueDownloads).toBe(6);
    expect(staged.stats.deduplicatedReuses).toBe(2);
    expect(downloadedAssetIds).toHaveLength(6);
    expect(staged.scenes).toHaveLength(4);

    // Scene 1 and Scene 4 reuse the exact same staged image & audio files without duplicate HTTP requests
    expect(staged.scenes[3].imageFilePath).toBe(staged.scenes[0].imageFilePath);
    expect(staged.scenes[3].audioFilePath).toBe(staged.scenes[0].audioFilePath);

    // Verify safe generated filenames (not untrusted client names like "untrusted_scene_1.jpg")
    for (const s of staged.scenes) {
      expect(path.basename(s.imageFilePath)).toMatch(/^asset_\d{2}_img_[a-f0-9]{24}\.(jpg|png|webp)$/);
      expect(path.basename(s.imageFilePath)).not.toContain("untrusted");
      expect(path.basename(s.audioFilePath)).toMatch(/^asset_\d{2}_aud_[a-f0-9]{24}\.(mp3|wav)$/);
      expect(path.basename(s.audioFilePath)).not.toContain("untrusted");
    }

    // Verify byte-for-byte integrity across JPG, PNG, WebP, MP3, WAV
    const manifest = extractAuthorizedSnapshotAssetManifest(claim.job!.snapshot as RenderJobSnapshot);
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) throw new Error(manifest.error);

    for (const asset of manifest.orderedAssets) {
      const stagedFile = staged.downloadedByAssetId.get(asset.assetId);
      expect(stagedFile).toBeDefined();
      const diskBytes = await fs.readFile(stagedFile!.filePath);
      const expected = setup.expectedBytesByRef.get(asset.resolvedRef);
      expect(expected).toBeDefined();
      expect(diskBytes.equals(expected!)).toBe(true);
    }

    // Verify direct HTTP response security headers & content metadata
    const firstImgAssetId = staged.scenes[0].imageAssetId;
    const directRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${firstImgAssetId}`),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId: firstImgAssetId }) },
    );
    expect(directRes.status).toBe(200);
    expect(directRes.headers.get("cache-control")).toBe("private, no-store");
    expect(directRes.headers.get("pragma")).toBe("no-cache");
    expect(directRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(directRes.headers.get("content-type")).toBe("image/jpeg");
    expect(Number(directRes.headers.get("content-length"))).toBeGreaterThan(0);
    expect(directRes.headers.get("content-disposition")).toContain(`${firstImgAssetId}.jpg`);

    // Verify original snapshot and project remain untouched
    const jobAfter = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobRes.data.id } });
    expect(jobAfter.snapshotHash).toBe(jobBefore.snapshotHash);
    expect(jobAfter.snapshot).toEqual(jobBefore.snapshot);

    // Logs must never expose worker secret
    const allLogsJson = JSON.stringify(entries);
    expect(allLogsJson).not.toContain(WORKER_SECRET);

    // Cleanup removes temp workspace and is idempotent
    await expect(fs.access(staged.workspaceDir)).resolves.toBeUndefined();
    await staged.cleanup();
    await expect(fs.access(staged.workspaceDir)).rejects.toThrow();
    await staged.cleanup();
  });

  it("2. Rejects unauthorized workers (401/403) and fail-closed env configurations without leaking secrets", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Auth Project");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) throw new Error(manifest.error);
    const assetId = manifest.orderedAssets[0].assetId;

    await transitionRenderJobInternal({
      projectId: setup.projectId,
      jobId: jobRes.data.id,
      targetStatus: "QUEUED",
      progress: 0,
    });
    const claimed = await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(claimed.status).toBe("PROCESSING");

    const endpoint = `/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${assetId}`;
    const ctx = { params: Promise.resolve({ jobId: jobRes.data.id, assetId }) };

    const missingRes = await assetRoute.GET(makeAssetGetRequest(endpoint, { secret: null }), ctx);
    expect(missingRes.status).toBe(401);

    const basicRes = await assetRoute.GET(makeAssetGetRequest(endpoint, { authHeader: "Basic dXNlcjpwYXNz" }), ctx);
    expect(basicRes.status).toBe(401);

    const wrongRes = await assetRoute.GET(makeAssetGetRequest(endpoint, { secret: "wrong-worker-token" }), ctx);
    expect(wrongRes.status).toBe(403);
    expect(await wrongRes.text()).not.toContain(WORKER_SECRET);

    process.env.RENDER_WORKER_ENABLED = "false";
    const disabledRes = await assetRoute.GET(makeAssetGetRequest(endpoint), ctx);
    expect(disabledRes.status).toBe(403);

    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = "";
    const noSecretRes = await assetRoute.GET(makeAssetGetRequest(endpoint), ctx);
    expect(noSecretRes.status).toBe(403);
  });

  it("3. Rejects workers that do not own the job, missing/mismatched workerId, unclaimed jobs, and cancelled/completed jobs", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Ownership Project");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) throw new Error(manifest.error);
    const assetId = manifest.orderedAssets[0].assetId;

    const endpoint = `/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${assetId}`;
    const ctx = { params: Promise.resolve({ jobId: jobRes.data.id, assetId }) };

    // Unclaimed PENDING job -> 403 UNCLAIMED_JOB
    const unclaimedRes = await assetRoute.GET(makeAssetGetRequest(endpoint), ctx);
    expect(unclaimedRes.status).toBe(403);
    expect((await unclaimedRes.json()).code).toBe("UNCLAIMED_JOB");

    // Claim for worker-c323-alpha
    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    // Wrong worker -> 403 WORKER_MISMATCH
    const otherWorkerRes = await assetRoute.GET(
      makeAssetGetRequest(endpoint, { workerIdHeader: "worker-c323-intruder" }),
      ctx,
    );
    expect(otherWorkerRes.status).toBe(403);
    expect((await otherWorkerRes.json()).code).toBe("WORKER_MISMATCH");

    // Missing workerId -> 400 INVALID_WORKER_ID
    const noWorkerIdRes = await assetRoute.GET(
      makeAssetGetRequest(endpoint, { workerIdHeader: null }),
      ctx,
    );
    expect(noWorkerIdRes.status).toBe(400);
    expect((await noWorkerIdRes.json()).code).toBe("INVALID_WORKER_ID");

    // Conflicting header and query workerId -> 400 WORKER_ID_MISMATCH
    const conflictRes = await assetRoute.GET(
      makeAssetGetRequest(`${endpoint}?workerId=worker-c323-beta`, { workerIdHeader: "worker-c323-alpha" }),
      ctx,
    );
    expect(conflictRes.status).toBe(400);
    expect((await conflictRes.json()).code).toBe("WORKER_ID_MISMATCH");

    // Cancelled job revokes access -> 409 JOB_CANCELLED
    const setupCancel = await createSimpleLocalRenderReadyProject("C323 Cancelled Project");
    const cancelJobRes = await createRenderJobAction({ projectId: setupCancel.projectId });
    expect(cancelJobRes.ok).toBe(true);
    if (!cancelJobRes.ok) throw new Error(cancelJobRes.error);
    const cancelAssetId = extractAuthorizedSnapshotAssetManifest(cancelJobRes.data.snapshot);
    if (!cancelAssetId.ok) throw new Error(cancelAssetId.error);

    await cancelRenderJobAction({ projectId: setupCancel.projectId, jobId: cancelJobRes.data.id });
    const cancelledRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${cancelJobRes.data.id}/assets/${cancelAssetId.orderedAssets[0].assetId}`),
      { params: Promise.resolve({ jobId: cancelJobRes.data.id, assetId: cancelAssetId.orderedAssets[0].assetId }) },
    );
    expect(cancelledRes.status).toBe(409);
    expect((await cancelledRes.json()).code).toBe("JOB_CANCELLED");

    // Completed job cannot download assets -> 409 INVALID_STATUS
    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: { status: "COMPLETED", progress: 100, completedAt: new Date() },
    });
    const completedRes = await assetRoute.GET(makeAssetGetRequest(endpoint), ctx);
    expect(completedRes.status).toBe(409);
    expect((await completedRes.json()).code).toBe("INVALID_STATUS");
  });

  it("4. Rejects downloads when worker lease has expired or is missing (409 LEASE_EXPIRED)", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Lease Expiry");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    if (!manifest.ok) throw new Error(manifest.error);
    const assetId = manifest.orderedAssets[0].assetId;

    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() - 10_000),
      },
    });

    const expiredRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${assetId}`),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId }) },
    );
    expect(expiredRes.status).toBe(409);
    expect((await expiredRes.json()).code).toBe("LEASE_EXPIRED");

    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: { leaseExpiresAt: null },
    });
    const nullLeaseRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${assetId}`),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId }) },
    );
    expect(nullLeaseRes.status).toBe(409);
    expect((await nullLeaseRes.json()).code).toBe("LEASE_EXPIRED");
  });

  it("5. Rejects assets not referenced in the claimed job snapshot (including valid IDs from another job)", async () => {
    const setupA = await createSimpleLocalRenderReadyProject("C323 Scope Job A");
    const jobA = await createRenderJobAction({ projectId: setupA.projectId });
    expect(jobA.ok).toBe(true);
    if (!jobA.ok) throw new Error(jobA.error);

    const setupB = await createSimpleLocalRenderReadyProject("C323 Scope Job B");
    const jobB = await createRenderJobAction({ projectId: setupB.projectId });
    expect(jobB.ok).toBe(true);
    if (!jobB.ok) throw new Error(jobB.error);

    const manifestB = extractAuthorizedSnapshotAssetManifest(jobB.data.snapshot);
    if (!manifestB.ok) throw new Error(manifestB.error);
    const foreignAssetId = manifestB.orderedAssets[0].assetId;

    await prisma.videoRenderJob.update({
      where: { id: jobA.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const foreignRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobA.data.id}/assets/${foreignAssetId}`),
      { params: Promise.resolve({ jobId: jobA.data.id, assetId: foreignAssetId }) },
    );
    expect(foreignRes.status).toBe(404);
    expect((await foreignRes.json()).code).toBe("ASSET_NOT_IN_SNAPSHOT");

    const unknownId = "img_0123456789abcdef01234567";
    const missingIdRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobA.data.id}/assets/${unknownId}`),
      { params: Promise.resolve({ jobId: jobA.data.id, assetId: unknownId }) },
    );
    expect(missingIdRes.status).toBe(404);
    expect((await missingIdRes.json()).code).toBe("ASSET_NOT_IN_SNAPSHOT");
  });

  it("6. Rejects arbitrary storage keys, external URLs, and direct path/url query parameters", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Arbitrary Key Project");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    if (!manifest.ok) throw new Error(manifest.error);
    const validAssetId = manifest.orderedAssets[0].assetId;

    const arbitraryKeys = [
      setup.audioKey,
      setup.imageUrl,
      "local-private:another_file.mp3",
      "https://evil.example.com/payload.mp3",
      "video-studio/arbitrary/file.jpg",
    ];
    for (const badAssetId of arbitraryKeys) {
      const res = await assetRoute.GET(
        makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${encodeURIComponent(badAssetId)}`),
        { params: Promise.resolve({ jobId: jobRes.data.id, assetId: badAssetId }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_ASSET_ID");
    }

    for (const paramName of ["key", "path", "url", "file", "storageKey", "sourceUrl"]) {
      const res = await assetRoute.GET(
        makeAssetGetRequest(
          `/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${validAssetId}?${paramName}=secret`,
        ),
        { params: Promise.resolve({ jobId: jobRes.data.id, assetId: validAssetId }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("UNSUPPORTED_QUERY_PARAM");
    }

    // Tampered DB snapshot with external URL must also fail safely
    const tampered = structuredClone(jobRes.data.snapshot);
    tampered.scenes[0].image = {
      sourceUrl: "https://evil.example.com/steal.jpg",
      provider: "local",
      resolvedPathOrKey: "https://evil.example.com/steal.jpg",
    };
    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: { snapshot: tampered as never },
    });

    await expect(
      authorizeWorkerJobAssetDownload({
        jobId: jobRes.data.id,
        assetId: validAssetId,
        workerId: "worker-c323-alpha",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_SNAPSHOT_ASSET" });
  });

  it("7. Blocks path traversal attacks in route params, tampered snapshots, and symlinks", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Traversal Project");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    if (!manifest.ok) throw new Error(manifest.error);
    const validAssetId = manifest.orderedAssets[0].assetId;

    const traversalAssets = ["../../.env", "..\\..\\.env", "%2e%2e%2f.env", "img_..secret"];
    for (const badAsset of traversalAssets) {
      const res = await assetRoute.GET(
        makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${encodeURIComponent(badAsset)}`),
        { params: Promise.resolve({ jobId: jobRes.data.id, assetId: badAsset }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_ASSET_ID");
    }

    for (const badJob of ["../../.env", "job%2e%2e123", "bad\\job"]) {
      const res = await assetRoute.GET(
        makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${encodeURIComponent(badJob)}/assets/${validAssetId}`),
        { params: Promise.resolve({ jobId: badJob, assetId: validAssetId }) },
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_JOB_ID");
    }

    // Tampered DB snapshot attempting directory traversal
    const tamperedSnap = structuredClone(jobRes.data.snapshot);
    tamperedSnap.scenes[0].audio.storageKey = "local-private:../../.env";
    tamperedSnap.scenes[0].audio.resolvedKey = "local-private:../../.env";
    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: { snapshot: tamperedSnap as never },
    });

    await expect(
      authorizeWorkerJobAssetDownload({
        jobId: jobRes.data.id,
        assetId: validAssetId,
        workerId: "worker-c323-alpha",
      }),
    ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_SNAPSHOT_ASSET" });

    // Restore valid snapshot and check symlink protection if OS allows symlink creation
    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: { snapshot: jobRes.data.snapshot as never },
    });

    const filename = setup.audioKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    const privatePath = path.join(process.cwd(), "storage", "video-studio", filename);
    const symlinkTarget = path.join(process.cwd(), ".env");
    await fs.unlink(privatePath);
    let createdSymlink = false;
    try {
      await fs.symlink(symlinkTarget, privatePath);
      createdSymlink = true;
    } catch {
      // Windows non-elevated accounts may throw EPERM for symlinks; restore regular file below
      await fs.writeFile(privatePath, setup.mp3Bytes);
    }

    if (createdSymlink) {
      const audAssetId = manifest.orderedAssets.find((a) => a.kind === "audio")!.assetId;
      const symRes = await assetRoute.GET(
        makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${audAssetId}`),
        { params: Promise.resolve({ jobId: jobRes.data.id, assetId: audAssetId }) },
      );
      expect(symRes.status).toBe(403);
      expect((await symRes.json()).code).toBe("INVALID_ASSET_PATH");
    }
  });

  it("8. Returns 404 ASSET_NOT_FOUND for missing local asset without exposing host filesystem paths", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Missing Local File");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    await prisma.videoRenderJob.update({
      where: { id: jobRes.data.id },
      data: {
        status: "PROCESSING",
        workerId: "worker-c323-alpha",
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const manifest = extractAuthorizedSnapshotAssetManifest(jobRes.data.snapshot);
    if (!manifest.ok) throw new Error(manifest.error);
    const audAssetId = manifest.orderedAssets.find((a) => a.kind === "audio")!.assetId;

    // Delete the underlying private local file after job snapshot creation
    const audioFilename = setup.audioKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    await fs.unlink(path.join(process.cwd(), "storage", "video-studio", audioFilename));

    const res = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${audAssetId}`),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId: audAssetId }) },
    );
    expect(res.status).toBe(404);
    const bodyText = await res.text();
    const bodyJson = JSON.parse(bodyText);
    expect(bodyJson.code).toBe("ASSET_NOT_FOUND");
    expect(bodyText).not.toContain(process.cwd());
    expect(bodyText).not.toContain("storage\\video-studio");
  });

  it("9. Downloads private DigitalOcean Spaces objects via mocked S3, handles missing objects (404), and prevents silent provider fallback", async () => {
    process.env.STORAGE_PROVIDER = "spaces";
    process.env.SPACES_KEY = TEST_SPACES_KEY;
    process.env.SPACES_SECRET = TEST_SPACES_SECRET;
    process.env.SPACES_BUCKET = TEST_SPACES_BUCKET;
    process.env.SPACES_REGION = TEST_SPACES_REGION;

    const proj = await createProjectAction({
      title: "C323 Spaces Project",
      topic: "Jubilee Hills Mansion Tour",
      category: "property_showcase",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Luxury",
      duration: 12,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "init_1",
          order: 1,
          title: "Spaces Scene",
          narration: "Private gated villa in Jubilee Hills.",
          imagePrompt: "Villa twilight",
          imageUrl: null,
          duration: 6,
          locked: false,
        },
      ],
    });
    expect(proj.ok).toBe(true);
    if (!proj.ok) throw new Error(proj.error);
    const projectId = proj.data.id;
    createdProjectIds.push(projectId);

    const [scene] = await prisma.videoScene.findMany({ where: { projectId } });
    const pngBytes = makeValidPngBuffer("spaces_png");
    const mp3Bytes = makeValidMp3Buffer("spaces_mp3");

    const imgFd = new FormData();
    imgFd.set("projectId", projectId);
    imgFd.set("sceneId", scene.id);
    imgFd.set("file", new File([new Uint8Array(pngBytes)], "villa.png", { type: "image/png" }));
    const imgUp = await uploadSceneImageAction(imgFd);
    expect(imgUp.ok).toBe(true);

    const audFd = new FormData();
    audFd.set("projectId", projectId);
    audFd.set("sceneId", scene.id);
    audFd.set("language", "en-IN");
    audFd.set("file", new File([new Uint8Array(mp3Bytes)], "villa_voice.mp3", { type: "audio/mpeg" }));
    const audUp = await uploadSceneAudioAction(audFd);
    expect(audUp.ok).toBe(true);
    if (!audUp.ok) throw new Error(audUp.error);

    // Ensure private audio was stored in mocked Spaces, NOT as local-private:
    expect(audUp.data.audio.storageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)).toBe(false);
    const spacesAudioKey = audUp.data.audio.storageKey;

    const jobRes = await createRenderJobAction({ projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const { logger, entries } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-spaces",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);
    expect(claim.job?.id).toBe(jobRes.data.id);

    const tempBase = await createIsolatedTempBase();
    const staged = await stageJobAssetsToTempWorkspace({
      job: claim.job!,
      transport: client,
      logger,
      tempDir: tempBase,
    });

    expect(staged.scenes).toHaveLength(1);
    expect((await fs.readFile(staged.scenes[0].imageFilePath)).equals(pngBytes)).toBe(true);
    expect((await fs.readFile(staged.scenes[0].audioFilePath)).equals(mp3Bytes)).toBe(true);

    const getCalls = mockS3Send.mock.calls.filter(
      (c) => (c[0] as { constructor?: { name?: string } })?.constructor?.name === "MockGetObjectCommand",
    );
    expect(getCalls.length).toBe(2);

    // Logs & HTTP metadata never contain Spaces credentials
    const logBlob = JSON.stringify(entries);
    expect(logBlob).not.toContain(TEST_SPACES_KEY);
    expect(logBlob).not.toContain(TEST_SPACES_SECRET);

    // Missing Spaces object returns 404 ASSET_NOT_FOUND
    mockS3Store.delete(`${TEST_SPACES_BUCKET}/${spacesAudioKey}`);
    const audAssetId = staged.scenes[0].audioAssetId;
    const missingSpacesRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${audAssetId}`, {
        workerIdHeader: "worker-c323-spaces",
      }),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId: audAssetId }) },
    );
    expect(missingSpacesRes.status).toBe(404);
    expect((await missingSpacesRes.json()).code).toBe("ASSET_NOT_FOUND");

    // Zero silent fallback: switching STORAGE_PROVIDER to "local" while snapshot references Spaces must fail with 422
    process.env.STORAGE_PROVIDER = "local";
    const mismatchRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${jobRes.data.id}/assets/${staged.scenes[0].imageAssetId}`, {
        workerIdHeader: "worker-c323-spaces",
      }),
      { params: Promise.resolve({ jobId: jobRes.data.id, assetId: staged.scenes[0].imageAssetId }) },
    );
    expect(mismatchRes.status).toBe(422);
    expect((await mismatchRes.json()).code).toBe("STORAGE_PROVIDER_MISMATCH");

    await staged.cleanup();
  });

  it("10. Rejects invalid binary file signatures and mismatched Content-Type headers while cleaning partial files", async () => {
    expect(verifyAssetBinarySignature(Buffer.from("<html>not-an-image</html>"), "jpg")).toBe(false);
    expect(verifyAssetBinarySignature(Buffer.from("<html>not-a-png</html>"), "png")).toBe(false);
    expect(verifyAssetBinarySignature(Buffer.from("RIFF0000WAVE"), "webp")).toBe(false);
    expect(verifyAssetBinarySignature(Buffer.from("not-mp3-data"), "mp3")).toBe(false);

    const setup = await createSimpleLocalRenderReadyProject("C323 Corrupt Signature");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    // Overwrite local .jpg on disk with malicious HTML masquerading as an image
    const corruptFilename = setup.imageUrl.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)
      ? setup.imageUrl.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length)
      : path.posix.basename(setup.imageUrl);
    await fs.writeFile(
      path.join(process.cwd(), "storage", "video-studio", "images", corruptFilename),
      Buffer.from("<!DOCTYPE html><html><body>fake</body></html>", "utf8"),
    );

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-sig",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const tempBase = await createIsolatedTempBase();
    await expect(
      stageJobAssetsToTempWorkspace({
        job: claim.job!,
        transport: client,
        logger,
        tempDir: tempBase,
      }),
    ).rejects.toMatchObject({ code: "INVALID_FILE_SIGNATURE" });

    // Entire workspace should be cleaned up on failure
    const remaining = await fs.readdir(tempBase);
    expect(remaining).toHaveLength(0);

    // Also verify worker rejects wrong Content-Type before writing target file
    const plan = validateAndPlanSnapshotAssets(claim.job!.snapshot);
    const badMimeClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-sig",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: async () =>
        new Response("not-jpeg", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    });
    const workspace = await createJobTempWorkspace({ jobId: claim.job!.id, baseTempDir: tempBase });
    const badTarget = workspace.allocateSafeAssetPath({
      index: 0,
      assetId: plan.uniqueAssets[0].assetId,
      format: plan.uniqueAssets[0].format,
    });
    await expect(
      badMimeClient.downloadJobAsset({
        jobId: claim.job!.id,
        asset: plan.uniqueAssets[0],
        targetFilePath: badTarget,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
    expect(await fs.readdir(workspace.assetsDir)).toHaveLength(0);
    await workspace.cleanup();
  });

  it("11. Rejects oversized assets on both server (413) and worker streaming cap (Content-Length & unannounced chunk overflow)", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Oversize Check");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const { logger } = createCapturingLogger();
    const tempBase = await createIsolatedTempBase();

    // 1. Worker rejects when asset exceeds maxImageBytes during stageJobAssetsToTempWorkspace
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-size",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    await expect(
      stageJobAssetsToTempWorkspace({
        job: claim.job!,
        transport: client,
        logger,
        tempDir: tempBase,
        maxImageBytes: 10, // smaller than actual JPG header
      }),
    ).rejects.toMatchObject({ code: "ASSET_TOO_LARGE" });
    expect(await fs.readdir(tempBase)).toHaveLength(0);

    // 2. Worker rejects chunked transfer without Content-Length that overruns maxBytes mid-stream
    const plan = validateAndPlanSnapshotAssets(claim.job!.snapshot);
    const streamingClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-size",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(makeValidJpgBuffer("chunk1_oversized_payload_123456"));
              controller.enqueue(Buffer.alloc(2048, 0x41));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "image/jpeg" },
          },
        ),
    });

    const workspace = await createJobTempWorkspace({ jobId: claim.job!.id, baseTempDir: tempBase });
    const target = workspace.allocateSafeAssetPath({
      index: 0,
      assetId: plan.uniqueAssets[0].assetId,
      format: plan.uniqueAssets[0].format,
    });
    await expect(
      streamingClient.downloadJobAsset({
        jobId: claim.job!.id,
        asset: plan.uniqueAssets[0],
        targetFilePath: target,
        maxBytes: 256,
      }),
    ).rejects.toMatchObject({ code: "ASSET_TOO_LARGE" });
    expect(await fs.readdir(workspace.assetsDir)).toHaveLength(0);

    // 3. Server rejects >MAX_RENDER_IMAGE_BYTES and >MAX_RENDER_AUDIO_BYTES via Spaces ContentLength = 15MB+
    process.env.STORAGE_PROVIDER = "spaces";
    process.env.SPACES_KEY = TEST_SPACES_KEY;
    process.env.SPACES_SECRET = TEST_SPACES_SECRET;
    process.env.SPACES_BUCKET = TEST_SPACES_BUCKET;
    process.env.SPACES_REGION = TEST_SPACES_REGION;

    const oversizedAudioSnapshot = structuredClone(claim.job!.snapshot as RenderJobSnapshot);
    oversizedAudioSnapshot.scenes[0].image = {
      sourceUrl: "https://cdn.example.com/video-studio/p/big.jpg",
      provider: "spaces",
      resolvedPathOrKey: "video-studio/p/big.jpg",
    };
    oversizedAudioSnapshot.scenes[0].audio = {
      ...oversizedAudioSnapshot.scenes[0].audio,
      provider: "spaces",
      storageKey: "video-studio/p/big.mp3",
      resolvedKey: "video-studio/p/big.mp3",
    };
    oversizedAudioSnapshot.outputDestination.provider = "spaces";

    await prisma.videoRenderJob.update({
      where: { id: claim.job!.id },
      data: { snapshot: oversizedAudioSnapshot as never },
    });

    mockS3Store.set(`${TEST_SPACES_BUCKET}/video-studio/p/big.jpg`, {
      body: makeValidJpgBuffer("small_body"),
      contentType: "image/jpeg",
      contentLength: MAX_RENDER_IMAGE_BYTES + 1,
    });
    mockS3Store.set(`${TEST_SPACES_BUCKET}/video-studio/p/big.mp3`, {
      body: makeValidMp3Buffer("small_audio"),
      contentType: "audio/mpeg",
      contentLength: MAX_RENDER_AUDIO_BYTES + 1,
    });

    const spacesPlan = validateAndPlanSnapshotAssets(oversizedAudioSnapshot);
    const imgOverRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${claim.job!.id}/assets/${spacesPlan.uniqueAssets[0].assetId}`, {
        workerIdHeader: "worker-c323-size",
      }),
      { params: Promise.resolve({ jobId: claim.job!.id, assetId: spacesPlan.uniqueAssets[0].assetId }) },
    );
    expect(imgOverRes.status).toBe(413);
    expect((await imgOverRes.json()).code).toBe("ASSET_TOO_LARGE");

    const audOverRes = await assetRoute.GET(
      makeAssetGetRequest(`/api/internal/video-studio/render-jobs/${claim.job!.id}/assets/${spacesPlan.uniqueAssets[1].assetId}`, {
        workerIdHeader: "worker-c323-size",
      }),
      { params: Promise.resolve({ jobId: claim.job!.id, assetId: spacesPlan.uniqueAssets[1].assetId }) },
    );
    expect(audOverRes.status).toBe(413);
    expect((await audOverRes.json()).code).toBe("ASSET_TOO_LARGE");

    await workspace.cleanup();
  });

  it("12. Handles download timeouts (header & mid-stream stall) and truncated downloads while cleaning up partial files", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Timeout & Truncation");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const plan = validateAndPlanSnapshotAssets(jobRes.data.snapshot);
    const imgAsset = plan.uniqueAssets[0];
    const { logger } = createCapturingLogger();
    const tempBase = await createIsolatedTempBase();
    const workspace = await createJobTempWorkspace({ jobId: jobRes.data.id, baseTempDir: tempBase });

    // 1. Slow header timeout
    const slowHeaderClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-timeout",
      requestTimeoutMs: 40,
      leaseDurationSec: 300,
      logger,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });

    await expect(
      slowHeaderClient.downloadJobAsset({
        jobId: jobRes.data.id,
        asset: imgAsset,
        targetFilePath: workspace.allocateSafeAssetPath({ index: 0, assetId: imgAsset.assetId, format: imgAsset.format }),
        // Downloads default to a much longer timeout than API calls; use a short explicit one here.
        timeoutMs: 40,
      }),
    ).rejects.toBeInstanceOf(WorkerApiTimeoutError);

    // 2. Mid-stream stall timeout after receiving partial bytes
    const stallStreamClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-timeout",
      requestTimeoutMs: 60,
      leaseDurationSec: 300,
      logger,
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(makeValidJpgBuffer("partial_chunk").subarray(0, 12));
              // Never closes or sends remaining chunks
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "image/jpeg", "Content-Length": "500" },
          },
        ),
    });

    await expect(
      stallStreamClient.downloadJobAsset({
        jobId: jobRes.data.id,
        asset: imgAsset,
        targetFilePath: workspace.allocateSafeAssetPath({ index: 1, assetId: imgAsset.assetId, format: imgAsset.format }),
        timeoutMs: 60,
      }),
    ).rejects.toBeInstanceOf(WorkerApiTimeoutError);

    // 3. Interrupted stream closed early (received < Content-Length)
    const truncatedClient = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-timeout",
      requestTimeoutMs: 1000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: async () =>
        new Response(new Uint8Array(makeValidJpgBuffer("short")), {
          status: 200,
          headers: { "Content-Type": "image/jpeg", "Content-Length": "99999" },
        }),
    });

    await expect(
      truncatedClient.downloadJobAsset({
        jobId: jobRes.data.id,
        asset: imgAsset,
        targetFilePath: workspace.allocateSafeAssetPath({ index: 2, assetId: imgAsset.assetId, format: imgAsset.format }),
      }),
    ).rejects.toMatchObject({ code: "INCOMPLETE_DOWNLOAD" });

    // No .part or final files remain inside workspace.assetsDir
    expect(await fs.readdir(workspace.assetsDir)).toHaveLength(0);
    await workspace.cleanup();
  });

  it("13. Coalesces duplicate concurrent download requests and removes temporary workspace on mid-job failure", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Coalesce & Cleanup");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    let getCount = 0;
    const { logger } = createCapturingLogger();
    const baseFetch = createInProcessWorkerFetch({
      onAssetGet: () => {
        getCount++;
      },
    });
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-coalesce",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: async (url, init) => {
        if (String(url).includes("/assets/")) {
          await new Promise((r) => setTimeout(r, 25));
        }
        return baseFetch(url, init);
      },
    });

    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const plan = validateAndPlanSnapshotAssets(claim.job!.snapshot);
    const tempBase = await createIsolatedTempBase();
    const workspace = await createJobTempWorkspace({ jobId: claim.job!.id, baseTempDir: tempBase });
    const downloader = createJobAssetDownloader({
      jobId: claim.job!.id,
      workspace,
      transport: client,
    });

    // Trigger 3 concurrent requests for the exact same assetId
    const [r1, r2, r3] = await Promise.all([
      downloader.downloadOnce(plan.uniqueAssets[0], 0),
      downloader.downloadOnce(plan.uniqueAssets[0], 0),
      downloader.downloadOnce(plan.uniqueAssets[0], 0),
    ]);
    expect(getCount).toBe(1);
    expect(r1.filePath).toBe(r2.filePath);
    expect(r2.filePath).toBe(r3.filePath);
    await workspace.cleanup();

    // Now delete only the audio file so Scene 1's image succeeds and Scene 1's audio 404s during staging
    const audioFilename = setup.audioKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);
    await fs.unlink(path.join(process.cwd(), "storage", "video-studio", audioFilename));

    await expect(
      stageJobAssetsToTempWorkspace({
        job: claim.job!,
        transport: client,
        logger,
        tempDir: tempBase,
      }),
    ).rejects.toBeInstanceOf(WorkerApiHttpError);

    // Verify image file created earlier in the workspace was also cleaned up on failure
    expect(await fs.readdir(tempBase)).toHaveLength(0);
  });

  it("14. Preserves private storage isolation (no public audio access) and keeps admin audio authorization intact", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 No Public Audio");
    const audioFilename = setup.audioKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length);

    // Private audio MUST live in storage/video-studio/, never in public/uploads/video-studio/
    await expect(
      fs.access(path.join(process.cwd(), "storage", "video-studio", audioFilename)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(process.cwd(), "public", "uploads", "video-studio", audioFilename)),
    ).rejects.toThrow();

    // Admin audio route remains restricted to ADMIN users only
    const req = new NextRequest(
      `http://localhost:3000/api/admin/video-studio/audio?projectId=${setup.projectId}&sceneId=${setup.sceneId}`,
    );

    mockActor = null;
    const unauth = await audioAdminRouteGet(req);
    expect(unauth.status).toBe(401);

    mockActor = CUSTOMER_USER;
    const cust = await audioAdminRouteGet(req);
    expect(cust.status).toBe(403);

    mockActor = ADMIN_USER;
    const admin = await audioAdminRouteGet(req);
    expect(admin.status).toBe(200);
    expect((await admin.arrayBuffer()).byteLength).toBe(setup.mp3Bytes.length);
  });

  it("15. Validates snapshot assets before downloading and keeps RENDER_WORKER_PROCESSING_ENABLED default false", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Pre-Download Validation");
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    // Missing required image fails pre-download check with MISSING_REQUIRED_ASSET
    const missingImgSnap = structuredClone(jobRes.data.snapshot) as Record<string, unknown>;
    const scenesImg = missingImgSnap.scenes as Array<Record<string, unknown>>;
    delete scenesImg[0].image;
    expect(() => validateAndPlanSnapshotAssets(missingImgSnap)).toThrowError(WorkerAssetValidationError);
    try {
      validateAndPlanSnapshotAssets(missingImgSnap);
    } catch (err) {
      expect((err as WorkerAssetValidationError).code).toBe("MISSING_REQUIRED_ASSET");
    }

    // Missing required audio fails pre-download check with MISSING_REQUIRED_ASSET
    const missingAudSnap = structuredClone(jobRes.data.snapshot) as Record<string, unknown>;
    const scenesAud = missingAudSnap.scenes as Array<Record<string, unknown>>;
    delete scenesAud[0].audio;
    try {
      validateAndPlanSnapshotAssets(missingAudSnap);
    } catch (err) {
      expect((err as WorkerAssetValidationError).code).toBe("MISSING_REQUIRED_ASSET");
    }

    // Cross-provider mixing inside snapshot is rejected before downloading
    const mixedProviderSnap = structuredClone(jobRes.data.snapshot);
    mixedProviderSnap.outputDestination.provider = "spaces";
    try {
      validateAndPlanSnapshotAssets(mixedProviderSnap);
      throw new Error("Expected PROVIDER_MISMATCH");
    } catch (err) {
      expect((err as WorkerAssetValidationError).code).toBe("PROVIDER_MISMATCH");
    }

    // Default worker configuration keeps RENDER_WORKER_PROCESSING_ENABLED false and reads RENDER_WORKER_TEMP_DIR
    const customTemp = path.join(os.tmpdir(), "rebx-custom-worker-temp");
    const cfg = loadWorkerConfig({
      RENDER_API_BASE_URL: "http://localhost:3000",
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_ID: "worker-c323-cfg",
      RENDER_WORKER_TEMP_DIR: customTemp,
    });
    expect(cfg.processingEnabled).toBe(false);
    expect(cfg.tempDir).toBe(customTemp);
  });

  it("16. Stores local scene images privately outside public/, enforces ADMIN preview auth, and preserves Spaces uploads", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Private Image Storage");
    expect(setup.imageUrl.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)).toBe(true);
    expect(setup.imageUrl.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)).toBe(false);

    const imageFilename = setup.imageUrl.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length);
    const privateImagePath = path.join(process.cwd(), "storage", "video-studio", "images", imageFilename);
    const publicLegacyPath = path.join(process.cwd(), "public", "uploads", "video-studio", imageFilename);

    await expect(fs.access(privateImagePath)).resolves.toBeUndefined();
    await expect(fs.access(publicLegacyPath)).rejects.toThrow();

    // Unauthenticated preview request -> 401
    mockActor = null;
    const unauthRes = await imageAdminRouteGet(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/image/${imageFilename}`),
      { params: Promise.resolve({ filename: imageFilename }) },
    );
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers.get("Cache-Control")).toBe("private, no-store");

    // Non-ADMIN preview request -> 403
    mockActor = CUSTOMER_USER;
    const custRes = await imageAdminRouteGet(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/image/${imageFilename}`),
      { params: Promise.resolve({ filename: imageFilename }) },
    );
    expect(custRes.status).toBe(403);

    // Invalid filename / traversal / non-image extension -> 400
    mockActor = ADMIN_USER;
    for (const badName of ["../secret.jpg", "..\\secret.jpg", "not-image.svg", "sub/dir.jpg"]) {
      const badRes = await imageAdminRouteGet(
        new NextRequest("http://localhost:3000/api/admin/video-studio/image/invalid"),
        { params: Promise.resolve({ filename: badName }) },
      );
      expect(badRes.status).toBe(400);
    }

    // Valid ADMIN preview request -> 200 with no-store security headers & exact image bytes
    const adminRes = await imageAdminRouteGet(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/image/${imageFilename}`),
      { params: Promise.resolve({ filename: imageFilename }) },
    );
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get("Content-Type")).toBe("image/jpeg");
    expect(adminRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(adminRes.headers.get("Pragma")).toBe("no-cache");
    expect(adminRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await adminRes.arrayBuffer()).equals(setup.jpgBytes)).toBe(true);

    // Zero silent fallback: previewing a local private image while STORAGE_PROVIDER="spaces" returns 404
    process.env.STORAGE_PROVIDER = "spaces";
    process.env.SPACES_KEY = TEST_SPACES_KEY;
    process.env.SPACES_SECRET = TEST_SPACES_SECRET;
    process.env.SPACES_BUCKET = TEST_SPACES_BUCKET;
    process.env.SPACES_REGION = TEST_SPACES_REGION;
    const spacesActiveRes = await imageAdminRouteGet(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/image/${imageFilename}`),
      { params: Promise.resolve({ filename: imageFilename }) },
    );
    expect(spacesActiveRes.status).toBe(404);

    // Restore local mode and verify worker still downloads both private image and private audio cleanly
    process.env.STORAGE_PROVIDER = "local";
    const jobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobRes.ok).toBe(true);
    if (!jobRes.ok) throw new Error(jobRes.error);

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-private-img",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);

    const tempBase = await createIsolatedTempBase();
    const staged = await stageJobAssetsToTempWorkspace({
      job: claim.job!,
      transport: client,
      logger,
      tempDir: tempBase,
    });
    expect(Buffer.from(await fs.readFile(staged.scenes[0].imageFilePath)).equals(setup.jpgBytes)).toBe(true);
    expect(Buffer.from(await fs.readFile(staged.scenes[0].audioFilePath)).equals(setup.mp3Bytes)).toBe(true);
    await staged.cleanup();

    // DigitalOcean Spaces image uploads keep existing Spaces URL + public-read ACL behavior unchanged
    process.env.STORAGE_PROVIDER = "spaces";
    process.env.SPACES_KEY = TEST_SPACES_KEY;
    process.env.SPACES_SECRET = TEST_SPACES_SECRET;
    process.env.SPACES_BUCKET = TEST_SPACES_BUCKET;
    process.env.SPACES_REGION = TEST_SPACES_REGION;
    const spacesImgFd = new FormData();
    spacesImgFd.set("projectId", setup.projectId);
    spacesImgFd.set("sceneId", setup.sceneId);
    spacesImgFd.set("file", new File([new Uint8Array(setup.jpgBytes)], "spaces_check.jpg", { type: "image/jpeg" }));
    const spacesUploadRes = await uploadSceneImageAction(spacesImgFd);
    expect(spacesUploadRes.ok).toBe(true);
    if (!spacesUploadRes.ok) throw new Error(spacesUploadRes.error);
    expect(spacesUploadRes.data.imageUrl.startsWith("https://")).toBe(true);
    const putImgCalls = mockS3Send.mock.calls.filter(
      (c) =>
        (c[0] as { constructor?: { name?: string }; input?: { ACL?: string; ContentType?: string } })?.constructor?.name ===
          "MockPutObjectCommand" &&
        (c[0] as { input?: { ContentType?: string } })?.input?.ContentType === "image/jpeg",
    );
    expect(putImgCalls.length).toBe(1);
    expect((putImgCalls[0][0] as { input?: { ACL?: string } })?.input?.ACL).toBe("public-read");
  });

  it("17. Safely verifies copy before migrating legacy image refs, aborts deletion on checksum failure, and keeps existing render snapshots valid", async () => {
    const setup = await createSimpleLocalRenderReadyProject("C323 Verified Legacy Migration");
    const imageFilename = setup.imageUrl.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length);
    const privateImagesDir = getPrivateVideoStudioImagesDir(path);
    const privateImagePath = path.join(privateImagesDir, imageFilename);
    const legacyUrl = `${LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX}${imageFilename}`;

    // Create a render job first, then backdate scene, version, and job snapshot to legacy `/uploads/video-studio/` form
    const initialJobRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(initialJobRes.ok).toBe(true);
    if (!initialJobRes.ok) throw new Error(initialJobRes.error);

    const legacySnapshot = structuredClone(initialJobRes.data.snapshot) as RenderJobSnapshot;
    legacySnapshot.scenes[0].image = {
      sourceUrl: legacyUrl,
      provider: "local",
      resolvedPathOrKey: `${LOCAL_PRIVATE_IMAGE_PREFIX}${imageFilename}`,
    };
    const legacySnapshotHash = hashRenderSnapshot(legacySnapshot);

    await prisma.videoRenderJob.update({
      where: { id: initialJobRes.data.id },
      data: {
        snapshot: legacySnapshot as never,
        snapshotHash: legacySnapshotHash,
      },
    });
    await prisma.videoScene.update({
      where: { id: setup.sceneId },
      data: { imageUrl: legacyUrl, imagePath: legacyUrl },
    });
    await prisma.videoVersion.updateMany({
      where: { projectId: setup.projectId },
      data: {
        snapshot: {
          projectId: setup.projectId,
          scenes: [{ id: setup.sceneId, order: 1, imageUrl: legacyUrl }],
        } as never,
      },
    });

    // Move uploaded image into an isolated legacy directory containing `.gitkeep`
    const tempLegacyDir = await createIsolatedTempBase();
    const legacyFilePath = path.join(tempLegacyDir, imageFilename);
    await fs.writeFile(path.join(tempLegacyDir, ".gitkeep"), "", "utf8");
    await fs.rename(privateImagePath, legacyFilePath);

    // 1. Simulated verification mismatch MUST abort without deleting original or updating DB references
    await expect(
      migrateLegacyPublicSceneImages({
        legacyDir: tempLegacyDir,
        targetDir: privateImagesDir,
        verifyHook: async ({ targetPath }) => {
          await fs.writeFile(targetPath, Buffer.from("corrupted-copy-bytes", "utf8"));
        },
      }),
    ).rejects.toThrow(/Verification failed/);

    await expect(fs.access(legacyFilePath)).resolves.toBeUndefined();
    await expect(fs.access(privateImagePath)).rejects.toThrow();
    const sceneAfterAbort = await prisma.videoScene.findUnique({ where: { id: setup.sceneId } });
    expect(sceneAfterAbort?.imageUrl).toBe(legacyUrl);
    const versionAfterAbort = await prisma.videoVersion.findFirst({ where: { projectId: setup.projectId } });
    expect((versionAfterAbort?.snapshot as { scenes?: Array<{ imageUrl?: string }> })?.scenes?.[0]?.imageUrl).toBe(
      legacyUrl,
    );

    // 2. Clean migration copies with SHA-256 verification, updates VideoScene & VideoVersion, preserves VideoRenderJob & .gitkeep
    const expectedSha = createHash("sha256").update(setup.jpgBytes).digest("hex");
    const migResult = await migrateLegacyPublicSceneImages({
      legacyDir: tempLegacyDir,
      targetDir: privateImagesDir,
    });

    expect(migResult.scannedFiles).toBe(1);
    expect(migResult.migratedFiles).toHaveLength(1);
    expect(migResult.migratedFiles[0]).toEqual({
      filename: imageFilename,
      sizeBytes: setup.jpgBytes.length,
      sha256: expectedSha,
      alreadyPresent: false,
      originalRemoved: true,
    });
    expect(migResult.updatedSceneCount).toBeGreaterThanOrEqual(1);
    expect(migResult.updatedVersionCount).toBeGreaterThanOrEqual(1);
    expect(migResult.preservedRenderJobCount).toBeGreaterThanOrEqual(1);

    // Legacy file removed, `.gitkeep` preserved, private target file verified
    expect(await fs.readdir(tempLegacyDir)).toEqual([".gitkeep"]);
    expect((await fs.readFile(privateImagePath)).equals(setup.jpgBytes)).toBe(true);

    // DB rows updated for scenes & versions while render job snapshotHash stayed immutable
    const sceneAfterMig = await prisma.videoScene.findUnique({ where: { id: setup.sceneId } });
    expect(sceneAfterMig?.imageUrl).toBe(setup.imageUrl);
    expect(sceneAfterMig?.imagePath).toBe(setup.imageUrl);

    const versionAfterMig = await prisma.videoVersion.findFirst({ where: { projectId: setup.projectId } });
    expect((versionAfterMig?.snapshot as { scenes?: Array<{ imageUrl?: string }> })?.scenes?.[0]?.imageUrl).toBe(
      setup.imageUrl,
    );

    const preservedJob = await prisma.videoRenderJob.findUnique({ where: { id: initialJobRes.data.id } });
    expect(preservedJob?.snapshotHash).toBe(legacySnapshotHash);
    expect((preservedJob?.snapshot as unknown as RenderJobSnapshot).scenes[0].image.sourceUrl).toBe(legacyUrl);

    // 3. Pre-existing legacy render job snapshot STILL streams cleanly via worker endpoint, and admin preview works
    mockActor = ADMIN_USER;
    const previewAfterMig = await imageAdminRouteGet(
      new NextRequest(`http://localhost:3000/api/admin/video-studio/image/${imageFilename}`),
      { params: Promise.resolve({ filename: imageFilename }) },
    );
    expect(previewAfterMig.status).toBe(200);
    expect(Buffer.from(await previewAfterMig.arrayBuffer()).equals(setup.jpgBytes)).toBe(true);

    const { logger } = createCapturingLogger();
    const client = new RenderWorkerApiClient({
      apiBaseUrl: "http://localhost:3000",
      workerSecret: WORKER_SECRET,
      workerId: "worker-c323-migrated-legacy",
      requestTimeoutMs: 5000,
      leaseDurationSec: 300,
      logger,
      fetchImpl: createInProcessWorkerFetch(),
    });
    const claim = await client.claimNextJob();
    expect(claim.claimed).toBe(true);
    expect(claim.job?.id).toBe(initialJobRes.data.id);

    const stagedTempBase = await createIsolatedTempBase();
    const staged = await stageJobAssetsToTempWorkspace({
      job: claim.job!,
      transport: client,
      logger,
      tempDir: stagedTempBase,
    });
    expect(Buffer.from(await fs.readFile(staged.scenes[0].imageFilePath)).equals(setup.jpgBytes)).toBe(true);
    expect(Buffer.from(await fs.readFile(staged.scenes[0].audioFilePath)).equals(setup.mp3Bytes)).toBe(true);
    await staged.cleanup();
  });
});
