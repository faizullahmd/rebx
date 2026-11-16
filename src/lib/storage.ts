import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

export interface SpacesConfig {
  key: string;
  secret: string;
  region: string;
  bucket: string;
  cdnEndpoint: string | null;
}

const initialRegion = process.env.SPACES_REGION || "nyc3";
const initialBucket = process.env.SPACES_BUCKET ?? "";

export const SPACES_BUCKET = initialBucket;

export const s3Client = new S3Client({
  region: "us-east-1", // DO Spaces ignores this but the SDK requires a value
  endpoint: `https://${initialRegion}.digitaloceanspaces.com`,
  credentials: {
    accessKeyId: process.env.SPACES_KEY ?? "",
    secretAccessKey: process.env.SPACES_SECRET ?? "",
  },
});

/**
 * Strips protocol schemes and leading/trailing slashes from SPACES_CDN_ENDPOINT
 * so values like "https://cdn.example.com/" and "cdn.example.com" both work cleanly.
 */
export function normalizeSpacesCdnEndpoint(raw?: string | null): { host: string; basePath: string } | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "").replace(/^\/+|\/+$/g, "");
  if (!withoutProtocol) return null;

  const slashIdx = withoutProtocol.indexOf("/");
  if (slashIdx === -1) {
    return { host: withoutProtocol, basePath: "" };
  }
  return {
    host: withoutProtocol.slice(0, slashIdx),
    basePath: withoutProtocol.slice(slashIdx + 1).replace(/^\/+|\/+$/g, ""),
  };
}

/**
 * Returns the list of missing required DigitalOcean Spaces environment variable names.
 * Never returns or logs secret values.
 */
export function getMissingSpacesEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.SPACES_KEY?.trim()) missing.push("SPACES_KEY");
  if (!process.env.SPACES_SECRET?.trim()) missing.push("SPACES_SECRET");
  if (!process.env.SPACES_BUCKET?.trim()) missing.push("SPACES_BUCKET");
  if (!process.env.SPACES_REGION?.trim()) missing.push("SPACES_REGION");
  return missing;
}

/**
 * Reads live Spaces configuration if all required variables are present, or null otherwise.
 */
export function getSpacesConfigOptional(): SpacesConfig | null {
  if (getMissingSpacesEnvVars().length > 0) return null;

  const key = process.env.SPACES_KEY!.trim();
  const secret = process.env.SPACES_SECRET!.trim();
  const bucket = process.env.SPACES_BUCKET!.trim();
  const region = process.env.SPACES_REGION!.trim();
  const cdnEndpoint = process.env.SPACES_CDN_ENDPOINT?.trim() || null;

  return { key, secret, region, bucket, cdnEndpoint };
}

/**
 * Validates and returns required DigitalOcean Spaces configuration.
 * Throws an explicit configuration error naming missing environment variables.
 */
export function getRequiredSpacesConfig(): SpacesConfig {
  const missing = getMissingSpacesEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `DigitalOcean Spaces storage is not configured for production. Missing environment variable(s): ${missing.join(", ")}.`,
    );
  }
  return getSpacesConfigOptional()!;
}

export function createSpacesClient(config: SpacesConfig): S3Client {
  return new S3Client({
    region: "us-east-1", // DO Spaces uses endpoint region; AWS SDK requires a non-empty region string
    endpoint: `https://${config.region}.digitaloceanspaces.com`,
    credentials: {
      accessKeyId: config.key,
      secretAccessKey: config.secret,
    },
  });
}

export function buildSpacesPublicUrl(key: string, config?: Partial<SpacesConfig>): string {
  const cleanKey = key.replace(/^\/+/, "");
  const cdn = normalizeSpacesCdnEndpoint(config?.cdnEndpoint ?? process.env.SPACES_CDN_ENDPOINT);
  if (cdn) {
    const prefix = cdn.basePath ? `${cdn.basePath}/` : "";
    return `https://${cdn.host}/${prefix}${cleanKey}`;
  }

  const bucket = config?.bucket ?? process.env.SPACES_BUCKET?.trim() ?? initialBucket;
  const region = config?.region ?? process.env.SPACES_REGION?.trim() ?? initialRegion;
  return `https://${bucket}.${region}.digitaloceanspaces.com/${cleanKey}`;
}

