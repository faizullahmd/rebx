"use server";

import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireRole } from "@/lib/session";
import { s3Client, SPACES_BUCKET, buildPublicUrl } from "@/lib/storage";

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9.\-_]/g, "-").slice(-100);
}

export async function createUploadUrl(fileName: string, contentType: string) {
  const agent = await requireRole("AGENT");

  if (!contentType.startsWith("image/")) {
    throw new Error("Only image files can be uploaded.");
  }

  const key = `listings/${agent.id}/${randomUUID()}-${sanitizeFileName(fileName)}`;

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      ContentType: contentType,
      ACL: "public-read",
    }),
    // DigitalOcean Spaces only honors ACL when it's a real request header, not a hoisted
    // query param (the SDK's default) — force it to stay a header the client must send.
    { expiresIn: 300, unhoistableHeaders: new Set(["x-amz-acl"]) }
  );

  return { uploadUrl, publicUrl: buildPublicUrl(key) };
}
