import { NextResponse, type NextRequest } from "next/server";
import https from "https";
import http from "http";
import { auth } from "@/auth";
import { parseLocationInput, isGoogleMapsShortLink, extractGoogleMapsShortLink } from "@/lib/maps";

// Rate limiting state: max 20 requests per minute per identifier
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;

function checkRateLimit(identifier: string): boolean {
  const now = Date.now();
  const record = rateLimits.get(identifier);
  if (!record || now > record.resetAt) {
    rateLimits.set(identifier, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }
  record.count += 1;
  return true;
}

const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "www.google.com",
  "maps.google.com",
  "google.com",
]);

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTS.has(hostname.toLowerCase());
}

function fetchHeaderWithRedirect(
  targetUrl: string,
  timeoutMs: number = 5000
): Promise<{ status?: number; location?: string }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return reject(e);
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      parsed,
      {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode;
        const location = res.headers.location;
        res.resume(); // Discard body
        resolve({ status, location });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout while following location link."));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

async function resolveShortLinkSafely(initialUrl: string): Promise<string> {
  let currentUrl = initialUrl.trim();
  if (!currentUrl.startsWith("http://") && !currentUrl.startsWith("https://")) {
    currentUrl = `https://${currentUrl}`;
  }

  const MAX_HOPS = 5;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error("Invalid URL encountered during resolution");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Non-http(s) protocol rejected for security reasons");
    }

    if (!isAllowedHost(parsed.hostname)) {
      throw new Error(`Host '${parsed.hostname}' is not on the Google Maps allowlist`);
    }

    let response: { status?: number; location?: string };
    try {
      response = await fetchHeaderWithRedirect(currentUrl, 5000);
    } catch (err) {
      console.warn("[location-resolve] HTTP request error:", err);
      throw new Error("Network failure while following link");
    }

    const status = response.status ?? 0;
    if (status >= 300 && status < 400 && response.location) {
      currentUrl = new URL(response.location, parsed).toString();
      continue;
    }

    return currentUrl;
  }

  return currentUrl;
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
        { error: "Forbidden: Only agents and developers can resolve locations." },
        { status: 403 }
      );
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || session.user.id || "agent";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute before resolving more locations." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawInput = typeof body.input === "string" ? body.input.trim() : "";

    if (!rawInput) {
      return NextResponse.json(
        { error: "We couldn't read this link. Paste a Google Maps link or coordinates (latitude, longitude)." },
        { status: 422 }
      );
    }

    let inputToParse = rawInput;

    // Follow redirects for short links with strict SSRF controls
    const extractedShortLink = extractGoogleMapsShortLink(rawInput);
    if (extractedShortLink || isGoogleMapsShortLink(rawInput)) {
      const linkToResolve = extractedShortLink || rawInput;
      try {
        inputToParse = await resolveShortLinkSafely(linkToResolve);
      } catch (err) {
        console.warn("[location-resolve] Failed to follow short link redirects:", err);
        return NextResponse.json(
          { error: "We couldn't read this link. Paste a Google Maps link or coordinates (latitude, longitude)." },
          { status: 422 }
        );
      }
    }

    const result = parseLocationInput(inputToParse);

    if ("error" in result) {
      return NextResponse.json(
        { error: "We couldn't read this link. Paste a Google Maps link or coordinates (latitude, longitude)." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      latitude: result.latitude,
      longitude: result.longitude,
    });
  } catch (err) {
    console.error("[location-resolve] Unhandled error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while resolving location." },
      { status: 500 }
    );
  }
}
