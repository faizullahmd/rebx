import { NextResponse, type NextRequest } from "next/server";
import {
  RenderAssetStreamError,
  uploadPrivateRenderVideoStream,
  verifyStoredRenderVideoObject,
} from "@/lib/video-studio/deps";
import {
  authorizeWorkerJobOutputUpload,
  finalizeWorkerJobOutputUpload,
  RenderJobWorkerError,
} from "@/lib/video-studio/render-jobs";
import {
  buildRenderOutputTargetKey,
  MAX_RENDER_OUTPUT_VIDEO_BYTES,
} from "@/lib/video-studio/render-validation";
import {
  authenticateRenderWorkerRequest,
  WORKER_NO_STORE_HEADERS,
  workerUnauthorizedResponse,
} from "@/lib/video-studio/worker-auth";

export const dynamic = "force-dynamic";

async function handleWorkerOutputUpload(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const auth = authenticateRenderWorkerRequest(req);
  if (!auth.ok) {
    return workerUnauthorizedResponse(auth);
  }

  const { jobId } = await context.params;
  const workerId = req.headers.get("x-rebx-worker-id")?.trim() ?? "";
  if (!workerId) {
    return NextResponse.json(
      { ok: false, code: "MISSING_WORKER_ID", error: "Missing required X-REBX-Worker-Id header." },
      { status: 400, headers: WORKER_NO_STORE_HEADERS },
    );
  }

  const rawContentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (rawContentType !== "video/mp4") {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CONTENT_TYPE",
        error: `Render output upload requires Content-Type: video/mp4 (received "${rawContentType || "none"}").`,
      },
      { status: 415, headers: WORKER_NO_STORE_HEADERS },
    );
  }

  let contentLength: number | null = null;
  const rawLength = req.headers.get("content-length")?.trim() ?? "";
  if (rawLength) {
    if (!/^\d+$/.test(rawLength)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_CONTENT_LENGTH", error: "Invalid Content-Length header." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      );
    }
    contentLength = Number.parseInt(rawLength, 10);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return NextResponse.json(
        { ok: false, code: "EMPTY_UPLOAD", error: "Render MP4 upload Content-Length must be positive." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      );
    }
    if (contentLength > MAX_RENDER_OUTPUT_VIDEO_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          code: "OUTPUT_TOO_LARGE",
          error: `Render MP4 upload exceeds limit of ${MAX_RENDER_OUTPUT_VIDEO_BYTES} bytes.`,
        },
        { status: 413, headers: WORKER_NO_STORE_HEADERS },
      );
    }
  }

  const rawExpectedSha = req.headers.get("x-rebx-content-sha256")?.trim().toLowerCase() || null;
  if (rawExpectedSha && !/^[a-f0-9]{64}$/.test(rawExpectedSha)) {
    return NextResponse.json(
      {
        ok: false,
        code: "INVALID_CHECKSUM_HEADER",
        error: "X-REBX-Content-SHA256 must be a valid 64-character hex digest.",
      },
      { status: 400, headers: WORKER_NO_STORE_HEADERS },
    );
  }

  try {
    const authorized = await authorizeWorkerJobOutputUpload({
      jobId,
      workerId,
    });

    const canonicalKey = buildRenderOutputTargetKey(authorized.projectId, authorized.jobId);

    // Idempotent upload retry reuse: if a valid matching MP4 object already exists for this exact job,
    // verify it authoritatively and return 200 without creating duplicate files or corrupting state.
    if (rawExpectedSha) {
      try {
        const alreadyStored = await verifyStoredRenderVideoObject({
          outputStorageKey: authorized.existingOutputStorageKey ?? canonicalKey,
          projectId: authorized.projectId,
          jobId: authorized.jobId,
          expectedProvider: authorized.expectedProvider,
          expectedSizeBytes: contentLength ?? authorized.existingFileSizeBytes,
          expectedSha256: rawExpectedSha,
        });

        await req.body?.cancel().catch(() => {});

        const reusedUpload = {
          outputStorageKey: alreadyStored.outputStorageKey,
          provider: alreadyStored.provider,
          fileSizeBytes: alreadyStored.fileSizeBytes,
          checksumSha256: alreadyStored.checksumSha256 ?? rawExpectedSha,
          etag: alreadyStored.etag,
        };

        if (!authorized.alreadyCompleted) {
          await finalizeWorkerJobOutputUpload({
            jobId: authorized.jobId,
            projectId: authorized.projectId,
            workerId,
            upload: reusedUpload,
          });
        }

        return NextResponse.json(
          { ok: true, idempotentReuse: true, upload: reusedUpload },
          { status: 200, headers: WORKER_NO_STORE_HEADERS },
        );
      } catch {
        // Object does not yet exist cleanly or differs — if job was already COMPLETED with a different asset, reject;
        // otherwise proceed with fresh verified upload.
        if (authorized.alreadyCompleted) {
          return NextResponse.json(
            {
              ok: false,
              code: "ALREADY_COMPLETED",
              error: "Render job is already completed with a different stored MP4.",
            },
            { status: 409, headers: WORKER_NO_STORE_HEADERS },
          );
        }
      }
    } else if (authorized.alreadyCompleted) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_STATUS",
          error: "Render job is already completed; upload requires X-REBX-Content-SHA256 for idempotent check.",
        },
        { status: 409, headers: WORKER_NO_STORE_HEADERS },
      );
    }

    if (!req.body) {
      return NextResponse.json(
        { ok: false, code: "EMPTY_UPLOAD", error: "Missing request body stream for MP4 upload." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      );
    }

    const upload = await uploadPrivateRenderVideoStream({
      projectId: authorized.projectId,
      jobId: authorized.jobId,
      expectedProvider: authorized.expectedProvider,
      stream: req.body,
      contentLength,
      expectedSha256: rawExpectedSha,
      signal: req.signal,
    });

    await finalizeWorkerJobOutputUpload({
      jobId: authorized.jobId,
      projectId: authorized.projectId,
      workerId,
      upload,
    });

    return NextResponse.json(
      { ok: true, idempotentReuse: false, upload },
      { status: 200, headers: WORKER_NO_STORE_HEADERS },
    );
  } catch (err) {
    if (err instanceof RenderJobWorkerError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode, headers: WORKER_NO_STORE_HEADERS },
      );
    }
    if (err instanceof RenderAssetStreamError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode, headers: WORKER_NO_STORE_HEADERS },
      );
    }

    console.error(
      "[video-studio-worker-output] Unexpected error uploading render output:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return NextResponse.json(
      { ok: false, error: "Internal error uploading rendered MP4 output." },
      { status: 500, headers: WORKER_NO_STORE_HEADERS },
    );
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  return handleWorkerOutputUpload(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  return handleWorkerOutputUpload(req, context);
}

