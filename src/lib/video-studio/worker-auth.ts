import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const WORKER_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
} as const;

export type WorkerAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; error: string };

const MAX_AUTH_HEADER_LENGTH = 4096;

/**
 * Constant-time string comparison using fixed-length SHA-256 digests so
 * comparison duration never leaks whether the presented token matches or its length.
 */
export function constantTimeSecretEqual(presented: string, expected: string): boolean {
  const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

/**
 * Pure authentication verifier for incoming worker HTTP requests.
 * Fails closed if RENDER_WORKER_ENABLED !== "true" or RENDER_WORKER_SECRET is unset.
 * Never returns or logs secrets or authorization headers.
 */
export function verifyWorkerAuthHeaders(params: {
  authHeader: string | null | undefined;
  workerEnabled: string | undefined;
  configuredSecret: string | undefined;
}): WorkerAuthResult {
  const rawAuth = params.authHeader ?? "";
  if (!rawAuth || rawAuth.length > MAX_AUTH_HEADER_LENGTH) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: Missing or malformed worker bearer token.",
    };
  }

  const bearerMatch = /^Bearer\s+(\S+)$/i.exec(rawAuth.trim());
  if (!bearerMatch?.[1]) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized: Authorization header must use Bearer scheme.",
    };
  }

  const enabled = params.workerEnabled?.trim().toLowerCase() === "true";
  if (!enabled) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: Render worker coordination is disabled.",
    };
  }

  const configuredSecret = params.configuredSecret?.trim() ?? "";
  if (!configuredSecret) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: Server worker authentication secret is not configured.",
    };
  }

  if (!constantTimeSecretEqual(bearerMatch[1], configuredSecret)) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: Invalid worker credentials.",
    };
  }

  return { ok: true };
}

export function authenticateRenderWorkerRequest(req: Request): WorkerAuthResult {
  return verifyWorkerAuthHeaders({
    authHeader: req.headers.get("authorization"),
    workerEnabled: process.env.RENDER_WORKER_ENABLED,
    configuredSecret: process.env.RENDER_WORKER_SECRET,
  });
}

export function workerUnauthorizedResponse(auth: Extract<WorkerAuthResult, { ok: false }>) {
  return NextResponse.json(
    { ok: false, error: auth.error },
    { status: auth.status, headers: WORKER_NO_STORE_HEADERS },
  );
}

