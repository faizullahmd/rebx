import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

const region = process.env.SPACES_REGION || "nyc3";
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

// The SDK often reports "UnknownError" for non-XML responses, so include the HTTP status
// and a safe summary of the Spaces config (never the key or secret values) to make the
// real cause diagnosable from the UI.
export function describeStorageError(error: unknown) {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number }; code?: string };
  const key = process.env.SPACES_KEY ?? "";
  const secret = process.env.SPACES_SECRET ?? "";
  const hasOdd = (v: string) => /^\s|\s$|["']/.test(v);
  const config =
    `region=${JSON.stringify(process.env.SPACES_REGION ?? "")} bucket=${JSON.stringify(SPACES_BUCKET)} ` +
    `keyLen=${key.length}${hasOdd(key) ? "(whitespace/quote!)" : ""} ` +
    `secretLen=${secret.length}${hasOdd(secret) ? "(whitespace/quote!)" : ""}`;
  const status = e?.$metadata?.httpStatusCode;
  return `${e?.name || "Error"}${status ? ` (HTTP ${status})` : ""}${e?.code ? ` [${e.code}]` : ""}: ${
    e?.message && e.message !== e.name ? e.message : "no detail from storage"
  } | ${config}`;
}
