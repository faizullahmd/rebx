import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, SPACES_BUCKET, buildPublicUrl, describeStorageError } from "@/lib/storage";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9.\-_]/g, "-").slice(-80);
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as { role?: string }).role;
    if (role !== "AGENT" && role !== "DEVELOPER" && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only agents and developers can upload listing photos." },
        { status: 403 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Invalid file type. Please upload an image file (JPG, PNG, WebP, etc.)." },
        { status: 400 }
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image file exceeds maximum size of 8MB." },
        { status: 400 }
      );
    }

    // Require DigitalOcean Spaces / S3 cloud storage
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
    const safeName = sanitizeFileName(file.name);
    const key = `listings/${session.user.id}/${randomUUID()}-${safeName}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: file.type,
        ACL: "public-read",
      })
    );

    const publicUrl = buildPublicUrl(key);

    return NextResponse.json({
      url: publicUrl,
      fileName: file.name,
      size: file.size,
    });
  } catch (error: unknown) {
    const detail = describeStorageError(error);
    console.error("Image upload error:", detail, error);
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
