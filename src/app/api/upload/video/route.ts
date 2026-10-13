import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import path from "path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@/auth";
import { s3Client, SPACES_BUCKET, buildPublicUrl, describeStorageError } from "@/lib/storage";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as { role?: string }).role;
    if (role !== "AGENT" && role !== "DEVELOPER" && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only agents and developers can upload videos." },
        { status: 403 }
      );
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

    // The app's disk is ephemeral on DigitalOcean, so videos must live in Spaces.
    if (!SPACES_BUCKET || !SPACES_BUCKET.trim() || !process.env.SPACES_KEY) {
      return NextResponse.json(
        {
          error:
            "Cloud storage (DigitalOcean Spaces) is not configured. Please configure SPACES_KEY, SPACES_SECRET, and SPACES_BUCKET in your environment.",
        },
        { status: 503 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const originalExt = path.extname(file.name) || ".mp4";
    const cleanExt = originalExt.toLowerCase().replace(/[^a-z0-9.]/g, "");
    const key = `videos/${session.user.id}/${Date.now()}-${randomUUID()}${cleanExt}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        ACL: "public-read",
      })
    );

    return NextResponse.json({
      url: buildPublicUrl(key),
      fileName: file.name,
      size: file.size,
    });
  } catch (error: unknown) {
    const detail = describeStorageError(error);
    console.error("Video upload error:", detail, error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
