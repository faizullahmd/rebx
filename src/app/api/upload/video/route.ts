import { NextResponse, type NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { auth } from "@/auth";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No video file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload a video file (MP4, WebM, MOV, etc.)." },
        { status: 400 }
      );
    }

    if (file.size > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: "Video file exceeds maximum size of 100MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Sanitize extension and filename
    const originalExt = path.extname(file.name) || ".mp4";
    const cleanExt = originalExt.toLowerCase().replace(/[^a-z0-9.]/g, "");
    const fileName = `${Date.now()}-${randomUUID()}${cleanExt}`;

    const uploadDir = path.join(process.cwd(), "public", "uploads", "videos");
    await mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/videos/${fileName}`;

    return NextResponse.json({
      url: publicUrl,
      fileName: file.name,
      size: file.size,
    });
  } catch (error: unknown) {
    console.error("Video upload error:", error);
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to upload video" },
      { status: 500 }
    );
  }
}
