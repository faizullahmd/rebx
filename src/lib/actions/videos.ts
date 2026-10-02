"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { canAddGalleryVideo, getVideoDetails, isValidVideoUrl } from "@/lib/video";

export type AddVideoState = {
  success?: boolean;
  message?: string;
  errors?: {
    title?: string[];
    url?: string[];
  };
};

export async function addGalleryVideo(
  _prevState: AddVideoState | undefined,
  formData: FormData
): Promise<AddVideoState> {
  const user = await requireUser();

  if (!canAddGalleryVideo(user.role)) {
    return {
      message: "You do not have permission to add videos to the gallery.",
    };
  }

  const title = (formData.get("title") as string | null)?.trim() || "";
  const url = (formData.get("url") as string | null)?.trim() || "";

  const errors: { title?: string[]; url?: string[] } = {};

  if (!title) {
    errors.title = ["Title is required."];
  } else if (title.length < 3) {
    errors.title = ["Title must be at least 3 characters."];
  }

  if (!url) {
    errors.url = ["Video URL is required."];
  } else if (!isValidVideoUrl(url)) {
    errors.url = ["Please provide a valid YouTube or Vimeo URL."];
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const details = await getVideoDetails(url);
  if (!details) {
    return {
      errors: {
        url: ["Unable to parse video URL. Please check the link."],
      },
    };
  }

  // Prevent duplicate videos with same provider & videoId
  const existing = await prisma.video.findUnique({
    where: {
      provider_videoId: {
        provider: details.provider,
        videoId: details.videoId,
      },
    },
  });

  if (existing) {
    return {
      errors: {
        url: ["This video already exists in the Video Gallery."],
      },
    };
  }

  try {
    await prisma.video.create({
      data: {
        title,
        url,
        provider: details.provider,
        videoId: details.videoId,
        thumbnailUrl: details.thumbnailUrl,
        createdById: user.id,
      },
    });

    revalidatePath("/videos");
    revalidatePath("/api/videos");
    revalidatePath("/agent/dashboard/videos");
    revalidatePath("/developer/dashboard/videos");

    return {
      success: true,
      message: "Video successfully added to the Video Gallery!",
    };
  } catch (error) {
    console.error("Failed to add gallery video:", error);
    return {
      message: "Failed to add video. Please try again.",
    };
  }
}

export async function deleteGalleryVideo(videoId: number): Promise<{ success: boolean; message?: string }> {
  const user = await requireUser();

  if (!canAddGalleryVideo(user.role)) {
    return {
      success: false,
      message: "You do not have permission to delete gallery videos.",
    };
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    include: {
      listings: {
        select: { id: true, title: true },
      },
    },
  });

  if (!video) {
    return { success: false, message: "Video not found." };
  }

  // Permissions: Users can edit or delete only their own videos (unless ADMIN)
  if (user.role !== "ADMIN" && video.createdById !== user.id) {
    return {
      success: false,
      message: "You can only delete videos that you added.",
    };
  }

  try {
    // Unlink any listings referencing this video and clear videoUrl if it matched
    await prisma.listing.updateMany({
      where: { videoId },
      data: {
        videoId: null,
        videoUrl: null,
      },
    });

    await prisma.video.delete({
      where: { id: videoId },
    });

    revalidatePath("/videos");
    revalidatePath("/listings");
    revalidatePath("/api/videos");
    revalidatePath("/agent/dashboard/videos");
    revalidatePath("/developer/dashboard/videos");

    return { success: true };
  } catch (error) {
    console.error("Failed to delete gallery video:", error);
    return { success: false, message: "Failed to delete video." };
  }
}

export async function getUserGalleryVideos(userId: number) {
  return prisma.video.findMany({
    where: { createdById: userId },
    include: {
      listings: {
        select: {
          id: true,
          title: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
