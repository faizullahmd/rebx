import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  openPrivateSceneImagePreviewStream,
  prisma,
  readPrivateStudioAsset,
  RenderAssetStreamError,
} from "@/lib/video-studio/deps";
import { extractProjectThumbnail } from "@/lib/video-studio/schemas";

export const dynamic = "force-dynamic";

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> },
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

  const { projectId } = await context.params;
  const cleanProjectId = projectId?.trim() ?? "";
  if (!cleanProjectId || cleanProjectId.length > 128) {
    return NextResponse.json(
      { error: "Invalid project ID." },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: cleanProjectId },
    select: {
      id: true,
      metadata: true,
      scenes: {
        orderBy: [{ order: "asc" }, { position: "asc" }],
        select: { imageUrl: true, imagePath: true },
        take: 1,
      },
    },
  });

  if (!project) {
    return NextResponse.json(
      { error: "Project not found." },
      { status: 404, headers: SECURITY_HEADERS },
    );
  }

  const customThumb = extractProjectThumbnail(project.metadata);
  if (customThumb?.storageKey) {
    try {
      const buffer = await readPrivateStudioAsset(customThumb.storageKey);
      const headers = new Headers({
        ...SECURITY_HEADERS,
        "Content-Type": customThumb.mimeType || "image/jpeg",
        "Content-Length": String(buffer.length),
        "Content-Disposition": 'inline; filename="thumbnail.jpg"',
      });
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers,
      });
    } catch (err) {
      console.error("[video-studio-thumbnail] Failed to read custom thumbnail asset:", err);
      return NextResponse.json(
        { error: "Failed to load custom thumbnail asset." },
        { status: 500, headers: SECURITY_HEADERS },
      );
    }
  }

  // Fallback to auto-generated thumbnail from the first scene image
  const firstScene = project.scenes[0] ?? null;
  const sceneImgUrl = firstScene ? (firstScene.imageUrl || firstScene.imagePath || null) : null;
  if (!sceneImgUrl) {
    return NextResponse.json(
      { error: "No thumbnail available for this project." },
      { status: 404, headers: SECURITY_HEADERS },
    );
  }

  // If the scene image is a local private image, stream it directly through the authenticated channel
  const match = /\/api\/admin\/video-studio\/image\/([^/?#]+)/.exec(sceneImgUrl);
  if (match) {
    try {
      const opened = await openPrivateSceneImagePreviewStream({
        rawFilename: match[1],
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
    } catch (streamErr) {
      if (streamErr instanceof RenderAssetStreamError) {
        return NextResponse.json(
          { error: streamErr.message, code: streamErr.code },
          { status: streamErr.statusCode, headers: SECURITY_HEADERS },
        );
      }
    }
  }

  // Otherwise redirect to the scene image preview URL
  return NextResponse.redirect(new URL(sceneImgUrl, req.url));
}

