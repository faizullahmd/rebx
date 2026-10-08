import { NextResponse, type NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client, SPACES_BUCKET, buildPublicUrl } from "@/lib/storage";

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

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalExt = path.extname(file.name) || ".jpg";
    const cleanExt = originalExt.toLowerCase().replace(/[^a-z0-9.]/g, "");
    const safeName = sanitizeFileName(file.name);
    const fileName = `${Date.now()}-${randomUUID()}${cleanExt}`;

    // If DigitalOcean Spaces is fully configured with a bucket, upload there
    if (SPACES_BUCKET && SPACES_BUCKET.trim().length > 0 && process.env.SPACES_KEY) {
      try {
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
      } catch (s3Error) {
        console.warn("Spaces upload failed, falling back to local storage:", s3Error);
      }
    }

    // Default & fallback: Save locally in public/uploads/images
    const uploadDir = path.join(process.cwd(), "public", "uploads", "images");
    await mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);

    const publicUrl = `/uploads/images/${fileName}`;

    return NextResponse.json({
      url: publicUrl,
      fileName: file.name,
      size: file.size,
    });
  } catch (error: unknown) {
    console.error("Image upload error:", error);
    return NextResponse.json(
      { error: (error as Error)?.message || "Failed to upload image" },
      { status: 500 }
    );
  }
}
