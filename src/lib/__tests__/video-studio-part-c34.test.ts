import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Readable, Transform } from "node:stream";
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
import ProjectDashboardClient from "@/app/admin/dashboard/video-studio/ProjectDashboardClient";
import {
  cancelRenderJobAction,
  createProjectAction,
  createRenderJobAction,
  deleteProjectAction,
  getRenderJobAction,
  retryRenderJobAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
  validateProjectRenderReadinessAction,
} from "@/lib/actions/video-studio";
import {
  getProjectRenderJobs,
  getProjectsDashboard,
  getProjectVersions,
  getProjectWithScenes,
} from "@/lib/data/video-studio";
import { LOCAL_PRIVATE_ASSET_PREFIX } from "@/lib/video-studio/deps";
import { transitionRenderJobInternal } from "@/lib/video-studio/render-jobs";
import { canCancelRenderJob, canRetryRenderJob } from "@/lib/video-studio/render-validation";

import * as claimRoute from "@/app/api/internal/video-studio/render-jobs/claim/route";
import * as progressRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/progress/route";
import * as heartbeatRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/heartbeat/route";
import * as failRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/fail/route";
import * as outputRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/output/route";
import * as completeRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/complete/route";
import * as assetRoute from "@/app/api/internal/video-studio/render-jobs/[jobId]/assets/[assetId]/route";
import * as adminVideoRoute from "@/app/api/admin/video-studio/render-jobs/[jobId]/video/route";

import { RenderWorkerApiClient } from "../../../worker/video-renderer/src/client";
import { loadWorkerConfig } from "../../../worker/video-renderer/src/config";
import {
  checkFfmpegEnvironment,
  verifyRenderedMp4Output,
  type FfmpegEnvironmentStatus,
} from "../../../worker/video-renderer/src/ffmpeg";
import { createWorkerLogger, type WorkerLogEntry } from "../../../worker/video-renderer/src/logger";
import { VideoRenderWorker } from "../../../worker/video-renderer/src/worker";

const ADMIN_SCENE_IMAGE_ROUTE_PREFIX = "/api/admin/video-studio/image/";
const LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX = "/uploads/video-studio/";

const ADMIN_USER = {
  id: 970340,
  role: "ADMIN" as const,
  email: "video-studio-admin-c34@example.com",
  name: "Studio Admin Part C34",
};

const CUSTOMER_USER = {
  id: 970341,
  role: "CUSTOMER" as const,
  email: "video-studio-customer-c34@example.com",
  name: "Studio Customer Part C34",
};

const WORKER_SECRET = "c34-isolated-e2e-worker-secret-token-887766";

const originalEnv = { ...process.env };
const createdProjectIds: string[] = [];
const localImageUrls: string[] = [];
const localAudioKeys: string[] = [];
const localOutputFiles: string[] = [];
const tempDirsToCleanup: string[] = [];
const spawnedWorkers: ChildProcess[] = [];
const liveServers: http.Server[] = [];

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

async function createIsolatedTempDir(label = "rebx-c34-test"): Promise<string> {
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

function createCapturingLogger(workerId = "worker-c34-test") {
  const entries: WorkerLogEntry[] = [];
  const lines: string[] = [];
  const logger = createWorkerLogger({
    workerId,
    secrets: [WORKER_SECRET],
    sink: (entry, line) => {
      entries.push(entry);
      lines.push(line);
    },
  });
  return { logger, entries, lines };
}

type LiveServerHooks = {
  onClaimResponse?: (jobId: string | null) => Promise<void> | void;
  onProgressRequest?: (jobId: string, body: { progress?: number; stage?: string }) => Promise<Response | void> | Response | void;
  onHeartbeatRequest?: (jobId: string) => Promise<Response | void> | Response | void;
  onFirstUploadChunk?: (jobId: string) => Promise<void> | void;
  onOutputRequest?: (jobId: string, headers: Headers) => Promise<Response | void> | Response | void;
  onCompleteRequest?: (jobId: string, body: unknown) => Promise<Response | void> | Response | void;
};

type LiveHttpBridge = {
  baseUrl: string;
  port: number;
  requests: { method: string; pathname: string; status: number }[];
  close: () => Promise<void>;
};

async function startLiveVideoStudioHttpServer(hooks?: LiveServerHooks): Promise<LiveHttpBridge> {
  const requests: { method: string; pathname: string; status: number }[] = [];

  async function dispatchNextRequest(
    incomingReq: http.IncomingMessage,
    fullUrl: URL,
    abortSignal: AbortSignal,
  ): Promise<Response> {
    const method = (incomingReq.method ?? "GET").toUpperCase();
    const headers = new Headers();
    for (const [k, v] of Object.entries(incomingReq.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, v);
      }
    }

    const isBodyMethod = method !== "GET" && method !== "HEAD";
    const pathname = fullUrl.pathname;

    // Special streaming handling for PUT /output (supports onFirstUploadChunk without buffering into RAM)
    const outputMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/output$/.exec(pathname);
    if (outputMatch && (method === "PUT" || method === "POST")) {
      const jid = decodeURIComponent(outputMatch[1]);
      const override = await hooks?.onOutputRequest?.(jid, headers);
      if (override) {
        incomingReq.resume();
        return override;
      }

      let sourceStream: Readable = incomingReq;
      if (hooks?.onFirstUploadChunk) {
        let fired = false;
        const hookFn = hooks.onFirstUploadChunk;
        const tap = new Transform({
          transform(chunk, _encoding, callback) {
            if (!fired) {
              fired = true;
              Promise.resolve(hookFn(jid))
                .then(() => callback(null, chunk))
                .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
              return;
            }
            callback(null, chunk);
          },
        });
        sourceStream = incomingReq.pipe(tap);
      }

      const webStream = Readable.toWeb(sourceStream) as unknown as BodyInit;
      const nextReq = new NextRequest(fullUrl.toString(), {
        method,
        headers,
        body: webStream,
        duplex: "half",
        signal: abortSignal,
      } as ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" });

      return outputRoute.PUT(nextReq, {
        params: Promise.resolve({ jobId: jid }),
      });
    }

    // Read JSON/text body cleanly for small control requests when applicable
    let bodyInit: BodyInit | undefined;
    let parsedJsonBody: unknown = undefined;
    if (isBodyMethod) {
      const chunks: Buffer[] = [];
      for await (const ch of incomingReq) {
        chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
      }
      const rawBuf = Buffer.concat(chunks);
      if (rawBuf.length > 0) {
        const text = rawBuf.toString("utf8");
        bodyInit = text;
        try {
          parsedJsonBody = JSON.parse(text);
        } catch {
          parsedJsonBody = undefined;
        }
      }
    }

    const nextReq = new NextRequest(fullUrl.toString(), {
      method,
      headers,
      body: isBodyMethod ? bodyInit : undefined,
      signal: abortSignal,
    });

    if (pathname === "/api/internal/video-studio/render-jobs/claim" && method === "POST") {
      const res = await claimRoute.POST(nextReq);
      if (hooks?.onClaimResponse && res.status === 200) {
        const cloned = res.clone();
        const data = (await cloned.json().catch(() => null)) as { job?: { id?: string } | null } | null;
        await hooks.onClaimResponse(data?.job?.id ?? null);
      }
      return res;
    }

    const progressMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/progress$/.exec(pathname);
    if (progressMatch && method === "POST") {
      const jid = decodeURIComponent(progressMatch[1]);
      if (hooks?.onProgressRequest) {
        const override = await hooks.onProgressRequest(
          jid,
          (parsedJsonBody as { progress?: number; stage?: string }) ?? {},
        );
        if (override) return override;
      }
      return progressRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: jid }),
      });
    }

    const heartbeatMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/heartbeat$/.exec(pathname);
    if (heartbeatMatch && method === "POST") {
      const jid = decodeURIComponent(heartbeatMatch[1]);
      if (hooks?.onHeartbeatRequest) {
        const override = await hooks.onHeartbeatRequest(jid);
        if (override) return override;
      }
      return heartbeatRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: jid }),
      });
    }

    const failMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/fail$/.exec(pathname);
    if (failMatch && method === "POST") {
      return failRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: decodeURIComponent(failMatch[1]) }),
      });
    }

    const completeMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/complete$/.exec(pathname);
    if (completeMatch && method === "POST") {
      const jid = decodeURIComponent(completeMatch[1]);
      if (hooks?.onCompleteRequest) {
        const override = await hooks.onCompleteRequest(jid, parsedJsonBody);
        if (override) return override;
      }
      return completeRoute.POST(nextReq, {
        params: Promise.resolve({ jobId: jid }),
      });
    }

    const assetMatch = /^\/api\/internal\/video-studio\/render-jobs\/([^/]+)\/assets\/([^/]+)$/.exec(pathname);
    if (assetMatch && method === "GET") {
      return assetRoute.GET(nextReq, {
        params: Promise.resolve({
          jobId: decodeURIComponent(assetMatch[1]),
          assetId: decodeURIComponent(assetMatch[2]),
        }),
      });
    }

    const adminVideoMatch = /^\/api\/admin\/video-studio\/render-jobs\/([^/]+)\/video$/.exec(pathname);
    if (adminVideoMatch && method === "GET") {
      return adminVideoRoute.GET(nextReq, {
        params: Promise.resolve({
          jobId: decodeURIComponent(adminVideoMatch[1]),
        }),
      });
    }

    return new Response(JSON.stringify({ ok: false, error: `Not found: ${method} ${pathname}` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const server = http.createServer((req, res) => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const fullUrl = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const abortController = new AbortController();

    req.on("aborted", () => abortController.abort());
    req.on("error", () => abortController.abort());
    res.on("close", () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    dispatchNextRequest(req, fullUrl, abortController.signal)
      .then(async (nextRes) => {
        requests.push({ method: (req.method ?? "GET").toUpperCase(), pathname: fullUrl.pathname, status: nextRes.status });
        res.statusCode = nextRes.status;
        nextRes.headers.forEach((value, key) => {
          if (key.toLowerCase() === "transfer-encoding") return;
          res.setHeader(key, value);
        });

        if (!nextRes.body) {
          res.end();
          return;
        }

        const nodeReadable = Readable.fromWeb(
          nextRes.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
        );
        nodeReadable.on("error", () => {
          if (!res.writableEnded) res.destroy();
        });
        nodeReadable.pipe(res);
      })
      .catch((err) => {
        if (abortController.signal.aborted) {
          if (!res.destroyed) res.destroy();
          return;
        }
        requests.push({ method: (req.method ?? "GET").toUpperCase(), pathname: fullUrl.pathname, status: 500 });
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : "Internal test bridge error",
            }),
          );
        } else if (!res.destroyed) {
          res.destroy();
        }
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  liveServers.push(server);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

type SpawnedWorkerHandle = {
  child: ChildProcess;
  stdoutLines: string[];
  stderrLines: string[];
  getCombinedLogs: () => string;
  stop: () => Promise<number | null>;
};

function spawnStandaloneWorkerProcess(envOverrides: Record<string, string>): SpawnedWorkerHandle {
  const tsxCliPath = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const workerEntryPath = path.resolve(process.cwd(), "worker/video-renderer/src/index.ts");

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let stdoutBuf = "";
  let stderrBuf = "";

  const cleanChildEnv = { ...process.env };
  delete cleanChildEnv.VITEST;
  delete cleanChildEnv.VITEST_MODE;
  delete cleanChildEnv.VITEST_POOL_ID;
  delete cleanChildEnv.VITEST_WORKER_ID;
  delete cleanChildEnv.NODE_OPTIONS;

  const child = spawn(process.execPath, [tsxCliPath, workerEntryPath], {
    cwd: process.cwd(),
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...cleanChildEnv,
      // Explicitly neutralize any local STORAGE_PROVIDER mismatch; worker only speaks HTTP.
      RENDER_POLL_INTERVAL_MS: "200",
      RENDER_HEARTBEAT_INTERVAL_MS: "500",
      RENDER_FFMPEG_TIMEOUT_MS: "45000",
      RENDER_REQUEST_TIMEOUT_MS: "15000",
      RENDER_LEASE_DURATION_SEC: "120",
      RENDER_WORKER_LOG_LEVEL: "info",
      ...envOverrides,
    },
  });

  child.on("error", (err) => {
    stderrLines.push(`CHILD_SPAWN_ERROR: ${err.message}`);
  });

  spawnedWorkers.push(child);

  child.stdout?.on("data", (chunk: Buffer | string) => {
    stdoutBuf += chunk.toString();
    const parts = stdoutBuf.split(/\r?\n/);
    stdoutBuf = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) stdoutLines.push(line.trim());
    }
  });

  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderrBuf += chunk.toString();
    const parts = stderrBuf.split(/\r?\n/);
    stderrBuf = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) stderrLines.push(line.trim());
    }
  });

  child.once("exit", () => {
    if (stdoutBuf.trim()) stdoutLines.push(stdoutBuf.trim());
    if (stderrBuf.trim()) stderrLines.push(stderrBuf.trim());
    stdoutBuf = "";
    stderrBuf = "";
  });

  const stop = async (): Promise<number | null> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return child.exitCode;
    }

    const exitPromise = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });

    try {
      child.kill("SIGTERM");
    } catch {
      // ignore if already exited
    }

    const firstWait = await Promise.race([
      exitPromise,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000)),
    ]);

    if (firstWait === "timeout" && child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      return exitPromise;
    }
    return firstWait === "timeout" ? child.exitCode : firstWait;
  };

  return {
    child,
    stdoutLines,
    stderrLines,
    getCombinedLogs: () => [...stdoutLines, ...stderrLines].join("\n"),
    stop,
  };
}

