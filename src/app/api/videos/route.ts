import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAttachVideo } from "@/lib/video";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canAttachVideo(session.user.role)) {
    return NextResponse.json({ error: "Forbidden: role not permitted to attach videos" }, { status: 403 });
  }

  try {
    const videos = await prisma.video.findMany({
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(videos);
  } catch (error) {
    console.error("GET /api/videos error:", error);
    return NextResponse.json({ error: "Failed to fetch gallery videos" }, { status: 500 });
  }
}
