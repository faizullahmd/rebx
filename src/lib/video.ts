export const CAN_ATTACH_VIDEO_ROLES = ["DEVELOPER", "AGENT"] as const;
export const CAN_ADD_GALLERY_VIDEO_ROLES = ["DEVELOPER"] as const;
export const CAN_ADD_VIDEO_ROLES = CAN_ATTACH_VIDEO_ROLES;

export type VideoProvider = "youtube" | "vimeo";

export interface ParsedVideo {
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;
  thumbnailUrl: string;
}

export function canAttachVideo(role?: string | null): boolean {
  if (!role) return false;
  return (CAN_ATTACH_VIDEO_ROLES as readonly string[]).includes(role);
}

export function canAddGalleryVideo(role?: string | null): boolean {
  if (!role) return false;
  return (CAN_ADD_GALLERY_VIDEO_ROLES as readonly string[]).includes(role);
}

export function canAddVideo(role?: string | null): boolean {
  return canAttachVideo(role);
}

/**
 * Extracts YouTube video ID from various YouTube URL formats:
 * - youtube.com/watch?v={id}
 * - m.youtube.com/watch?v={id}
 * - youtu.be/{id}
 * - youtube.com/shorts/{id}
 * - youtube.com/embed/{id}
 */
export function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  try {
    const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, "");

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      // /watch?v={id}
      const v = urlObj.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
      // /shorts/{id}
      const shortsMatch = urlObj.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) {
        return shortsMatch[1];
      }
      // /embed/{id}
      const embedMatch = urlObj.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) {
        return embedMatch[1];
      }
    } else if (hostname === "youtu.be") {
      // youtu.be/{id}
      const idMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (idMatch) {
        return idMatch[1];
      }
    }
  } catch {
    // If not a valid standard URL, fallback regex matching
    const match = trimmed.match(
      /(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    if (match) return match[1];
  }

  return null;
}

/**
 * Extracts Vimeo video ID from Vimeo URL formats:
 * - vimeo.com/{id}
 * - player.vimeo.com/video/{id}
 */
export function extractVimeoId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  try {
    const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, "");

    if (hostname === "vimeo.com") {
      const match = urlObj.pathname.match(/^\/(\d+)/);
      if (match) return match[1];
    } else if (hostname === "player.vimeo.com") {
      const match = urlObj.pathname.match(/^\/video\/(\d+)/);
      if (match) return match[1];
    }
  } catch {
    const match = trimmed.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Validates if the given URL is a supported YouTube or Vimeo link.
 */
export function isValidVideoUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  return Boolean(extractYouTubeId(url) || extractVimeoId(url));
}

// In-memory cache for Vimeo thumbnails (persists across requests during server runtime)
const vimeoThumbnailCache = new Map<string, string>();

/**
 * Fetches the Vimeo thumbnail via Vimeo's free oEmbed endpoint server-side without API keys.
 * Uses Next.js fetch caching (revalidates daily) and in-memory cache.
 */
export async function getVimeoThumbnail(videoId: string): Promise<string> {
  if (vimeoThumbnailCache.has(videoId)) {
    return vimeoThumbnailCache.get(videoId)!;
  }

  const oembedUrl = `https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F${videoId}`;
  try {
    const res = await fetch(oembedUrl, {
      next: { revalidate: 86400 },
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.thumbnail_url === "string" && data.thumbnail_url) {
        vimeoThumbnailCache.set(videoId, data.thumbnail_url);
        return data.thumbnail_url;
      }
    }
  } catch {
    // If network or server error, return a fallback placeholder
  }

  return `https://vumbnail.com/${videoId}.jpg`;
}

/**
 * Synchronous parser for video URLs.
 * Note: For Vimeo, thumbnailUrl will use a reliable high-res vumbnail / oembed proxy,
 * or call `getVideoDetails` to fetch and cache via Vimeo oEmbed.
 */
export function parseVideoUrl(url: string): ParsedVideo | null {
  if (!url || typeof url !== "string") return null;

  const ytId = extractYouTubeId(url);
  if (ytId) {
    return {
      provider: "youtube",
      videoId: ytId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
      thumbnailUrl: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
    };
  }

  const vimeoId = extractVimeoId(url);
  if (vimeoId) {
    const cached = vimeoThumbnailCache.get(vimeoId);
    return {
      provider: "vimeo",
      videoId: vimeoId,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`,
      thumbnailUrl: cached || `https://vumbnail.com/${vimeoId}.jpg`,
    };
  }

  return null;
}

/**
 * Asynchronous parser that resolves exact thumbnails (including fetching Vimeo oEmbed).
 */
export async function getVideoDetails(url: string): Promise<ParsedVideo | null> {
  const parsed = parseVideoUrl(url);
  if (!parsed) return null;

  if (parsed.provider === "vimeo") {
    const thumbnail = await getVimeoThumbnail(parsed.videoId);
    return {
      ...parsed,
      thumbnailUrl: thumbnail,
    };
  }

  return parsed;
}
