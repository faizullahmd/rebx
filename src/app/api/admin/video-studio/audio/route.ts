import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma, readPrivateStudioAsset } from "@/lib/video-studio/deps";
import { extractSceneAudioMap } from "@/lib/video-studio/schemas";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
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
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  if (currentUser.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden: Administrator access required." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const projectId = req.nextUrl.searchParams.get("projectId")?.trim() ?? "";
  const sceneId = req.nextUrl.searchParams.get("sceneId")?.trim() ?? "";
  if (!projectId || !sceneId) {
    return NextResponse.json({ error: "Missing projectId or sceneId." }, { status: 400 });
  }

  const scene = await prisma.videoScene.findFirst({
    where: { id: sceneId, projectId },
    select: { id: true },
  });
  if (!scene) {
    return NextResponse.json({ error: "Scene not found in project." }, { status: 404 });
  }

  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  const audioMeta = extractSceneAudioMap(project?.metadata)[sceneId];
  if (!audioMeta?.storageKey) {
    return NextResponse.json({ error: "Scene voiceover audio not found." }, { status: 404 });
  }

  let buffer: Buffer;
  try {
    buffer = await readPrivateStudioAsset(audioMeta.storageKey);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      return NextResponse.json({ error: "Audio file no longer exists in storage." }, { status: 404 });
    }
    console.error("[video-studio-audio] Failed to read audio asset:", err);
    return NextResponse.json({ error: "Failed to load audio asset." }, { status: 500 });
  }

  const totalSize = buffer.length;
  const contentType = audioMeta.mimeType || "audio/mpeg";
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalSize}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const startRaw = match[1];
    const endRaw = match[2];
    let start = startRaw ? Number.parseInt(startRaw, 10) : 0;
    let end = endRaw ? Number.parseInt(endRaw, 10) : totalSize - 1;

    if (!startRaw && endRaw) {
      const suffixLen = Number.parseInt(endRaw, 10);
      start = Math.max(0, totalSize - suffixLen);
      end = totalSize - 1;
    }

    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start < 0 ||
      end < start ||
      start >= totalSize
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${totalSize}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    end = Math.min(end, totalSize - 1);
    const slice = buffer.subarray(start, end + 1);

    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": String(slice.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(totalSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

