import { NextResponse, type NextRequest } from "next/server";
import { openSnapshotAssetStream, RenderAssetStreamError } from "@/lib/video-studio/deps";
import {
  authorizeWorkerJobAssetDownload,
  RenderJobWorkerError,
} from "@/lib/video-studio/render-jobs";
import {
  authenticateRenderWorkerRequest,
  WORKER_NO_STORE_HEADERS,
  workerUnauthorizedResponse,
} from "@/lib/video-studio/worker-auth";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  ...WORKER_NO_STORE_HEADERS,
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

const FORBIDDEN_DIRECT_REF_PARAMS = [
  "key",
  "path",
  "url",
  "file",
  "src",
  "storageKey",
  "filename",
  "sourceUrl",
] as const;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ jobId: string; assetId: string }> },
) {
  const auth = authenticateRenderWorkerRequest(req);
  if (!auth.ok) {
    return workerUnauthorizedResponse(auth);
  }

  for (const paramName of FORBIDDEN_DIRECT_REF_PARAMS) {
    if (req.nextUrl.searchParams.has(paramName)) {
      return NextResponse.json(
        {
          ok: false,
          code: "UNSUPPORTED_QUERY_PARAM",
          error: "Direct filesystem paths, storage keys, and external URLs are not accepted.",
        },
        { status: 400, headers: SECURITY_HEADERS },
      );
    }
  }

  const headerWorkerId = req.headers.get("x-rebx-worker-id")?.trim() ?? "";
  const queryWorkerId = req.nextUrl.searchParams.get("workerId")?.trim() ?? "";
  if (headerWorkerId && queryWorkerId && headerWorkerId !== queryWorkerId) {
    return NextResponse.json(
      {
        ok: false,
        code: "WORKER_ID_MISMATCH",
        error: "Worker ID header and query parameter do not match.",
      },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  const workerId = headerWorkerId || queryWorkerId;
  const { jobId, assetId } = await context.params;

  try {
    const authorized = await authorizeWorkerJobAssetDownload({
      jobId,
      assetId,
      workerId,
    });

    const opened = await openSnapshotAssetStream({
      asset: authorized.asset,
      signal: req.signal,
    });

    const headers = new Headers({
      ...SECURITY_HEADERS,
      "Content-Type": opened.contentType,
      "Content-Disposition": `attachment; filename="${opened.safeFilename}"`,
      "X-REBX-Asset-Id": authorized.asset.assetId,
      "X-REBX-Asset-Kind": authorized.asset.kind,
    });

    if (opened.contentLength !== null) {
      headers.set("Content-Length", String(opened.contentLength));
    }

    return new NextResponse(opened.stream, {
      status: 200,
      headers,
    });
  } catch (err) {
    if (err instanceof RenderJobWorkerError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
        },
        { status: err.statusCode, headers: SECURITY_HEADERS },
      );
    }

    if (err instanceof RenderAssetStreamError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
        },
        { status: err.statusCode, headers: SECURITY_HEADERS },
      );
    }

    console.error(
      "[video-studio-worker-asset] Unexpected streaming error:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL_ASSET_ERROR",
        error: "Failed to stream render asset.",
      },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

