import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import {
  openAdminRenderVideoStream,
  prisma,
  RenderAssetStreamError,
} from "@/lib/video-studio/deps";

export const dynamic = "force-dynamic";

const VIDEO_SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

function sanitizeDownloadFilename(title: string, jobId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const shortId = jobId.replace(/[^a-zA-Z0-9_-]/g, "").slice(-10) || "render";
  return `${slug || "rebx-video"}-${shortId}.mp4`;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: VIDEO_SECURITY_HEADERS },
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
      { status: 401, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  if (currentUser.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Forbidden: Administrator access required." },
      { status: 403, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  const { jobId } = await context.params;
  const cleanJobId = jobId?.trim() ?? "";
  if (!cleanJobId || cleanJobId.length > 128 || /[\\/\0\s.]/.test(cleanJobId.replace(/[-_a-zA-Z0-9]/g, ""))) {
    return NextResponse.json(
      { error: "Invalid render job ID." },
      { status: 400, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  const job = await prisma.videoRenderJob.findUnique({
    where: { id: cleanJobId },
    select: {
      id: true,
      projectId: true,
      status: true,
      outputStorageKey: true,
      project: { select: { title: true } },
    },
  });

  if (!job) {
    return NextResponse.json(
      { error: "Render job not found." },
      { status: 404, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  if (job.status !== "COMPLETED") {
    return NextResponse.json(
      {
        error: `Render job video is unavailable until rendering completes (current status: ${job.status}).`,
      },
      { status: 409, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  if (!job.outputStorageKey?.trim()) {
    return NextResponse.json(
      { error: "Completed render job has no stored MP4 output key." },
      { status: 404, headers: VIDEO_SECURITY_HEADERS },
    );
  }

  const downloadMode = req.nextUrl.searchParams.get("download") === "1";
  const filename = sanitizeDownloadFilename(job.project?.title ?? "rebx-video", job.id);
  const disposition = `${downloadMode ? "attachment" : "inline"}; filename="${filename}"`;

  try {
    const opened = await openAdminRenderVideoStream({
      outputStorageKey: job.outputStorageKey,
      projectId: job.projectId,
      jobId: job.id,
      rangeHeader: req.headers.get("range"),
      signal: req.signal,
    });

    const headers = new Headers({
      ...VIDEO_SECURITY_HEADERS,
      "Content-Type": opened.contentType,
      "Content-Length": String(opened.contentLength),
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    });

    if (opened.contentRange) {
      headers.set("Content-Range", opened.contentRange);
    }

    return new NextResponse(opened.stream, {
      status: opened.status,
      headers,
    });
  } catch (err) {
    if (err instanceof RenderAssetStreamError) {
      if (err.statusCode === 416) {
        const totalSize = (err as RenderAssetStreamError & { totalSize?: number }).totalSize;
        return new NextResponse(null, {
          status: 416,
          headers: {
            ...VIDEO_SECURITY_HEADERS,
            ...(typeof totalSize === "number" ? { "Content-Range": `bytes */${totalSize}` } : {}),
          },
        });
      }
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode, headers: VIDEO_SECURITY_HEADERS },
      );
    }

    console.error(
      "[video-studio-admin-video] Failed to stream rendered video:",
      err instanceof Error ? err.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Failed to stream rendered MP4 video." },
      { status: 500, headers: VIDEO_SECURITY_HEADERS },
    );
  }
}

