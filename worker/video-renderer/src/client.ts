import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  validateAssetContentType,
  verifyAssetBinarySignature,
  WORKER_MAX_AUDIO_BYTES,
  WORKER_MAX_IMAGE_BYTES,
  WORKER_SNAPSHOT_ASSET_ID_REGEX,
  WorkerAssetValidationError,
  type DownloadedAssetFile,
  type PlannedSnapshotAsset,
} from "./assets";
import { redactSensitiveString, type WorkerLogger } from "./logger";
import {
  workerClaimApiResponseSchema,
  workerJobOutputUploadApiResponseSchema,
  workerJobUpdateApiResponseSchema,
  type WorkerClaimedJob,
} from "./schemas";

export class WorkerApiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerApiTimeoutError";
  }
}

export class WorkerApiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerApiConnectionError";
  }
}

export class WorkerApiHttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "WorkerApiHttpError";
    this.status = status;
    this.code = code;
  }
}

export type FetchLike = typeof fetch;

export type RenderWorkerClientOptions = {
  apiBaseUrl: string;
  workerSecret: string;
  workerId: string;
  requestTimeoutMs: number;
  leaseDurationSec: number;
  logger: WorkerLogger;
  fetchImpl?: FetchLike;
};

export type WorkerCompletionPayload = {
  outputStorageKey: string;
  stage?: string;
  outputMetadata: {
    container: "mp4";
    aspectRatio: "16:9" | "9:16" | "1:1";
    width: number;
    height: number;
    fps: number;
    sceneCount: number;
    totalDurationSec: number;
    fileSizeBytes: number;
    renderedDurationSec: number;
    renderedAt?: string;
    checksumSha256?: string;
    etag?: string;
    videoCodec?: string;
    audioCodec?: string | null;
    pixelFormat?: string;
    bitRate?: number | null;
    storageProvider?: "local-private" | "spaces";
  };
};

export type WorkerUploadedJobOutput = {
  outputStorageKey: string;
  provider: "local-private" | "spaces";
  fileSizeBytes: number;
  checksumSha256: string;
  etag: string | null;
};

export class RenderWorkerApiClient {
  private readonly apiBaseUrl: string;
  private readonly workerSecret: string;
  private readonly workerId: string;
  private readonly requestTimeoutMs: number;
  private readonly leaseDurationSec: number;
  private readonly logger: WorkerLogger;
  private readonly fetchFn: FetchLike;

  constructor(opts: RenderWorkerClientOptions) {
    this.apiBaseUrl = opts.apiBaseUrl.replace(/\/+$/, "");
    this.workerSecret = opts.workerSecret;
    this.workerId = opts.workerId;
    this.requestTimeoutMs = opts.requestTimeoutMs;
    this.leaseDurationSec = opts.leaseDurationSec;
    this.logger = opts.logger;
    this.fetchFn = opts.fetchImpl ?? fetch;
  }

  getLeaseDurationSec(): number {
    return this.leaseDurationSec;
  }

  getWorkerSecretForRedaction(): string {
    return this.workerSecret;
  }