async function waitForCondition<T>(
  fn: () => Promise<T | null | false | undefined>,
  timeoutMs = 30_000,
  pollMs = 150,
  label = "condition",
  debugContext?: () => string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await fn();
    if (val) return val;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  const extra = debugContext ? ` | debug=${debugContext()}` : "";
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.${extra}`);
}

async function createMultiSceneProjectForRatio(params: {
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
  scenes?: Array<{
    title: string;
    narration: string;
    durationSec: number;
    imgExt: "jpg" | "png" | "webp";
    imgWidth: number;
    imgHeight: number;
    color: string;
    audioFormat: "wav" | "mp3";
    audioDurationSec: number;
  }>;
}): Promise<{ projectId: string; sceneIds: string[]; imageUrls: string[]; audioKeys: string[] }> {
  const sceneSpecs = params.scenes ?? [
    {
      title: "Exterior Arrival",
      narration: "Welcome to Kokapet. Explore spacious sky villas with private decks.",
      durationSec: 2,
      imgExt: "jpg" as const,
      imgWidth: 640,
      imgHeight: 360,
      color: "0x1E3A5F",
      audioFormat: "wav" as const,
      audioDurationSec: 1.5,
    },
    {
      title: "Clubhouse Lounge",
      narration: "Enjoy rooftop infinity pools and landscaped courtyards in Hyderabad.",
      durationSec: 2,
      imgExt: "png" as const,
      imgWidth: 480,
      imgHeight: 640,
      color: "0x2E5A44",
      audioFormat: "mp3" as const,
      audioDurationSec: 1.5,
    },
  ];

  const totalDur = sceneSpecs.reduce((sum, s) => sum + s.durationSec, 0);
  const created = await createProjectAction({
    title: params.title,
    topic: "Kokapet Luxury Residences",
    category: "property_showcase",
    sourceType: "CUSTOM_SCRIPT",
    language: "English",
    tone: "Luxury",
    duration: Math.max(10, totalDur),
    aspectRatio: params.aspectRatio,
    scenes: sceneSpecs.map((s, idx) => ({
      id: `draft_${idx + 1}`,
      order: idx + 1,
      title: s.title,
      narration: s.narration,
      imagePrompt: `Architectural visual for ${s.title}`,
      imageUrl: null,
      duration: s.durationSec,
      locked: false,
    })),
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.error);

  const projectId = created.data.id;
  createdProjectIds.push(projectId);

  const dbScenes = await prisma.videoScene.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  expect(dbScenes).toHaveLength(sceneSpecs.length);

  const fixtureDir = await createIsolatedTempDir("rebx-c34-fixtures");
  const imageUrls: string[] = [];
  const audioKeys: string[] = [];

  for (let i = 0; i < sceneSpecs.length; i++) {
    const spec = sceneSpecs[i];
    const scene = dbScenes[i];

    const imgPath = path.join(fixtureDir, `scene_${i + 1}.${spec.imgExt}`);
    const imgBuf = await synthesizeTestImageFile({
      outPath: imgPath,
      width: spec.imgWidth,
      height: spec.imgHeight,
      color: spec.color,
    });
    const mimeImg =
      spec.imgExt === "png" ? "image/png" : spec.imgExt === "webp" ? "image/webp" : "image/jpeg";
    const imgFd = new FormData();
    imgFd.set("projectId", projectId);
    imgFd.set("sceneId", scene.id);
    imgFd.set("file", new File([new Uint8Array(imgBuf)], `scene_${i + 1}.${spec.imgExt}`, { type: mimeImg }));
    const imgUp = await uploadSceneImageAction(imgFd);
    expect(imgUp.ok).toBe(true);
    if (!imgUp.ok) throw new Error(imgUp.error);
    localImageUrls.push(imgUp.data.imageUrl);
    imageUrls.push(imgUp.data.imageUrl);

    const audPath = path.join(fixtureDir, `voice_${i + 1}.${spec.audioFormat}`);
    const audBuf = await synthesizeTestAudioFile({
      outPath: audPath,
      durationSec: spec.audioDurationSec,
      frequencyHz: 420 + i * 90,
      format: spec.audioFormat,
    });
    const mimeAud = spec.audioFormat === "wav" ? "audio/wav" : "audio/mpeg";
    const audFd = new FormData();
    audFd.set("projectId", projectId);
    audFd.set("sceneId", scene.id);
    audFd.set("language", "en-IN");
    audFd.set("file", new File([new Uint8Array(audBuf)], `voice_${i + 1}.${spec.audioFormat}`, { type: mimeAud }));
    const audUp = await uploadSceneAudioAction(audFd);
    expect(audUp.ok).toBe(true);
    if (!audUp.ok) throw new Error(audUp.error);
    localAudioKeys.push(audUp.data.audio.storageKey);
    audioKeys.push(audUp.data.audio.storageKey);
  }

  return {
    projectId,
    sceneIds: dbScenes.map((s) => s.id),
    imageUrls,
    audioKeys,
  };
}

function resolveLocalImageFilePath(imageUrl: string): string {
  const filename = imageUrl.startsWith(ADMIN_SCENE_IMAGE_ROUTE_PREFIX)
    ? imageUrl.slice(ADMIN_SCENE_IMAGE_ROUTE_PREFIX.length)
    : imageUrl.startsWith(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX)
      ? imageUrl.slice(LEGACY_PUBLIC_IMAGE_ROUTE_PREFIX.length)
      : imageUrl;
  return path.join(process.cwd(), "storage", "video-studio", "images", filename);
}

function resolveLocalAudioFilePath(storageKey: string): string {
  const filename = storageKey.startsWith(LOCAL_PRIVATE_ASSET_PREFIX)
    ? storageKey.slice(LOCAL_PRIVATE_ASSET_PREFIX.length)
    : storageKey;
  return path.join(process.cwd(), "storage", "video-studio", filename);
}

function resolveLocalRenderMp4Path(projectId: string, jobId: string): string {
  return path.join(process.cwd(), "storage", "video-studio", projectId, "renders", `render_${jobId}.mp4`);
}

describe("REBX AI Video Studio - Part C3.4: End-to-End Integration & Reliability Verification", () => {
  beforeAll(async () => {
    ffmpegEnv = await checkFfmpegEnvironment({ secrets: [WORKER_SECRET] });
    if (!ffmpegEnv.readyForPartC32Rendering || !ffmpegEnv.ffmpeg.executablePath || !ffmpegEnv.ffprobe.executablePath) {
      throw new Error("Local FFmpeg 9.0.1 and FFprobe 9.0.1 must be installed for Part C3.4 E2E tests.");
    }
    expect(ffmpegEnv.ffmpeg.version).toMatch(/^9\.0\.1\b/);
    expect(ffmpegEnv.ffprobe.version).toMatch(/^9\.0\.1\b/);

    ffmpegBin = ffmpegEnv.ffmpeg.executablePath;
    ffprobeBin = ffmpegEnv.ffprobe.executablePath;

    await prisma.user.upsert({
      where: { id: ADMIN_USER.id },
      update: { email: ADMIN_USER.email, name: ADMIN_USER.name, role: "ADMIN" },
      create: {
        id: ADMIN_USER.id,
        email: ADMIN_USER.email,
        name: ADMIN_USER.name,
        passwordHash: "$2b$10$testplaceholderhashdonotuse000000000000000000000000",
        role: "ADMIN",
      },
    });
    await prisma.user.upsert({
      where: { id: CUSTOMER_USER.id },
      update: { email: CUSTOMER_USER.email, name: CUSTOMER_USER.name, role: "CUSTOMER" },
      create: {
        id: CUSTOMER_USER.id,
        email: CUSTOMER_USER.email,
        name: CUSTOMER_USER.name,
        passwordHash: "$2b$10$testplaceholderhashdonotuse000000000000000000000000",
        role: "CUSTOMER",
      },
    });
    // Clean up any leftover projects created by an earlier crashed C34 run
    await prisma.videoProject.deleteMany({ where: { createdById: ADMIN_USER.id } });
  });

  beforeEach(() => {
    mockActor = { ...ADMIN_USER };
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.STORAGE_PROVIDER;
    process.env.RENDER_WORKER_ENABLED = "true";
    process.env.RENDER_WORKER_SECRET = WORKER_SECRET;
  });

  afterEach(async () => {
    // Always terminate any spawned child worker processes first
    while (spawnedWorkers.length > 0) {
      const child = spawnedWorkers.pop()!;
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Close any live test HTTP servers
    while (liveServers.length > 0) {
      const srv = liveServers.pop()!;
      await new Promise<void>((resolve) => {
        srv.closeAllConnections?.();
        srv.close(() => resolve());
      });
    }

    // Clean up C34 test projects created in the current test so subsequent tests have an isolated queue
    while (createdProjectIds.length > 0) {
      const pid = createdProjectIds.pop()!;
      await prisma.videoProject.deleteMany({ where: { id: pid } }).catch(() => {});
      await fs
        .rm(path.join(process.cwd(), "storage", "video-studio", pid), { recursive: true, force: true })
        .catch(() => {});
    }

    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const pid of createdProjectIds) {
      await prisma.videoProject.deleteMany({ where: { id: pid } }).catch(() => {});
      await fs
        .rm(path.join(process.cwd(), "storage", "video-studio", pid), { recursive: true, force: true })
        .catch(() => {});
    }
    for (const mp4Path of localOutputFiles) {
      await fs.unlink(mp4Path).catch(() => {});
    }
    for (const url of localImageUrls) {
      await fs.unlink(resolveLocalImageFilePath(url)).catch(() => {});
    }
    for (const key of localAudioKeys) {
      await fs.unlink(resolveLocalAudioFilePath(key)).catch(() => {});
    }
    for (const dir of tempDirsToCleanup) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: [ADMIN_USER.id, CUSTOMER_USER.id] } } }).catch(() => {});
  });

  it("1. Real standalone worker process completes live HTTP E2E flow across 16:9, 9:16, and 1:1 with preview Range streaming and FFprobe-verified downloads", async () => {
    // Safety verification: worker defaults to processingEnabled === false unless explicitly enabled
    const defaultCfg = loadWorkerConfig({
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_API_BASE_URL: "http://127.0.0.1:3000",
      RENDER_WORKER_ID: "c34-default-check",
    });
    expect(defaultCfg.processingEnabled).toBe(false);

    const server = await startLiveVideoStudioHttpServer();
    const idleTempDir = await createIsolatedTempDir("rebx-c34-idle-proc");

    // Step A: Verify real standalone worker process remains strictly idle when RENDER_WORKER_PROCESSING_ENABLED="false"
    const setupIdle = await createMultiSceneProjectForRatio({
      title: "C34 Live 16:9 Multi-Scene E2E",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Arrival Drive",
          narration: "Presenting modern residences in Kokapet, Hyderabad.",
          durationSec: 2,
          imgExt: "jpg",
          imgWidth: 640,
          imgHeight: 360,
          color: "0x1D3557",
          audioFormat: "wav",
          audioDurationSec: 1.4,
        },
        {
          title: "Garden Terrace",
          narration: "Lush landscaping surrounds every tower with sunlit views.",
          durationSec: 2,
          imgExt: "webp",
          imgWidth: 512,
          imgHeight: 512,
          color: "0x2A6F4E",
          audioFormat: "mp3",
          audioDurationSec: 1.5,
        },
      ],
    });
    const job169Res = await createRenderJobAction({ projectId: setupIdle.projectId });
    expect(job169Res.ok).toBe(true);
    if (!job169Res.ok) throw new Error(job169Res.error);

    const idleWorker = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-idle-process",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "false",
      RENDER_WORKER_TEMP_DIR: idleTempDir,
    });
    await waitForCondition(
      async () => idleWorker.getCombinedLogs().includes("RENDER_WORKER_PROCESSING_ENABLED=false"),
      15_000,
      100,
      "idle worker startup log",
      () => `exitCode=${idleWorker.child.exitCode} logs=${idleWorker.getCombinedLogs()}`,
    );
    await new Promise((r) => setTimeout(r, 350));
    await idleWorker.stop();

    const untouchedJob = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job169Res.data.id } });
    expect(untouchedJob.status).toBe("PENDING");
    expect(untouchedJob.progress).toBe(0);
    expect(untouchedJob.workerId).toBeNull();
    expect(idleWorker.getCombinedLogs()).not.toContain(WORKER_SECRET);

    // Step B: Start real standalone worker OS process with RENDER_WORKER_PROCESSING_ENABLED="true" (scoped strictly to this child process)
    const workerTempDir = await createIsolatedTempDir("rebx-c34-e2e-worker");
    const activeWorker = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-live-e2e",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: workerTempDir,
    });

    // Enqueue remaining 9:16 and 1:1 jobs after 16:9 finishes or consecutively so order is deterministic
    const ratiosToVerify: Array<{
      ratio: "16:9" | "9:16" | "1:1";
      expectedWidth: number;
      expectedHeight: number;
      expectedDurationSec: number;
      existingJobId?: string;
      projectId: string;
    }> = [
      {
        ratio: "16:9",
        expectedWidth: 1920,
        expectedHeight: 1080,
        expectedDurationSec: 4,
        existingJobId: job169Res.data.id,
        projectId: setupIdle.projectId,
      },
    ];

    const setup916 = await createMultiSceneProjectForRatio({
      title: "C34 Live 9:16 Vertical E2E",
      aspectRatio: "9:16",
      scenes: [
        {
          title: "Tower Lobby",
          narration: "Double-height lobbies welcome residents home every evening.",
          durationSec: 2,
          imgExt: "png",
          imgWidth: 540,
          imgHeight: 960,
          color: "0x4A2545",
          audioFormat: "mp3",
          audioDurationSec: 1.5,
        },
        {
          title: "Sky Lounge",
          narration: "Unwind above the skyline at sunset.",
          durationSec: 2,
          imgExt: "jpg",
          imgWidth: 720,
          imgHeight: 720,
          color: "0x7F3D2A",
          audioFormat: "wav",
          audioDurationSec: 1.4,
        },
      ],
    });
    const job916Res = await createRenderJobAction({ projectId: setup916.projectId });
    expect(job916Res.ok).toBe(true);
    if (!job916Res.ok) throw new Error(job916Res.error);
    ratiosToVerify.push({
      ratio: "9:16",
      expectedWidth: 1080,
      expectedHeight: 1920,
      expectedDurationSec: 4,
      existingJobId: job916Res.data.id,
      projectId: setup916.projectId,
    });

    const setup11 = await createMultiSceneProjectForRatio({
      title: "C34 Live 1:1 Square E2E",
      aspectRatio: "1:1",
      scenes: [
        {
          title: "Courtyard Pool",
          narration: "Temperature-controlled pools and serene stone walkways await.",
          durationSec: 2,
          imgExt: "webp",
          imgWidth: 640,
          imgHeight: 480,
          color: "0x1A5E63",
          audioFormat: "mp3",
          audioDurationSec: 1.5,
        },
      ],
    });
    const job11Res = await createRenderJobAction({ projectId: setup11.projectId });
    expect(job11Res.ok).toBe(true);
    if (!job11Res.ok) throw new Error(job11Res.error);
    ratiosToVerify.push({
      ratio: "1:1",
      expectedWidth: 1080,
      expectedHeight: 1080,
      expectedDurationSec: 2,
      existingJobId: job11Res.data.id,
      projectId: setup11.projectId,
    });

    const downloadTempDir = await createIsolatedTempDir("rebx-c34-downloads");

    for (const target of ratiosToVerify) {
      const jobId = target.existingJobId!;
      const completedJob = await waitForCondition(
        async () => {
          const row = await prisma.videoRenderJob.findUnique({ where: { id: jobId } });
          if (row?.status === "FAILED") {
            throw new Error(`Render job ${jobId} (${target.ratio}) unexpectedly FAILED: ${row.errorMessage}`);
          }
          return row?.status === "COMPLETED" ? row : null;
        },
        75_000,
        200,
        `completion of ${target.ratio} job ${jobId}`,
      );

      expect(completedJob.progress).toBe(100);
      expect(completedJob.workerId).toBe("worker-c34-live-e2e");
      expect(completedJob.outputStorageKey).toBe(`video-studio/${target.projectId}/renders/render_${jobId}.mp4`);

      const dbProject = await prisma.videoProject.findUniqueOrThrow({ where: { id: target.projectId } });
      expect(dbProject.status).toBe("COMPLETED");
      expect(dbProject.approvedAt).not.toBeNull();

      // Verify stored file on local private disk (and NOT under public/)
      const storedPath = resolveLocalRenderMp4Path(target.projectId, jobId);
      localOutputFiles.push(storedPath);
      const storedBuf = await fs.readFile(storedPath);
      expect(storedBuf.length).toBeGreaterThan(2048);
      expect(storedBuf.subarray(4, 8).toString("ascii")).toBe("ftyp");

      const publicLeaks = await fs
        .stat(path.join(process.cwd(), "public", "uploads", "video-studio", `render_${jobId}.mp4`))
        .then(() => true)
        .catch(() => false);
      expect(publicLeaks).toBe(false);

      // Step 12: Live HTTP admin streaming preview (inline + Range 206)
      const previewRes = await fetch(`${server.baseUrl}/api/admin/video-studio/render-jobs/${jobId}/video`, {
        method: "GET",
      });
      expect(previewRes.status).toBe(200);
      expect(previewRes.headers.get("content-type")).toBe("video/mp4");
      expect(previewRes.headers.get("accept-ranges")).toBe("bytes");
      expect(previewRes.headers.get("cache-control")).toBe("private, no-store");
      expect(previewRes.headers.get("content-disposition")).toMatch(/^inline; filename=".+\.mp4"$/);
      const previewBytes = Buffer.from(await previewRes.arrayBuffer());
      expect(previewBytes.length).toBe(storedBuf.length);

      const rangeRes = await fetch(`${server.baseUrl}/api/admin/video-studio/render-jobs/${jobId}/video`, {
        method: "GET",
        headers: { Range: "bytes=0-4095" },
      });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get("content-range")).toBe(`bytes 0-4095/${storedBuf.length}`);
      const rangeBuf = Buffer.from(await rangeRes.arrayBuffer());
      expect(rangeBuf.equals(storedBuf.subarray(0, 4096))).toBe(true);

      // Step 13 & 14: Live HTTP admin MP4 download (?download=1) -> save -> FFprobe 9.0.1 verification
      const downloadRes = await fetch(
        `${server.baseUrl}/api/admin/video-studio/render-jobs/${jobId}/video?download=1`,
        { method: "GET" },
      );
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.mp4"$/);
      const downloadedBuf = Buffer.from(await downloadRes.arrayBuffer());
      const downloadedSha = createHash("sha256").update(downloadedBuf).digest("hex");

      const meta = (completedJob.outputMetadata as Record<string, unknown>) ?? {};
      expect(meta.checksumSha256).toBe(downloadedSha);
      expect(downloadedBuf.equals(storedBuf)).toBe(true);

      const downloadedFilePath = path.join(downloadTempDir, `${target.ratio.replace(":", "x")}_${jobId}.mp4`);
      await fs.writeFile(downloadedFilePath, downloadedBuf);

      const probed = await verifyRenderedMp4Output({
        ffprobePath: ffprobeBin,
        filePath: downloadedFilePath,
        expectedWidth: target.expectedWidth,
        expectedHeight: target.expectedHeight,
        expectedFps: 30,
        expectedDurationSec: target.expectedDurationSec,
      });
      expect(probed.width).toBe(target.expectedWidth);
      expect(probed.height).toBe(target.expectedHeight);
      expect(probed.videoCodec).toBe("h264");
      expect(probed.audioCodec).toBe("aac");
      expect(probed.pixelFormat).toBe("yuv420p");
    }

    await activeWorker.stop();

    // Verify all temp workspaces removed and worker secret never logged
    expect(await fs.readdir(workerTempDir)).toHaveLength(0);
    const logs = activeWorker.getCombinedLogs();
    expect(logs).not.toContain(WORKER_SECRET);
    expect(logs).toContain("Completed Part C3.3 render job end-to-end");
    expect(server.requests.some((r) => r.pathname.endsWith("/claim") && r.status === 200)).toBe(true);
    expect(server.requests.some((r) => r.pathname.endsWith("/output") && r.status === 200)).toBe(true);
    expect(server.requests.some((r) => r.pathname.endsWith("/complete") && r.status === 200)).toBe(true);
    expect(server.requests.some((r) => r.pathname.endsWith("/video") && r.status === 206)).toBe(true);

    await server.close();
  }, 150_000);

  it("2. Verifies real admin Video Studio UI workflow states (validation blockers, Create Video availability, real progress, cancel, failed error + retry, preview & download MP4)", async () => {
    // 1) Invalid project: missing image & voiceover -> validation blockers rendered, Create Video disabled
    const invalidProjRes = await createProjectAction({
      title: "C34 Invalid Project UI Check",
      topic: "Missing Assets Check",
      category: "buyer_tips",
      sourceType: "CUSTOM_SCRIPT",
      language: "English",
      tone: "Professional",
      duration: 12,
      aspectRatio: "16:9",
      scenes: [
        {
          id: "draft_inv_1",
          order: 1,
          title: "Scene Without Assets",
          narration: "Verify missing image and audio blockers appear cleanly in UI.",
          imagePrompt: "Living room interior",
          imageUrl: null,
          duration: 4,
          locked: false,
        },
      ],
    });
    expect(invalidProjRes.ok).toBe(true);
    if (!invalidProjRes.ok) throw new Error(invalidProjRes.error);
    createdProjectIds.push(invalidProjRes.data.id);

    const invalidReadiness = await validateProjectRenderReadinessAction(invalidProjRes.data.id);
    expect(invalidReadiness.ok).toBe(true);
    if (!invalidReadiness.ok) throw new Error(invalidReadiness.error);
    expect(invalidReadiness.data.valid).toBe(false);

    const invalidLoaded = await getProjectWithScenes(invalidProjRes.data.id);
    const invalidVersions = await getProjectVersions(invalidProjRes.data.id);
    const invalidJobs = await getProjectRenderJobs(invalidProjRes.data.id);
    expect(invalidLoaded).not.toBeNull();

    const invalidHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: invalidLoaded!.project,
        initialScenes: invalidLoaded!.scenes,
        versionedJson: invalidLoaded!.versionedJson,
        initialVersions: invalidVersions,
        initialRenderJobs: invalidJobs,
      }),
    );
    expect(invalidHtml).toContain("Blockers");
    expect(invalidHtml).toContain("Pre-Render Validation Issues:");
    expect(invalidHtml).toContain("requires an uploaded scene image");
    expect(invalidHtml).toContain("is missing voiceover audio");
    expect(invalidHtml).toMatch(/<button[^>]*disabled=""[^>]*>Create Video<\/button>/);

    // 2) Valid project: Create Video action available and enabled
    const validSetup = await createMultiSceneProjectForRatio({
      title: "C34 Valid UI Lifecycle Check",
      aspectRatio: "1:1",
    });
    const validReadiness = await validateProjectRenderReadinessAction(validSetup.projectId);
    expect(validReadiness.ok).toBe(true);
    if (!validReadiness.ok) throw new Error(validReadiness.error);
    expect(validReadiness.data.valid).toBe(true);

    const validLoaded = await getProjectWithScenes(validSetup.projectId);
    const validHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: validLoaded!.project,
        initialScenes: validLoaded!.scenes,
        versionedJson: validLoaded!.versionedJson,
        initialVersions: await getProjectVersions(validSetup.projectId),
        initialRenderJobs: [],
      }),
    );
    expect(validHtml).toContain("Ready to Queue");
    expect(validHtml).toMatch(/<button[^>]*>Create Video<\/button>/);
    expect(validHtml).not.toMatch(/<button[^>]*disabled=""[^>]*>Create Video<\/button>/);

    // 3) Create job -> PENDING offers Cancel Job safely -> cancelRenderJobAction works
    const jCancelRes = await createRenderJobAction({ projectId: validSetup.projectId });
    expect(jCancelRes.ok).toBe(true);
    if (!jCancelRes.ok) throw new Error(jCancelRes.error);
    expect(canCancelRenderJob("PENDING")).toBe(true);

    const pendingJobs = await getProjectRenderJobs(validSetup.projectId);
    const pendingHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: (await getProjectWithScenes(validSetup.projectId))!.project,
        initialScenes: validLoaded!.scenes,
        initialVersions: await getProjectVersions(validSetup.projectId),
        initialRenderJobs: pendingJobs,
      }),
    );
    expect(pendingHtml).toContain("Pending");
    expect(pendingHtml).toContain("Cancel Job");

    const cancelledRes = await cancelRenderJobAction({
      projectId: validSetup.projectId,
      jobId: jCancelRes.data.id,
    });
    expect(cancelledRes.ok).toBe(true);
    if (!cancelledRes.ok) throw new Error(cancelledRes.error);
    expect(cancelledRes.data.status).toBe("CANCELLED");

    // 4) Active PROCESSING state shows real server progress (%) and hides Cancel button
    const jFlowRes = await createRenderJobAction({ projectId: validSetup.projectId });
    expect(jFlowRes.ok).toBe(true);
    if (!jFlowRes.ok) throw new Error(jFlowRes.error);

    await prisma.videoRenderJob.update({
      where: { id: jFlowRes.data.id },
      data: {
        status: "PROCESSING",
        progress: 47,
        stage: "Encoding video scenes (FFmpeg)",
        workerId: "ui-progress-worker",
        startedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
      },
    });
    expect(canCancelRenderJob("PROCESSING")).toBe(false);

    const processingHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: (await getProjectWithScenes(validSetup.projectId))!.project,
        initialScenes: validLoaded!.scenes,
        initialVersions: await getProjectVersions(validSetup.projectId),
        initialRenderJobs: await getProjectRenderJobs(validSetup.projectId),
      }),
    );
    expect(processingHtml).toContain("Processing");
    expect(processingHtml).toContain("Encoding video scenes (FFmpeg)");
    expect(processingHtml).toContain("47%");
    expect(processingHtml).toContain("width:47%");
    expect(processingHtml).not.toContain("Cancel Job");

    // 5) FAILED job renders error message + Retry Job button -> retryRenderJobAction transitions safely
    await prisma.videoRenderJob.update({
      where: { id: jFlowRes.data.id },
      data: {
        status: "FAILED",
        progress: 47,
        stage: "FFmpeg render failed",
        errorMessage: "Encoder exited cleanly with test diagnostic error.",
        workerId: null,
        leaseExpiresAt: null,
      },
    });
    await prisma.videoProject.update({
      where: { id: validSetup.projectId },
      data: { status: "FAILED" },
    });
    expect(canRetryRenderJob("FAILED")).toBe(true);

    const failedHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: (await getProjectWithScenes(validSetup.projectId))!.project,
        initialScenes: validLoaded!.scenes,
        initialVersions: await getProjectVersions(validSetup.projectId),
        initialRenderJobs: await getProjectRenderJobs(validSetup.projectId),
      }),
    );
    expect(failedHtml).toContain("Failed");
    expect(failedHtml).toContain("Encoder exited cleanly with test diagnostic error.");
    expect(failedHtml).toContain("Retry Job");

    const retried = await retryRenderJobAction({
      projectId: validSetup.projectId,
      jobId: jFlowRes.data.id,
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error(retried.error);
    expect(retried.data.status).toBe("QUEUED");
    expect(retried.data.retryCount).toBe(1);
    expect(retried.data.errorMessage).toBeNull();

    // 6) Complete job via real standalone worker -> Workspace + Dashboard show playable <video> & Download MP4
    const server = await startLiveVideoStudioHttpServer();
    const uiWorkerTemp = await createIsolatedTempDir("rebx-c34-ui-worker");
    const uiWorker = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-ui-e2e",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: uiWorkerTemp,
    });

    await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: jFlowRes.data.id } });
        return r?.status === "COMPLETED" ? r : null;
      },
      60_000,
      200,
      "UI check worker completion",
    );
    await uiWorker.stop();
    localOutputFiles.push(resolveLocalRenderMp4Path(validSetup.projectId, jFlowRes.data.id));

    const refreshedJob = await getRenderJobAction({ projectId: validSetup.projectId, jobId: jFlowRes.data.id });
    expect(refreshedJob.ok).toBe(true);
    if (!refreshedJob.ok) throw new Error(refreshedJob.error);
    expect(refreshedJob.data.status).toBe("COMPLETED");

    const completedLoaded = await getProjectWithScenes(validSetup.projectId);
    const completedHtml = renderToStaticMarkup(
      React.createElement(Workspace, {
        project: completedLoaded!.project,
        initialScenes: completedLoaded!.scenes,
        initialVersions: await getProjectVersions(validSetup.projectId),
        initialRenderJobs: await getProjectRenderJobs(validSetup.projectId),
      }),
    );
    expect(completedLoaded!.project.status).toBe("COMPLETED");
    expect(completedHtml).toContain("Completed");
    expect(completedHtml).toContain("100%");
    expect(completedHtml).toContain(`<video`);
    expect(completedHtml).toContain(`/api/admin/video-studio/render-jobs/${jFlowRes.data.id}/video`);
    expect(completedHtml).toContain(
      `href="/api/admin/video-studio/render-jobs/${jFlowRes.data.id}/video?download=1"`,
    );
    expect(completedHtml).toContain("Download MP4");
    expect(completedHtml).toContain("H.264/AAC");
    expect(completedHtml).toContain("1:1 · 1080 × 1080");

    const dashboardData = await getProjectsDashboard({ q: "C34 Valid UI Lifecycle Check" });
    const dashboardHtml = renderToStaticMarkup(
      React.createElement(ProjectDashboardClient, {
        counts: dashboardData.counts,
        projects: dashboardData.projects,
        currentStatus: "ALL",
        currentSort: "updated",
        searchQuery: "C34 Valid UI Lifecycle Check",
      }),
    );
    expect(dashboardHtml).toContain("C34 Valid UI Lifecycle Check");
    expect(dashboardHtml).toContain("Completed");
    expect(dashboardHtml).toContain("Render: Completed (100%)");
    expect(dashboardHtml).toContain(
      `href="/api/admin/video-studio/render-jobs/${jFlowRes.data.id}/video?download=1"`,
    );

    await server.close();
  }, 90_000);

  it("3. Handles worker shutdown during active FFmpeg render and OS worker kill + lease-expiry + restart recovery cleanly", async () => {
    // Part A: Graceful VideoRenderWorker.stop() while active FFmpeg render is encoding
    const setupShutdown = await createMultiSceneProjectForRatio({
      title: "C34 Active Render Shutdown",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Long Architectural Tour",
          narration: "Enjoy panoramic views of the city skyline and peaceful courtyards every morning and evening.",
          durationSec: 20,
          imgExt: "jpg",
          imgWidth: 800,
          imgHeight: 450,
          color: "0x264653",
          audioFormat: "wav",
          audioDurationSec: 2,
        },
      ],
    });
    const jobShutRes = await createRenderJobAction({ projectId: setupShutdown.projectId });
    expect(jobShutRes.ok).toBe(true);
    if (!jobShutRes.ok) throw new Error(jobShutRes.error);

    let shutdownTriggered = false;
    let stopPromise: Promise<void> | null = null;
    let workerA!: VideoRenderWorker;

    const serverA = await startLiveVideoStudioHttpServer({
      onProgressRequest: (_jid, body) => {
        if (!shutdownTriggered && (body.progress ?? 0) >= 16) {
          shutdownTriggered = true;
          stopPromise = workerA.stop();
        }
      },
    });

    const { logger } = createCapturingLogger("worker-c34-graceful-stop");
    const clientA = new RenderWorkerApiClient({
      apiBaseUrl: serverA.baseUrl,
      workerSecret: WORKER_SECRET,
      workerId: "worker-c34-graceful-stop",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 120,
      logger,
    });
    const tempShutDir = await createIsolatedTempDir("rebx-c34-shut-ws");
    workerA = new VideoRenderWorker({
      client: clientA,
      logger,
      pollIntervalMs: 150,
      processingEnabled: true,
      ffmpegStatus: ffmpegEnv,
      tempDir: tempShutDir,
      ffmpegTimeoutMs: 45_000,
      heartbeatIntervalMs: 300,
    });

    const runPromise = workerA.start();
    await waitForCondition(async () => shutdownTriggered, 25_000, 50, "worker shutdown trigger at >=16%");
    await (stopPromise ?? workerA.stop());
    await runPromise;

    const jobAfterShut = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobShutRes.data.id } });
    expect(jobAfterShut.status).toBe("PROCESSING");
    expect(jobAfterShut.errorMessage).toBeNull();
    expect(jobAfterShut.outputStorageKey).toBeNull();
    expect(await fs.readdir(tempShutDir)).toHaveLength(0);
    await prisma.videoRenderJob.delete({ where: { id: jobShutRes.data.id } });
    await serverA.close();

    // Part B: Real OS worker process killed mid-PROCESSING -> lease expires -> fresh OS worker #2 restarts, auto-recovers & completes
    const setupRestart = await createMultiSceneProjectForRatio({
      title: "C34 Worker Restart Recovery",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Entrance Plaza",
          narration: "Automated lease recovery ensures renders complete reliably across worker restarts.",
          durationSec: 2,
          imgExt: "jpg",
          imgWidth: 640,
          imgHeight: 360,
          color: "0x1D4E89",
          audioFormat: "wav",
          audioDurationSec: 1.4,
        },
      ],
    });
    const jobRestartRes = await createRenderJobAction({ projectId: setupRestart.projectId });
    expect(jobRestartRes.ok).toBe(true);
    if (!jobRestartRes.ok) throw new Error(jobRestartRes.error);

    let claimedFirstTime = false;
    const serverB = await startLiveVideoStudioHttpServer({
      onClaimResponse: async (jid) => {
        if (jid === jobRestartRes.data.id) {
          claimedFirstTime = true;
        }
      },
      // Simulate worker stall right on progress after claim before complete
      onProgressRequest: async () => {
        await new Promise((r) => setTimeout(r, 8_000));
      },
    });

    const tempCrash1 = await createIsolatedTempDir("rebx-c34-crash1");
    const workerCrash1 = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-crashed-1",
      RENDER_API_BASE_URL: serverB.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempCrash1,
    });

    await waitForCondition(async () => claimedFirstTime, 15_000, 50, "worker #1 claim");
    try {
      workerCrash1.child.kill("SIGKILL");
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 300));
    await serverB.close();

    const stalledJob = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: jobRestartRes.data.id } });
    expect(stalledJob.status).toBe("PROCESSING");
    expect(stalledJob.workerId).toBe("worker-c34-crashed-1");

    // Simulate worker lease expiring before restart worker #2 starts
    await prisma.videoRenderJob.update({
      where: { id: jobRestartRes.data.id },
      data: { leaseExpiresAt: new Date(Date.now() - 10_000) },
    });

    const serverHealthy = await startLiveVideoStudioHttpServer();
    const tempRestart2 = await createIsolatedTempDir("rebx-c34-restart2");
    const workerRestart2 = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-restarted-2",
      RENDER_API_BASE_URL: serverHealthy.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempRestart2,
    });

    const recoveredCompleted = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: jobRestartRes.data.id } });
        if (r?.status === "FAILED") {
          throw new Error(`Recovered job unexpectedly failed: ${r.errorMessage}`);
        }
        return r?.status === "COMPLETED" ? r : null;
      },
      60_000,
      200,
      "recovered job completion by worker #2",
    );
    await workerRestart2.stop();

    expect(recoveredCompleted.retryCount).toBe(1);
    expect(recoveredCompleted.workerId).toBe("worker-c34-restarted-2");
    expect(recoveredCompleted.progress).toBe(100);
    expect(await fs.readdir(tempRestart2)).toHaveLength(0);

    const mp4Path = resolveLocalRenderMp4Path(setupRestart.projectId, jobRestartRes.data.id);
    localOutputFiles.push(mp4Path);
    const probe = await verifyRenderedMp4Output({
      ffprobePath: ffprobeBin,
      filePath: mp4Path,
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedFps: 30,
    });
    expect(probe.videoCodec).toBe("h264");
    expect(probe.audioCodec).toBe("aac");

    await serverHealthy.close();
  }, 90_000);

  it("4. Handles cancellation during live rendering AND cancellation during active HTTP upload stream cleanly without leaving orphan MP4s", async () => {
    // Part A: Job cancelled on server while real standalone worker OS process is actively encoding FFmpeg
    const setupCancelRender = await createMultiSceneProjectForRatio({
      title: "C34 Cancel Mid-Render",
      aspectRatio: "16:9",
      scenes: [
        {
          title: "Extended Villa Walkthrough",
          narration: "Cancellation should stop encoding immediately and clean up all temporary files safely.",
          durationSec: 25,
          imgExt: "jpg",
          imgWidth: 800,
          imgHeight: 450,
          color: "0x3D405B",
          audioFormat: "wav",
          audioDurationSec: 2,
        },
      ],
    });
    const jobCancelRenderRes = await createRenderJobAction({ projectId: setupCancelRender.projectId });
    expect(jobCancelRenderRes.ok).toBe(true);
    if (!jobCancelRenderRes.ok) throw new Error(jobCancelRenderRes.error);

    let midRenderCancelled = false;
    let completeHitDuringCancelRender = 0;
    const serverRenderCancel = await startLiveVideoStudioHttpServer({
      onProgressRequest: async (jid, body) => {
        if (!midRenderCancelled && jid === jobCancelRenderRes.data.id && (body.progress ?? 0) >= 16) {
          midRenderCancelled = true;
          await prisma.videoRenderJob.update({
            where: { id: jid },
            data: {
              status: "CANCELLED",
              stage: "Cancelled during active FFmpeg render",
              cancelledAt: new Date(),
              workerId: null,
              leaseExpiresAt: null,
            },
          });
        }
      },
      onCompleteRequest: () => {
        completeHitDuringCancelRender++;
      },
    });

    const tempCancelRenderDir = await createIsolatedTempDir("rebx-c34-cancel-render");
    const workerCancelRender = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-cancel-render",
      RENDER_API_BASE_URL: serverRenderCancel.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempCancelRenderDir,
    });

    await waitForCondition(
      async () =>
        midRenderCancelled &&
        workerCancelRender.getCombinedLogs().includes("Render job aborted cleanly due to cancellation"),
      35_000,
      100,
      "worker cancellation abort during FFmpeg render",
    );
    await workerCancelRender.stop();

    const dbAfterRenderCancel = await prisma.videoRenderJob.findUniqueOrThrow({
      where: { id: jobCancelRenderRes.data.id },
    });
    expect(dbAfterRenderCancel.status).toBe("CANCELLED");
    expect(dbAfterRenderCancel.outputStorageKey).toBeNull();
    expect(completeHitDuringCancelRender).toBe(0);
    expect(await fs.readdir(tempCancelRenderDir)).toHaveLength(0);
    const leakedRenderCancel = await fs
      .stat(resolveLocalRenderMp4Path(setupCancelRender.projectId, jobCancelRenderRes.data.id))
      .then(() => true)
      .catch(() => false);
    expect(leakedRenderCancel).toBe(false);
    await serverRenderCancel.close();

    // Part B: Job cancelled on server WHILE live HTTP PUT /output is actively streaming bytes
    const setupCancelUpload = await createMultiSceneProjectForRatio({
      title: "C34 Cancel Mid-Upload",
      aspectRatio: "1:1",
    });
    const jobCancelUploadRes = await createRenderJobAction({ projectId: setupCancelUpload.projectId });
    expect(jobCancelUploadRes.ok).toBe(true);
    if (!jobCancelUploadRes.ok) throw new Error(jobCancelUploadRes.error);

    let midUploadCancelled = false;
    let completeHitDuringCancelUpload = 0;
    const serverUploadCancel = await startLiveVideoStudioHttpServer({
      onFirstUploadChunk: async (jid) => {
        if (jid === jobCancelUploadRes.data.id && !midUploadCancelled) {
          midUploadCancelled = true;
          await prisma.videoRenderJob.update({
            where: { id: jid },
            data: {
              status: "CANCELLED",
              stage: "Cancelled mid-HTTP upload stream",
              cancelledAt: new Date(),
              workerId: null,
              leaseExpiresAt: null,
            },
          });
        }
      },
      onCompleteRequest: () => {
        completeHitDuringCancelUpload++;
      },
    });

    const tempCancelUploadDir = await createIsolatedTempDir("rebx-c34-cancel-upload");
    const workerCancelUpload = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-cancel-upload",
      RENDER_API_BASE_URL: serverUploadCancel.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempCancelUploadDir,
    });

    await waitForCondition(
      async () =>
        midUploadCancelled &&
        workerCancelUpload.getCombinedLogs().includes("Render job aborted cleanly due to cancellation"),
      45_000,
      150,
      "worker cancellation abort mid-HTTP upload stream",
    );
    await workerCancelUpload.stop();

    const dbAfterUploadCancel = await prisma.videoRenderJob.findUniqueOrThrow({
      where: { id: jobCancelUploadRes.data.id },
    });
    expect(dbAfterUploadCancel.status).toBe("CANCELLED");
    expect(dbAfterUploadCancel.outputStorageKey).toBeNull();
    expect(completeHitDuringCancelUpload).toBe(0);
    expect(await fs.readdir(tempCancelUploadDir)).toHaveLength(0);

    // Ensure finalizeWorkerJobOutputUpload discarded the uncommitted MP4 completely from storage
    const rendersDir = path.join(process.cwd(), "storage", "video-studio", setupCancelUpload.projectId, "renders");
    const leftoverFiles = await fs.readdir(rendersDir).catch(() => []);
    expect(leftoverFiles).toEqual([]);

    await serverUploadCancel.close();
  }, 120_000);

  it("5. Recovers cleanly from mid-stream HTTP upload failure, transient/persistent /complete API errors, duplicate completions, corrupt MP4 uploads, and retries after post-upload failure", async () => {
    const setup = await createMultiSceneProjectForRatio({
      title: "C34 Upload & Completion Fault Recovery",
      aspectRatio: "16:9",
    });

    // Part A: Mid-stream aborted HTTP TCP upload leaves zero .mp4 / .part files on disk, followed by clean completion
    const job1Res = await createRenderJobAction({ projectId: setup.projectId });
    expect(job1Res.ok).toBe(true);
    if (!job1Res.ok) throw new Error(job1Res.error);
    const job1Id = job1Res.data.id;

    let completeTransientCount = 0;
    const serverFault = await startLiveVideoStudioHttpServer({
      onCompleteRequest: async () => {
        completeTransientCount++;
        if (completeTransientCount === 1) {
          return new Response(JSON.stringify({ ok: false, error: "Temporary gateway 503" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    });

    const { logger } = createCapturingLogger("worker-c34-tcp-interrupt");
    const manualClient = new RenderWorkerApiClient({
      apiBaseUrl: serverFault.baseUrl,
      workerSecret: WORKER_SECRET,
      workerId: "worker-c34-tcp-interrupt",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 120,
      logger,
    });

    const claim1 = await manualClient.claimNextJob();
    expect(claim1.claimed).toBe(true);
    expect(claim1.job?.id).toBe(job1Id);

    // Send a truncated TCP PUT /output request declaring 200KB, writing only 16KB then destroying the socket
    await new Promise<void>((resolve) => {
      const url = new URL(`${serverFault.baseUrl}/api/internal/video-studio/render-jobs/${job1Id}/output`);
      const clientReq = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "PUT",
          headers: {
            Authorization: `Bearer ${WORKER_SECRET}`,
            "X-REBX-Worker-Id": "worker-c34-tcp-interrupt",
            "Content-Type": "video/mp4",
            "Content-Length": "204800",
          },
        },
        () => resolve(),
      );
      clientReq.on("error", () => resolve());
      const validFtypHeader = Buffer.from([
        0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d,
        0x6d, 0x70, 0x34, 0x31,
      ]);
      clientReq.write(Buffer.concat([validFtypHeader, Buffer.alloc(16 * 1024)]));
      setTimeout(() => {
        clientReq.destroy();
        setTimeout(resolve, 150);
      }, 60);
    });

    await waitForCondition(
      async () => serverFault.requests.some((r) => r.pathname.endsWith(`/render-jobs/${job1Id}/output`) && r.status >= 400),
      5_000,
      50,
      "server-side aborted /output cleanup completion",
    );

    const rendersDir = path.join(process.cwd(), "storage", "video-studio", setup.projectId, "renders");
    expect(await fs.readdir(rendersDir).catch(() => [])).toEqual([]);
    const jobAfterAbort = await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: job1Id } });
    expect(jobAfterAbort.status).toBe("PROCESSING");
    expect(jobAfterAbort.outputStorageKey).toBeNull();

    // Corrupt non-MP4 bytes rejected 422 over live HTTP
    const corruptRes = await fetch(`${serverFault.baseUrl}/api/internal/video-studio/render-jobs/${job1Id}/output`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${WORKER_SECRET}`,
        "X-REBX-Worker-Id": "worker-c34-tcp-interrupt",
        "Content-Type": "video/mp4",
        "Content-Length": "64",
      },
      body: Buffer.from("CORRUPT_NOT_AN_MP4_CONTAINER_STREAM_1234567890_ABCDEF_1234567890"),
    });
    expect(corruptRes.status).toBe(422);
    expect(await fs.readdir(rendersDir).catch(() => [])).toEqual([]);

    // Now re-queue or complete via real worker (simulate worker crash recovery -> re-render + transient 503 on /complete -> retry /complete succeeds!)
    await prisma.videoRenderJob.update({
      where: { id: job1Id },
      data: {
        leaseExpiresAt: new Date(Date.now() - 10_000),
      },
    });

    const tempWorker1 = await createIsolatedTempDir("rebx-c34-transient-complete");
    const workerTransient = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-transient-complete",
      RENDER_API_BASE_URL: serverFault.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempWorker1,
    });

    const completedJob1 = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: job1Id } });
        if (r?.status === "FAILED") throw new Error(`Job 1 failed unexpectedly: ${r.errorMessage}`);
        return r?.status === "COMPLETED" ? r : null;
      },
      60_000,
      200,
      "job1 completion after transient 503 /complete retry",
    );
    await workerTransient.stop();
    localOutputFiles.push(resolveLocalRenderMp4Path(setup.projectId, job1Id));

    expect(completeTransientCount).toBe(2); // 1st 503 + 2nd automatic retry 200
    expect(completedJob1.status).toBe("COMPLETED");

    // Duplicate completion request with identical metadata returns 200 idempotently, conflicting replay returns 409
    const meta1 = completedJob1.outputMetadata as Record<string, unknown>;
    const replayClient = new RenderWorkerApiClient({
      apiBaseUrl: serverFault.baseUrl,
      workerSecret: WORKER_SECRET,
      workerId: "worker-c34-transient-complete",
      requestTimeoutMs: 10_000,
      leaseDurationSec: 120,
      logger,
    });
    const dupComplete = await replayClient.reportCompletion(job1Id, {
      outputStorageKey: completedJob1.outputStorageKey!,
      outputMetadata: {
        container: "mp4",
        aspectRatio: "16:9",
        width: 1920,
        height: 1080,
        fps: 30,
        sceneCount: 2,
        totalDurationSec: 4,
        fileSizeBytes: Number(meta1.fileSizeBytes),
        renderedDurationSec: Number(meta1.renderedDurationSec),
        checksumSha256: String(meta1.checksumSha256),
      },
    });
    expect(dupComplete.status).toBe("COMPLETED");
    expect(dupComplete.completedAt).toBe(completedJob1.completedAt?.toISOString());

    await expect(
      replayClient.reportCompletion(job1Id, {
        outputStorageKey: completedJob1.outputStorageKey!,
        outputMetadata: {
          container: "mp4",
          aspectRatio: "16:9",
          width: 1920,
          height: 1080,
          fps: 30,
          sceneCount: 2,
          totalDurationSec: 4,
          fileSizeBytes: Number(meta1.fileSizeBytes) + 99,
          renderedDurationSec: Number(meta1.renderedDurationSec),
          checksumSha256: String(meta1.checksumSha256),
        },
      }),
    ).rejects.toMatchObject({ status: 409 });

    await serverFault.close();

    // Part B: Persistent /complete failure AFTER upload succeeds -> job FAILED, stale uploaded* scrubbed & uncommitted MP4 removed on retryRenderJobAction, then retry completes!
    const setup2 = await createMultiSceneProjectForRatio({
      title: "C34 Retry After Post-Upload Failure",
      aspectRatio: "9:16",
    });
    const job2Res = await createRenderJobAction({ projectId: setup2.projectId });
    expect(job2Res.ok).toBe(true);
    if (!job2Res.ok) throw new Error(job2Res.error);
    const job2Id = job2Res.data.id;

    let forcePersistentCompleteError = true;
    const serverPersistFail = await startLiveVideoStudioHttpServer({
      onCompleteRequest: async () => {
        if (forcePersistentCompleteError) {
          return new Response(JSON.stringify({ ok: false, error: "Simulated persistent 500 on /complete" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    });

    const tempFailComplete = await createIsolatedTempDir("rebx-c34-fail-complete");
    const workerFailComplete = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-fail-complete",
      RENDER_API_BASE_URL: serverPersistFail.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempFailComplete,
    });

    const failedJob2 = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: job2Id } });
        return r?.status === "FAILED" ? r : null;
      },
      60_000,
      200,
      "job2 FAILED after persistent /complete 500",
    );
    await workerFailComplete.stop();

    expect(failedJob2.outputStorageKey).toBeNull();
    expect(failedJob2.errorMessage).toMatch(/Simulated persistent 500/);
    // Before retry, uploadedOutputKey from /output is in metadata and uncommitted MP4 is on disk
    const preRetryMeta = (failedJob2.outputMetadata as Record<string, unknown>) ?? {};
    expect(typeof preRetryMeta.uploadedOutputKey).toBe("string");
    const uncommittedMp4Path = resolveLocalRenderMp4Path(setup2.projectId, job2Id);
    expect(await fs.stat(uncommittedMp4Path).then((s) => s.size)).toBeGreaterThan(0);

    // Retry via admin action: verifies Bug #1 fix strips stale uploaded* fields and deletes stale uncommitted MP4
    forcePersistentCompleteError = false;
    const retryRes = await retryRenderJobAction({ projectId: setup2.projectId, jobId: job2Id });
    expect(retryRes.ok).toBe(true);
    if (!retryRes.ok) throw new Error(retryRes.error);

    const postRetryMeta = (retryRes.data.outputMetadata as Record<string, unknown>) ?? {};
    expect(postRetryMeta.workerPendingPartC3).toBe(true);
    expect(postRetryMeta.uploadedOutputKey).toBeUndefined();
    expect(postRetryMeta.uploadedChecksumSha256).toBeUndefined();
    expect(postRetryMeta.uploadedFileSizeBytes).toBeUndefined();
    expect(
      await fs
        .stat(uncommittedMp4Path)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);

    // Clear preserved temp dir from failed run cleanly (worker preserves temp on /complete 500)
    await fs.rm(tempFailComplete, { recursive: true, force: true });
    await fs.mkdir(tempFailComplete, { recursive: true });

    const workerRetryPass = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-retry-pass",
      RENDER_API_BASE_URL: serverPersistFail.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempFailComplete,
    });

    const completedJob2 = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: job2Id } });
        if (r?.status === "FAILED") throw new Error(`Retried job failed: ${r.errorMessage}`);
        return r?.status === "COMPLETED" ? r : null;
      },
      60_000,
      200,
      "retried job2 completion",
    );
    await workerRetryPass.stop();
    localOutputFiles.push(uncommittedMp4Path);

    expect(completedJob2.retryCount).toBe(1);
    expect(await fs.readdir(tempFailComplete)).toHaveLength(0);
    const probe2 = await verifyRenderedMp4Output({
      ffprobePath: ffprobeBin,
      filePath: uncommittedMp4Path,
      expectedWidth: 1080,
      expectedHeight: 1920,
      expectedFps: 30,
    });
    expect(probe2.videoCodec).toBe("h264");

    await serverPersistFail.close();
  }, 150_000);

  it("6. Rejects missing image or audio during live render cleanly, cleans temp workspaces, and blocks invalid state transitions", async () => {
    const server = await startLiveVideoStudioHttpServer();

    // Case A: Image removed from private storage after job snapshot was frozen
    const setupMissingImg = await createMultiSceneProjectForRatio({
      title: "C34 Missing Image At Worker Render",
      aspectRatio: "1:1",
    });
    const jobImgRes = await createRenderJobAction({ projectId: setupMissingImg.projectId });
    expect(jobImgRes.ok).toBe(true);
    if (!jobImgRes.ok) throw new Error(jobImgRes.error);

    await fs.unlink(resolveLocalImageFilePath(setupMissingImg.imageUrls[0]));

    const tempMissingImg = await createIsolatedTempDir("rebx-c34-missing-img");
    const workerImg = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-missing-img",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempMissingImg,
    });

    const failedImgJob = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: jobImgRes.data.id } });
        return r?.status === "FAILED" ? r : null;
      },
      30_000,
      150,
      "missing image job failure",
    );
    await workerImg.stop();

    expect(failedImgJob.status).toBe("FAILED");
    expect(failedImgJob.outputStorageKey).toBeNull();
    expect(failedImgJob.errorMessage).toBeTruthy();
    expect(failedImgJob.errorMessage).not.toContain(WORKER_SECRET);
    expect(await fs.readdir(tempMissingImg)).toHaveLength(0);

    // Case B: Audio removed from private storage after job snapshot was frozen
    const setupMissingAud = await createMultiSceneProjectForRatio({
      title: "C34 Missing Audio At Worker Render",
      aspectRatio: "1:1",
    });
    const jobAudRes = await createRenderJobAction({ projectId: setupMissingAud.projectId });
    expect(jobAudRes.ok).toBe(true);
    if (!jobAudRes.ok) throw new Error(jobAudRes.error);

    await fs.unlink(resolveLocalAudioFilePath(setupMissingAud.audioKeys[0]));

    const tempMissingAud = await createIsolatedTempDir("rebx-c34-missing-aud");
    const workerAud = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-missing-aud",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempMissingAud,
    });

    const failedAudJob = await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: jobAudRes.data.id } });
        return r?.status === "FAILED" ? r : null;
      },
      30_000,
      150,
      "missing audio job failure",
    );
    await workerAud.stop();

    expect(failedAudJob.status).toBe("FAILED");
    expect(failedAudJob.outputStorageKey).toBeNull();
    expect(failedAudJob.errorMessage).toBeTruthy();
    expect(failedAudJob.errorMessage).not.toContain(WORKER_SECRET);
    expect(await fs.readdir(tempMissingAud)).toHaveLength(0);

    // Case C: Invalid transitions strictly rejected
    const setupTrans = await createMultiSceneProjectForRatio({
      title: "C34 Invalid Transitions",
      aspectRatio: "16:9",
    });
    const jobTransRes = await createRenderJobAction({ projectId: setupTrans.projectId });
    expect(jobTransRes.ok).toBe(true);
    if (!jobTransRes.ok) throw new Error(jobTransRes.error);
    const tid = jobTransRes.data.id;

    // PENDING -> COMPLETED forbidden
    await expect(
      transitionRenderJobInternal({
        projectId: setupTrans.projectId,
        jobId: tid,
        targetStatus: "COMPLETED",
        progress: 100,
        outputStorageKey: `video-studio/${setupTrans.projectId}/renders/render_${tid}.mp4`,
      }),
    ).rejects.toThrow(/Invalid render job status transition/);

    // PROCESSING cannot be admin-cancelled directly via cancelRenderJobAction
    await transitionRenderJobInternal({
      projectId: setupTrans.projectId,
      jobId: tid,
      targetStatus: "QUEUED",
      progress: 0,
    });
    await transitionRenderJobInternal({
      projectId: setupTrans.projectId,
      jobId: tid,
      targetStatus: "PROCESSING",
      progress: 25,
    });
    const cancelProcessing = await cancelRenderJobAction({
      projectId: setupTrans.projectId,
      jobId: tid,
    });
    expect(cancelProcessing.ok).toBe(false);
    if (!cancelProcessing.ok) {
      expect(cancelProcessing.error).toMatch(/Invalid render job status transition/);
    }

    await prisma.videoRenderJob.delete({ where: { id: tid } });
    await server.close();
  }, 90_000);

  it("7. Deletes completed AND uncommitted render MP4 outputs and empty render directories upon project deletion while preserving shared assets", async () => {
    const setup = await createMultiSceneProjectForRatio({
      title: "C34 Project Deletion Output Cleanup",
      aspectRatio: "1:1",
    });
    const jobCompletedRes = await createRenderJobAction({ projectId: setup.projectId });
    expect(jobCompletedRes.ok).toBe(true);
    if (!jobCompletedRes.ok) throw new Error(jobCompletedRes.error);
    const completedJobId = jobCompletedRes.data.id;

    // Render and complete Job 1 cleanly
    const server = await startLiveVideoStudioHttpServer();
    const tempDelDir = await createIsolatedTempDir("rebx-c34-del-worker");
    const worker = spawnStandaloneWorkerProcess({
      RENDER_WORKER_ID: "worker-c34-del-cleanup",
      RENDER_API_BASE_URL: server.baseUrl,
      RENDER_WORKER_SECRET: WORKER_SECRET,
      RENDER_WORKER_PROCESSING_ENABLED: "true",
      RENDER_WORKER_TEMP_DIR: tempDelDir,
    });

    await waitForCondition(
      async () => {
        const r = await prisma.videoRenderJob.findUnique({ where: { id: completedJobId } });
        return r?.status === "COMPLETED" ? r : null;
      },
      60_000,
      200,
      "job1 completed before delete test",
    );
    await worker.stop();
    await server.close();

    const completedMp4Path = resolveLocalRenderMp4Path(setup.projectId, completedJobId);
    expect(await fs.stat(completedMp4Path).then((s) => s.size)).toBeGreaterThan(0);

    // Also create an uncommitted MP4 record on a second FAILED job (simulating failed /complete after /output)
    const uncommittedJob = await prisma.videoRenderJob.create({
      data: {
        projectId: setup.projectId,
        createdById: ADMIN_USER.id,
        status: "FAILED",
        progress: 96,
        stage: "Job completion failed",
        errorMessage: "Simulated post-upload completion failure prior to deletion",
        snapshot: (await prisma.videoRenderJob.findUniqueOrThrow({ where: { id: completedJobId } })).snapshot!,
        snapshotHash: "uncommitted-hash-c34",
        outputStorageKey: null,
        outputMetadata: {
          targetOutputKey: `video-studio/${setup.projectId}/renders/render_c34uncommitted.mp4`,
          uploadedOutputKey: `video-studio/${setup.projectId}/renders/render_c34uncommitted.mp4`,
          storageProvider: "local-private",
        },
      },
    });
    const uncommittedMp4Path = resolveLocalRenderMp4Path(setup.projectId, "c34uncommitted");
    await fs.writeFile(
      uncommittedMp4Path,
      Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]),
    );
    expect(await fs.stat(uncommittedMp4Path).then((s) => s.size)).toBeGreaterThan(0);

    // Delete the project -> verifies Bug #2 fix cleans BOTH committed & uncommitted MP4s + removes empty project renders directory
    const delRes = await deleteProjectAction(setup.projectId);
    expect(delRes.ok).toBe(true);

    expect(await prisma.videoProject.findUnique({ where: { id: setup.projectId } })).toBeNull();
    expect(await prisma.videoRenderJob.findUnique({ where: { id: completedJobId } })).toBeNull();
    expect(await prisma.videoRenderJob.findUnique({ where: { id: uncommittedJob.id } })).toBeNull();

    expect(
      await fs
        .stat(completedMp4Path)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .stat(uncommittedMp4Path)
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    expect(
      await fs
        .stat(path.join(process.cwd(), "storage", "video-studio", setup.projectId))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  }, 90_000);
});