export function buildPublicUrl(key: string) {
  return buildSpacesPublicUrl(key);
}

/**
 * Extracts the Spaces object key from a standard DO Spaces URL, a DO default CDN URL,
 * a custom SPACES_CDN_ENDPOINT URL, path-style Spaces URL, or a raw storage key.
 * Returns null for local paths or unrelated external domains.
 */
export function extractSpacesObjectKey(
  imageUrlOrKey: string,
  config?: { bucket?: string; region?: string; cdnEndpoint?: string | null },
): string | null {
  const raw = imageUrlOrKey?.trim();
  if (!raw || raw.startsWith("/")) return null;

  // Raw storage key (no URL scheme)
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "") || null;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.replace(/^\/+/, "");
  if (!pathname) return null;

  const decodedPath = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();

  const expectedBucket = config?.bucket?.trim().toLowerCase() ?? process.env.SPACES_BUCKET?.trim().toLowerCase() ?? "";

  // 1. Check configured custom CDN endpoint first (supports custom domains like cdn.rebx.in)
  const cdn = normalizeSpacesCdnEndpoint(config?.cdnEndpoint ?? process.env.SPACES_CDN_ENDPOINT);
  if (cdn && host === cdn.host.toLowerCase()) {
    if (cdn.basePath) {
      const prefix = `${cdn.basePath}/`;
      if (decodedPath.startsWith(prefix)) {
        return decodedPath.slice(prefix.length) || null;
      }
      return null;
    }
    return decodedPath;
  }

  // 2. Check DO Spaces virtual-hosted / default CDN / path-style URLs
  if (host.endsWith(".digitaloceanspaces.com")) {
    // Path-style: https://<region>.digitaloceanspaces.com/<bucket>/<key>
    if (expectedBucket) {
      const hostPrefix = host.split(".")[0];
      if (hostPrefix === expectedBucket) {
        return decodedPath;
      }
      if (decodedPath.startsWith(`${expectedBucket}/`)) {
        return decodedPath.slice(expectedBucket.length + 1) || null;
      }
      // Different bucket than configured -> refuse to treat as our key
      return null;
    }

    // Without expectedBucket context, only strip virtual-hosted <bucket>.<region>.digitaloceanspaces.com
    const labels = host.split(".");
    if (labels.length >= 4) {
      return decodedPath;
    }
  }

  return null;
}

// The SDK often reports "UnknownError" for non-XML responses, so include the HTTP status
// and a safe summary of the Spaces config (never the key or secret values) to make the
// real cause diagnosable from the UI.
export function describeStorageError(error: unknown) {
  const e = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number }; code?: string };
  const key = process.env.SPACES_KEY ?? "";
  const secret = process.env.SPACES_SECRET ?? "";
  const bucket = process.env.SPACES_BUCKET?.trim() ?? initialBucket;
  const hasOdd = (v: string) => /^\s|\s$|["']/.test(v);
  const config =
    `region=${JSON.stringify(process.env.SPACES_REGION ?? "")} bucket=${JSON.stringify(bucket)} ` +
    `keyLen=${key.length}${hasOdd(key) ? "(whitespace/quote!)" : ""} ` +
    `secretLen=${secret.length}${hasOdd(secret) ? "(whitespace/quote!)" : ""}`;
  const status = e?.$metadata?.httpStatusCode;
  return `${e?.name || "Error"}${status ? ` (HTTP ${status})` : ""}${e?.code ? ` [${e.code}]` : ""}: ${
    e?.message && e.message !== e.name ? e.message : "no detail from storage"
  } | ${config}`;
}
