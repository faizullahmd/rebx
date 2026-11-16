import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  openPrivateSceneImagePreviewStream,
  prisma,
  RenderAssetStreamError,
} from "@/lib/video-studio/deps";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ filename: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: SECURITY_HEADERS },
    );
  }

  const numericId = Number(session.user.id);
  const currentUser = Number.isNaN(numericId)
    ? null
    : await prisma.user.findUnique({
        where: { id: numericId },
        select: { id: true, role: true },
      });

  if (!currentUser) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: SECURITY_HEADERS },
    );
  }

  if (currentUser.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden: Administrator access required." },
      { status: 403, headers: SECURITY_HEADERS },
    );
  }

  const { filename } = await context.params;

  try {
    const opened = await openPrivateSceneImagePreviewStream({
      rawFilename: filename ?? "",
      signal: req.signal,
    });

    const headers = new Headers({
      ...SECURITY_HEADERS,
      "Content-Type": opened.contentType,
      "Content-Disposition": `inline; filename="${opened.safeFilename}"`,
    });

    if (opened.contentLength !== null) {
      headers.set("Content-Length", String(opened.contentLength));
    }

    return new NextResponse(opened.stream, {
      status: 200,
      headers,
    });
  } catch (err) {
    if (err instanceof RenderAssetStreamError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode, headers: SECURITY_HEADERS },
      );
    }

    console.error(
      "[video-studio-image] Failed to stream private scene image:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Failed to load image asset." },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}

