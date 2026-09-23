import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.SPACES_REGION ?? "";
const bucket = process.env.SPACES_BUCKET ?? "";

export const SPACES_BUCKET = bucket;

export const s3Client = new S3Client({
  region: "us-east-1", // DO Spaces ignores this but the SDK requires a value
  endpoint: `https://${region}.digitaloceanspaces.com`,
  credentials: {
    accessKeyId: process.env.SPACES_KEY ?? "",
    secretAccessKey: process.env.SPACES_SECRET ?? "",
  },
});

export function buildPublicUrl(key: string) {
  if (process.env.SPACES_CDN_ENDPOINT) {
    return `https://${process.env.SPACES_CDN_ENDPOINT}/${key}`;
  }
  return `https://${bucket}.${region}.digitaloceanspaces.com/${key}`;
}