  private async postJson(endpointPath: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.apiBaseUrl}${endpointPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.workerSecret}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort =
        controller.signal.aborted ||
        (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message)));

      if (isAbort) {
        const msg = `REBX worker API request timed out after ${this.requestTimeoutMs}ms (${endpointPath}).`;
        this.logger.warn(msg, { endpoint: endpointPath, timeoutMs: this.requestTimeoutMs });
        throw new WorkerApiTimeoutError(msg);
      }

      const rawDetail = err instanceof Error ? err.message : "Network connection failed";
      const safeDetail = redactSensitiveString(rawDetail, [this.workerSecret]);
      const msg = `Unable to reach REBX application API (${endpointPath}): ${safeDetail}`;
      this.logger.error(msg, { endpoint: endpointPath });
      throw new WorkerApiConnectionError(msg);
    } finally {
      clearTimeout(timer);
    }

    const rawText = await res.text().catch(() => "");
    let parsedJson: unknown = null;
    if (rawText.trim()) {
      try {
        parsedJson = JSON.parse(rawText);
      } catch {
        parsedJson = null;
      }
    }

    if (!res.ok) {
      const serverErrObj =
        parsedJson && typeof parsedJson === "object"
          ? (parsedJson as { error?: unknown; code?: unknown })
          : null;
      const rawServerMsg =
        typeof serverErrObj?.error === "string" && serverErrObj.error.trim()
          ? serverErrObj.error.trim()
          : `HTTP ${res.status} ${res.statusText || "Request failed"}`;
      const safeMsg = redactSensitiveString(rawServerMsg, [this.workerSecret]);
      const code = typeof serverErrObj?.code === "string" ? serverErrObj.code : undefined;

      this.logger.warn("REBX worker API returned error response", {
        endpoint: endpointPath,
        status: res.status,
        code,
        error: safeMsg,
      });
      throw new WorkerApiHttpError(res.status, safeMsg, code);
    }

    if (!parsedJson || typeof parsedJson !== "object") {
      throw new WorkerApiHttpError(
        res.status,
        `REBX worker API returned invalid JSON payload (${endpointPath}).`,
      );
    }

    return parsedJson;
  }

  async claimNextJob(opts?: { recoverExpiredLeases?: boolean }): Promise<{
    claimed: boolean;
    recoveredCount: number;
    job: WorkerClaimedJob | null;
  }> {
    const json = await this.postJson("/api/internal/video-studio/render-jobs/claim", {
      workerId: this.workerId,
      leaseDurationSec: this.leaseDurationSec,
      ...(opts?.recoverExpiredLeases !== undefined
        ? { recoverExpiredLeases: opts.recoverExpiredLeases }
        : {}),
    });
    const parsed = workerClaimApiResponseSchema.parse(json);
    return {
      claimed: parsed.claimed,
      recoveredCount: parsed.recoveredCount,
      job: parsed.job,
    };
  }

  async reportProgress(
    jobId: string,
    payload: { progress: number; stage?: string },
  ): Promise<WorkerClaimedJob> {
    const json = await this.postJson(
      `/api/internal/video-studio/render-jobs/${encodeURIComponent(jobId)}/progress`,
      {
        workerId: this.workerId,
        progress: payload.progress,
        ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
        leaseDurationSec: this.leaseDurationSec,
      },
    );
    return workerJobUpdateApiResponseSchema.parse(json).job;
  }

  async sendHeartbeat(
    jobId: string,
    payload: { progress?: number; stage?: string } = {},
  ): Promise<WorkerClaimedJob> {
    const json = await this.postJson(
      `/api/internal/video-studio/render-jobs/${encodeURIComponent(jobId)}/heartbeat`,
      {
        workerId: this.workerId,
        ...(payload.progress !== undefined ? { progress: payload.progress } : {}),
        ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
        leaseDurationSec: this.leaseDurationSec,
      },
    );
    return workerJobUpdateApiResponseSchema.parse(json).job;
  }

  async reportFailure(
    jobId: string,
    payload: { errorMessage: string; stage?: string },
  ): Promise<WorkerClaimedJob> {
    const json = await this.postJson(
      `/api/internal/video-studio/render-jobs/${encodeURIComponent(jobId)}/fail`,
      {
        workerId: this.workerId,
        errorMessage: payload.errorMessage,
        ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
      },
    );
    return workerJobUpdateApiResponseSchema.parse(json).job;
  }

  /**
   * Protocol method reserved for Part C3.2 after real FFmpeg MP4 encoding & upload.
   * Part C3.1 placeholder processor must never invoke reportCompletion.
   */
  async reportCompletion(
    jobId: string,
    payload: WorkerCompletionPayload,
  ): Promise<WorkerClaimedJob> {
    const json = await this.postJson(
      `/api/internal/video-studio/render-jobs/${encodeURIComponent(jobId)}/complete`,
      {
        workerId: this.workerId,
        outputStorageKey: payload.outputStorageKey,
        ...(payload.stage !== undefined ? { stage: payload.stage } : {}),
        outputMetadata: payload.outputMetadata,
      },
    );
    return workerJobUpdateApiResponseSchema.parse(json).job;
  }

  /**
   * Streams the rendered local MP4 file to the REBX internal private storage upload endpoint
   * without buffering the whole video in RAM, computing and verifying its SHA-256 checksum.
   */
  async uploadJobOutput(params: {
    jobId: string;
    outputFilePath: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    redactDirs?: readonly string[];
  }): Promise<WorkerUploadedJobOutput> {
    const cleanJobId = params.jobId?.trim() ?? "";
    if (!cleanJobId || cleanJobId.includes("..") || /[\\/\0\s]/.test(cleanJobId)) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        "Invalid jobId for worker output upload.",
      );
    }

    const resolvedFilePath = path.resolve(params.outputFilePath);
    const redactList = [this.workerSecret, resolvedFilePath, ...(params.redactDirs ?? [])];

    const { fileSizeBytes, sha256Hex } = await computeLocalFileSha256AndSize(resolvedFilePath);
    if (fileSizeBytes <= 0) {
      throw new WorkerAssetValidationError(
        "INCOMPLETE_DOWNLOAD",
        "Cannot upload empty rendered MP4 file (0 bytes).",
      );
    }

    const endpointPath = `/api/internal/video-studio/render-jobs/${encodeURIComponent(cleanJobId)}/output`;
    const url = `${this.apiBaseUrl}${endpointPath}`;
    const timeoutMs = params.timeoutMs ?? Math.max(this.requestTimeoutMs * 4, 60_000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (params.signal) {
      if (params.signal.aborted) {
        clearTimeout(timer);
        controller.abort();
      } else {
        params.signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    const nodeStream = fsSync.createReadStream(resolvedFilePath);
    const webBodyStream = nodeFileReadableToWebStream(nodeStream, controller.signal);

    try {
      let res: Response;
      try {
        const requestInit: RequestInit & { duplex?: "half" } = {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.workerSecret}`,
            "X-REBX-Worker-Id": this.workerId,
            "X-REBX-Content-SHA256": sha256Hex,
            "Content-Type": "video/mp4",
            "Content-Length": String(fileSizeBytes),
          },
          body: webBodyStream,
          duplex: "half",
          redirect: "error",
          signal: controller.signal,
        };
        res = await this.fetchFn(url, requestInit);
      } catch (err) {
        nodeStream.destroy();
        const isAbort =
          controller.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message)));
        if (isAbort) {
          const msg = params.signal?.aborted
            ? `REBX worker MP4 upload cancelled (${endpointPath}).`
            : `REBX worker MP4 upload timed out after ${timeoutMs}ms (${endpointPath}).`;
          this.logger.warn(msg, { endpoint: endpointPath, timeoutMs });
          throw new WorkerApiTimeoutError(msg);
        }
        const rawDetail = err instanceof Error ? err.message : "Network upload failed";
        const safeDetail = redactSensitiveString(rawDetail, redactList);
        const msg = `Unable to upload rendered MP4 to REBX API (${endpointPath}): ${safeDetail}`;
        this.logger.error(msg, { endpoint: endpointPath });
        throw new WorkerApiConnectionError(msg);
      }

      const rawText = await readBoundedTextSafe(res, 16 * 1024);
      let parsedJson: unknown = null;
      if (rawText.trim()) {
        try {
          parsedJson = JSON.parse(rawText);
        } catch {
          parsedJson = null;
        }
      }

      if (!res.ok) {
        const serverErrObj =
          parsedJson && typeof parsedJson === "object"
            ? (parsedJson as { error?: unknown; code?: unknown })
            : null;
        const rawServerMsg =
          typeof serverErrObj?.error === "string" && serverErrObj.error.trim()
            ? serverErrObj.error.trim()
            : `HTTP ${res.status} ${res.statusText || "Output upload failed"}`;
        const safeMsg = redactSensitiveString(rawServerMsg, redactList);
        const code = typeof serverErrObj?.code === "string" ? serverErrObj.code : undefined;

        this.logger.warn("REBX worker MP4 upload returned HTTP error", {
          endpoint: endpointPath,
          status: res.status,
          code,
          error: safeMsg,
        });
        throw new WorkerApiHttpError(res.status, safeMsg, code);
      }

      const parsed = workerJobOutputUploadApiResponseSchema.parse(parsedJson);
      if (parsed.upload.fileSizeBytes !== fileSizeBytes) {
        throw new WorkerAssetValidationError(
          "INCOMPLETE_DOWNLOAD",
          `Server reported uploaded MP4 size (${parsed.upload.fileSizeBytes}) does not match local file (${fileSizeBytes}).`,
        );
      }
      if (parsed.upload.checksumSha256.toLowerCase() !== sha256Hex) {
        throw new WorkerAssetValidationError(
          "INCOMPLETE_DOWNLOAD",
          "Server reported uploaded MP4 SHA-256 digest does not match local file.",
        );
      }

      return {
        outputStorageKey: parsed.upload.outputStorageKey,
        provider: parsed.upload.provider,
        fileSizeBytes: parsed.upload.fileSizeBytes,
        checksumSha256: sha256Hex,
        etag: parsed.upload.etag ?? null,
      };
    } finally {
      nodeStream.destroy();
      clearTimeout(timer);
      if (params.signal) {
        params.signal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  /**
   * Downloads a single authorized render asset via streaming HTTP GET using worker authentication,
   * validating Content-Type, byte size limits, Content-Length completeness, and container file signatures
   * before committing the file to `targetFilePath`. Any failed or timed-out partial file is removed.
   */
  async downloadJobAsset(params: {
    jobId: string;
    asset: PlannedSnapshotAsset;
    targetFilePath: string;
    maxBytes?: number;
    timeoutMs?: number;
  }): Promise<DownloadedAssetFile> {
    const cleanJobId = params.jobId?.trim() ?? "";
    if (!cleanJobId || cleanJobId.includes("..") || /[\\/\0\s]/.test(cleanJobId)) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        "Invalid jobId for worker asset download.",
      );
    }

    const asset = params.asset;
    if (!WORKER_SNAPSHOT_ASSET_ID_REGEX.test(asset.assetId)) {
      throw new WorkerAssetValidationError(
        "INVALID_ASSET_REFERENCE",
        "Invalid snapshot assetId for worker asset download.",
      );
    }

    const targetFilePath = path.resolve(params.targetFilePath);
    if (!params.targetFilePath || /[\0]/.test(targetFilePath)) {
      throw new WorkerAssetValidationError(
        "WORKSPACE_PATH_ERROR",
        "Invalid local target file path for worker asset download.",
      );
    }

    const defaultMaxBytes =
      asset.kind === "image" ? WORKER_MAX_IMAGE_BYTES : WORKER_MAX_AUDIO_BYTES;
    const maxBytes = params.maxBytes ?? asset.maxBytes ?? defaultMaxBytes;
    // The timeout covers the whole streamed transfer (images up to 10 MB, audio up to 15 MB),
    // so it needs far more headroom than a small JSON API call. Mirrors the MP4 upload default.
    const timeoutMs = params.timeoutMs ?? Math.max(this.requestTimeoutMs * 4, 60_000);
    const endpointPath = `/api/internal/video-studio/render-jobs/${encodeURIComponent(cleanJobId)}/assets/${encodeURIComponent(asset.assetId)}`;
    const url = `${this.apiBaseUrl}${endpointPath}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const partPath = `${targetFilePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 8)}.part`;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let writeStream: fsSync.WriteStream | null = null;

    const cleanupPartialFiles = async () => {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader = null;
      }
      if (writeStream) {
        const ws = writeStream;
        writeStream = null;
        await closeDestroyedWriteStream(ws);
      }
      await removeFileBestEffort(partPath);
      await removeFileBestEffort(targetFilePath);
    };

    try {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.workerSecret}`,
            "X-REBX-Worker-Id": this.workerId,
            Accept: asset.kind === "image" ? "image/*" : "audio/*",
          },
          redirect: "error",
          signal: controller.signal,
        });
      } catch (err) {
        throw this.mapDownloadFetchError(err, controller.signal, endpointPath, timeoutMs);
      }

      if (!res.ok) {
        const rawErrText = await readBoundedTextSafe(res, 16 * 1024);
        let parsedErr: unknown = null;
        if (rawErrText.trim()) {
          try {
            parsedErr = JSON.parse(rawErrText);
          } catch {
            parsedErr = null;
          }
        }
        const serverErrObj =
          parsedErr && typeof parsedErr === "object"
            ? (parsedErr as { error?: unknown; code?: unknown })
            : null;
        const rawServerMsg =
          typeof serverErrObj?.error === "string" && serverErrObj.error.trim()
            ? serverErrObj.error.trim()
            : `HTTP ${res.status} ${res.statusText || "Asset download failed"}`;
        const safeMsg = redactSensitiveString(rawServerMsg, [this.workerSecret]);
        const code = typeof serverErrObj?.code === "string" ? serverErrObj.code : undefined;

        this.logger.warn("REBX worker asset download returned HTTP error", {
          endpoint: endpointPath,
          assetId: asset.assetId,
          status: res.status,
          code,
          error: safeMsg,
        });
        throw new WorkerApiHttpError(res.status, safeMsg, code);
      }

      const contentTypeCheck = validateAssetContentType(res.headers.get("content-type"), asset);
      if (!contentTypeCheck.ok) {
        await res.body?.cancel().catch(() => {});
        throw new WorkerAssetValidationError("INVALID_CONTENT_TYPE", contentTypeCheck.error);
      }

      let expectedContentLength: number | null = null;
      const rawLengthHeader = res.headers.get("content-length")?.trim() ?? "";
      if (rawLengthHeader) {
        if (!/^\d+$/.test(rawLengthHeader)) {
          await res.body?.cancel().catch(() => {});
          throw new WorkerAssetValidationError(
            "INCOMPLETE_DOWNLOAD",
            `Invalid Content-Length header returned for ${asset.assetId}.`,
          );
        }
        expectedContentLength = Number.parseInt(rawLengthHeader, 10);
        if (expectedContentLength <= 0) {
          await res.body?.cancel().catch(() => {});
          throw new WorkerAssetValidationError(
            "INCOMPLETE_DOWNLOAD",
            `Asset ${asset.assetId} returned empty Content-Length.`,
          );
        }
        if (expectedContentLength > maxBytes) {
          await res.body?.cancel().catch(() => {});
          throw new WorkerAssetValidationError(
            "ASSET_TOO_LARGE",
            `Asset ${asset.assetId} Content-Length (${expectedContentLength} bytes) exceeds limit (${maxBytes} bytes).`,
          );
        }
      }

      await fsPromises.mkdir(path.dirname(targetFilePath), { recursive: true });
      const ws = fsSync.createWriteStream(partPath, { flags: "wx", mode: 0o600 });
      writeStream = ws;

      let streamFailed: Error | null = null;
      ws.on("error", (err) => {
        streamFailed = err instanceof Error ? err : new Error("Temp file write error");
      });

      const PEEK_LIMIT_BYTES = 1024;
      const peekChunks: Buffer[] = [];
      let peekBytes = 0;
      let receivedBytes = 0;

      if (res.body) {
        reader = res.body.getReader();
        while (true) {
          let readRes: { done: boolean; value?: Uint8Array };
          try {
            readRes = await readChunkWithAbortSignal(reader, controller.signal);
          } catch (err) {
            throw this.mapDownloadFetchError(err, controller.signal, endpointPath, timeoutMs);
          }

          if (readRes.done) break;
          const chunk = readRes.value;
          if (!chunk || chunk.byteLength === 0) continue;

          receivedBytes += chunk.byteLength;
          if (receivedBytes > maxBytes) {
            controller.abort();
            throw new WorkerAssetValidationError(
              "ASSET_TOO_LARGE",
              `Asset ${asset.assetId} exceeded maximum allowed size (${maxBytes} bytes) during download.`,
            );
          }

          if (peekBytes < PEEK_LIMIT_BYTES) {
            const needed = Math.min(PEEK_LIMIT_BYTES - peekBytes, chunk.byteLength);
            peekChunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, needed));
            peekBytes += needed;
          }

          if (streamFailed) throw streamFailed;
          await writeChunkAsync(ws, chunk);
        }
        reader = null;
      } else {
        let ab: ArrayBuffer;
        try {
          ab = await res.arrayBuffer();
        } catch (err) {
          throw this.mapDownloadFetchError(err, controller.signal, endpointPath, timeoutMs);
        }
        const buf = Buffer.from(ab);
        receivedBytes = buf.byteLength;
        if (receivedBytes > maxBytes) {
          throw new WorkerAssetValidationError(
            "ASSET_TOO_LARGE",
            `Asset ${asset.assetId} exceeded maximum allowed size (${maxBytes} bytes).`,
          );
        }
        if (receivedBytes > 0) {
          peekChunks.push(buf.subarray(0, Math.min(PEEK_LIMIT_BYTES, receivedBytes)));
          await writeChunkAsync(ws, buf);
        }
      }

      if (streamFailed) throw streamFailed;
      await closeWriteStreamAsync(ws);
      writeStream = null;

      if (receivedBytes <= 0) {
        throw new WorkerAssetValidationError(
          "INCOMPLETE_DOWNLOAD",
          `Asset ${asset.assetId} downloaded 0 bytes.`,
        );
      }

      if (expectedContentLength !== null && receivedBytes !== expectedContentLength) {
        throw new WorkerAssetValidationError(
          "INCOMPLETE_DOWNLOAD",
          `Asset ${asset.assetId} download was interrupted (received ${receivedBytes} of ${expectedContentLength} bytes).`,
        );
      }

      const headerBuf = Buffer.concat(peekChunks);
      if (!verifyAssetBinarySignature(headerBuf, asset.format)) {
        throw new WorkerAssetValidationError(
          "INVALID_FILE_SIGNATURE",
          `Asset ${asset.assetId} failed binary ${asset.format.toUpperCase()} signature validation.`,
        );
      }

      await fsPromises.rename(partPath, targetFilePath);

      return {
        assetId: asset.assetId,
        kind: asset.kind,
        format: asset.format,
        contentType: contentTypeCheck.mimeType,
        filePath: targetFilePath,
        fileSizeBytes: receivedBytes,
      };
    } catch (err) {
      await cleanupPartialFiles();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapDownloadFetchError(
    err: unknown,
    signal: AbortSignal,
    endpointPath: string,
    timeoutMs: number,
  ): Error {
    const isAbort =
      signal.aborted ||
      (err instanceof Error && (err.name === "AbortError" || /abort/i.test(err.message)));

    if (isAbort) {
      const msg = `REBX worker asset download timed out after ${timeoutMs}ms (${endpointPath}).`;
      this.logger.warn(msg, { endpoint: endpointPath, timeoutMs });
      return new WorkerApiTimeoutError(msg);
    }

    const rawDetail = err instanceof Error ? err.message : "Network download error";
    const safeDetail = redactSensitiveString(rawDetail, [this.workerSecret]);
    const msg = `Unable to download asset from REBX API (${endpointPath}): ${safeDetail}`;
    this.logger.error(msg, { endpoint: endpointPath });
    return new WorkerApiConnectionError(msg);
  }
}

async function readBoundedTextSafe(res: Response, maxChars: number): Promise<string> {
  try {
    if (!res.body) {
      const txt = await res.text();
      return txt.slice(0, maxChars);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = "";
    while (out.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.length >= maxChars) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return out.slice(0, maxChars);
  } catch {
    return "";
  }
}

async function readChunkWithAbortSignal(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
  if (signal.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  let onAbort: (() => void) | null = null;
  try {
    return await new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
      onAbort = () => {
        void reader.cancel().catch(() => {});
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      reader.read().then(
        (r) => resolve(r as { done: boolean; value?: Uint8Array }),
        reject,
      );
    });
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function writeChunkAsync(ws: fsSync.WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      ws.off("drain", onDrain);
      reject(err);
    };
    const onDrain = () => {
      ws.off("error", onError);
      resolve();
    };
    ws.once("error", onError);
    const ok = ws.write(chunk);
    if (ok) {
      ws.off("error", onError);
      resolve();
    } else {
      ws.once("drain", onDrain);
    }
  });
}

function closeWriteStreamAsync(ws: fsSync.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onFinish = () => {
      ws.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      ws.off("finish", onFinish);
      reject(err);
    };
    ws.once("finish", onFinish);
    ws.once("error", onError);
    ws.end();
  });
}

function closeDestroyedWriteStream(ws: fsSync.WriteStream): Promise<void> {
  if (ws.closed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off("close", finish);
      ws.off("error", finish);
      resolve();
    };
    const timer = setTimeout(finish, 1000);
    ws.once("close", finish);
    ws.once("error", finish);
    if (!ws.destroyed) {
      ws.destroy();
    }
  });
}

async function removeFileBestEffort(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fsPromises.rm(filePath, { force: true });
      return;
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}

async function computeLocalFileSha256AndSize(
  filePath: string,
): Promise<{ fileSizeBytes: number; sha256Hex: string }> {
  return new Promise((resolve, reject) => {
    const hasher = createHash("sha256");
    let fileSizeBytes = 0;
    const rs = fsSync.createReadStream(filePath);
    rs.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      fileSizeBytes += buf.byteLength;
      hasher.update(buf);
    });
    rs.once("end", () => {
      resolve({ fileSizeBytes, sha256Hex: hasher.digest("hex") });
    });
    rs.once("error", reject);
  });
}

function nodeFileReadableToWebStream(
  nodeStream: fsSync.ReadStream,
  abortSignal: AbortSignal,
): ReadableStream<Uint8Array> {
  let closed = false;
  let onAbort: (() => void) | null = null;

  const cleanup = () => {
    if (onAbort) {
      abortSignal.removeEventListener("abort", onAbort);
      onAbort = null;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (!closed) {
          closed = true;
          controller.error(new Error("Upload stream aborted."));
        }
        nodeStream.destroy();
        cleanup();
      };

      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener("abort", onAbort, { once: true });

      nodeStream.on("data", (chunk: Buffer | string) => {
        if (closed) return;
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if (buf.byteLength > 0) {
          controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        }
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          nodeStream.pause();
        }
      });

      nodeStream.once("end", () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
        cleanup();
      });

      nodeStream.once("error", (err) => {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
        cleanup();
      });
    },
    pull() {
      if (!closed) {
        nodeStream.resume();
      }
    },
    cancel() {
      closed = true;
      cleanup();
      nodeStream.destroy();
    },
  });
}

