import { prisma } from "@/lib/prisma";
import { getVideoDetails, parseVideoUrl, extractYouTubeId, extractVimeoId } from "@/lib/video";

export interface SyncVideoInput {
  url: string;
  title?: string | null;
}

/**
 * Ensures that a video URL is saved/upserted into `prisma.video` table
 * and associated with the creator (developer or agent or admin).
 */
export async function upsertVideoToGallery({
  url,
  title,
  createdById,
  fallbackListingTitle,
}: {
  url: string;
  title?: string | null;
  createdById: number;
  fallbackListingTitle?: string;
}) {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return null;

  const details = await getVideoDetails(trimmedUrl) || parseVideoUrl(trimmedUrl);
  const displayTitle = title?.trim() || fallbackListingTitle || "Property Video";

  if (details) {
    try {
      const existing = await prisma.video.findUnique({
        where: {
          provider_videoId: {
            provider: details.provider,
            videoId: details.videoId,
          },
        },
      });

      if (existing) {
        // Update title if provided, or retain existing
        return await prisma.video.update({
          where: { id: existing.id },
          data: {
            title: title?.trim() || existing.title,
            thumbnailUrl: details.thumbnailUrl || existing.thumbnailUrl,
          },
        });
      }

      return await prisma.video.create({
        data: {
          title: displayTitle,
          url: trimmedUrl,
          provider: details.provider,
          videoId: details.videoId,
          thumbnailUrl: details.thumbnailUrl,
          createdById,
        },
      });
    } catch (err) {
      console.warn("Failed to upsert gallery video for provider:", details.provider, err);
    }
  }

  // Handle direct file URLs (e.g. mp4/webm uploads)
  const isDirectVideo =
    /\.(mp4|webm|mov|ogg)(\?.*)?$/i.test(trimmedUrl) || trimmedUrl.startsWith("/uploads/");
  if (isDirectVideo) {
    const provider = "direct";
    const videoId = trimmedUrl.length > 180 ? trimmedUrl.slice(-180) : trimmedUrl;

    try {
      const existing = await prisma.video.findUnique({
        where: {
          provider_videoId: {
            provider,
            videoId,
          },
        },
      });

      if (existing) {
        return existing;
      }

      return await prisma.video.create({
        data: {
          title: displayTitle,
          url: trimmedUrl,
          provider,
          videoId,
          thumbnailUrl: "/images/property-placeholder.jpg",
          createdById,
        },
      });
    } catch (err) {
      console.warn("Failed to upsert direct gallery video:", err);
    }
  }

  return null;
}

/**
 * Synchronizes all videos attached to a specific listing (e.g. from `/developer/dashboard/listings/[id]/videos`
 * or listing edit/create forms) into `prisma.video` and links `listing.videoId`.
 */
export async function syncListingVideosToGallery(
  listingId: number,
  videos: SyncVideoInput[],
  userId?: number
) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      title: true,
      developerId: true,
      agentId: true,
      videoId: true,
      videoUrl: true,
    },
  });

  if (!listing) return;

  const creatorId = listing.developerId || listing.agentId || userId;
  if (!creatorId) return;

  const validVideos = (videos || []).filter(
    (v) => v && typeof v.url === "string" && v.url.trim()
  );

  let firstSavedVideoId: number | null = null;
  let firstSavedVideoUrl: string | null = null;

  for (let i = 0; i < validVideos.length; i++) {
    const item = validVideos[i];
    const saved = await upsertVideoToGallery({
      url: item.url,
      title: item.title,
      createdById: creatorId,
      fallbackListingTitle: `${listing.title}${validVideos.length > 1 ? ` - Video ${i + 1}` : ""}`,
    });

    if (saved && i === 0) {
      firstSavedVideoId = saved.id;
      firstSavedVideoUrl = saved.url;
    }
  }

  // Update listing primary video pointers
  if (validVideos.length > 0) {
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        videoId: firstSavedVideoId || undefined,
        videoUrl: firstSavedVideoUrl || validVideos[0].url.trim(),
      },
    });
  } else if (listing.videoId || listing.videoUrl) {
    // If all project videos were cleared, detach
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        videoId: null,
        videoUrl: null,
      },
    });
  }
}

/**
 * Backfills any existing listing videos or listing.videoUrl records in the database
 * that haven't been inserted into `prisma.video`.
 */
export async function backfillAllListingsVideosToGallery() {
  try {
    // 1. Process all ListingVideo records
    const listingVideos = await prisma.listingVideo.findMany({
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            developerId: true,
            agentId: true,
            videoId: true,
          },
        },
      },
    });

    for (const lv of listingVideos) {
      const creatorId = lv.listing.developerId || lv.listing.agentId;
      if (!creatorId || !lv.url) continue;

      const saved = await upsertVideoToGallery({
        url: lv.url,
        title: lv.title || `${lv.listing.title} - Video ${lv.sortOrder + 1}`,
        createdById: creatorId,
        fallbackListingTitle: lv.listing.title,
      });

      // If listing has no videoId, link to this video
      if (saved && !lv.listing.videoId) {
        await prisma.listing.update({
          where: { id: lv.listing.id },
          data: { videoId: saved.id, videoUrl: lv.url },
        });
      }
    }

    // 2. Process all Listings with a direct videoUrl
    const listingsWithUrl = await prisma.listing.findMany({
      where: {
        NOT: { videoUrl: null },
      },
      select: {
        id: true,
        title: true,
        videoUrl: true,
        videoId: true,
        developerId: true,
        agentId: true,
      },
    });

    for (const l of listingsWithUrl) {
      if (!l.videoUrl) continue;
      const creatorId = l.developerId || l.agentId;
      if (!creatorId) continue;

      const saved = await upsertVideoToGallery({
        url: l.videoUrl,
        title: l.title,
        createdById: creatorId,
        fallbackListingTitle: l.title,
      });

      if (saved && !l.videoId) {
        await prisma.listing.update({
          where: { id: l.id },
          data: { videoId: saved.id },
        });
      }
    }

    return { success: true };
  } catch (error) {
    console.error("Backfill failed:", error);
    return { success: false, error };
  }
}
