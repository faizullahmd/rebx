import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { RenderJobWorkerError } from "@/lib/video-studio/render-jobs";
import {
  authenticateRenderWorkerRequest,
  WORKER_NO_STORE_HEADERS,
  workerUnauthorizedResponse,
} from "@/lib/video-studio/worker-auth";

export async function parseWorkerJsonBody(
  req: NextRequest,
  opts: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; response: NextResponse }> {
  let rawText: string;
  try {
    rawText = await req.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Failed to read request body." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      ),
    };
  }

  if (!rawText.trim()) {
    if (opts.allowEmpty) {
      return { ok: true, data: {} };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Request body must be valid JSON." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Malformed JSON request body." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      ),
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Request body must be a JSON object." },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      ),
    };
  }

  return { ok: true, data: parsed as Record<string, unknown> };
}

export async function handleWorkerPost(
  req: NextRequest,
  handler: (body: Record<string, unknown>) => Promise<NextResponse>,
  opts: { allowEmptyBody?: boolean } = {},
): Promise<NextResponse> {
  const auth = authenticateRenderWorkerRequest(req);
  if (!auth.ok) {
    return workerUnauthorizedResponse(auth);
  }

  const parsedBody = await parseWorkerJsonBody(req, { allowEmpty: opts.allowEmptyBody });
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  try {
    return await handler(parsedBody.data);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          ok: false,
          code: "VALIDATION_ERROR",
          error: err.issues[0]?.message ?? "Invalid worker request payload.",
        },
        { status: 400, headers: WORKER_NO_STORE_HEADERS },
      );
    }

    if (err instanceof RenderJobWorkerError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
        },
        { status: err.statusCode, headers: WORKER_NO_STORE_HEADERS },
      );
    }

    // Never log full request or auth headers — log safe operation error only.
    console.error("[video-studio-worker-api] Unexpected error:", err instanceof Error ? err.message : "Unknown error");
    return NextResponse.json(
      { ok: false, error: "Internal worker coordination error." },
      { status: 500, headers: WORKER_NO_STORE_HEADERS },
    );
  }
}

