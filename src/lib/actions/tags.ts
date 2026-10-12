"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { isValidTagColor, type TagItem } from "@/lib/tags";

export async function getTagsAction(): Promise<{ success: boolean; tags: TagItem[]; error?: string }> {
  try {
    const user = await requireUser();

    const tags = await prisma.tag.findMany({
      where: {
        OR: [
          { isDefault: true },
          { createdBy: user.id },
        ],
      },
      orderBy: [
        { isDefault: "desc" },
        { createdAt: "asc" },
      ],
      select: {
        id: true,
        name: true,
        color: true,
        isDefault: true,
        createdBy: true,
        createdAt: true,
      },
    });

    return { success: true, tags };
  } catch (err: any) {
    console.error("getTagsAction error:", err);
    return { success: false, tags: [], error: err?.message || "Failed to load tags." };
  }
}

export async function createTagAction(data: {
  name: string;
  color: string;
}): Promise<{ success: boolean; tag?: TagItem; error?: string }> {
  try {
    const user = await requireUser();

    const trimmedName = data.name?.trim() || "";
    if (!trimmedName) {
      return { success: false, error: "Tag name is required." };
    }

    if (trimmedName.length > 20) {
      return { success: false, error: "Tag name must be 20 characters or fewer." };
    }

    const colorKey = data.color?.toLowerCase() || "";
    if (!isValidTagColor(colorKey)) {
      return { success: false, error: "Please choose a valid color from the palette." };
    }

    // Enforce max 10 custom tags per agent
    const customCount = await prisma.tag.count({
      where: { createdBy: user.id },
    });

    if (customCount >= 10) {
      return {
        success: false,
        error: "Limit reached: You can create a maximum of 10 custom tags.",
      };
    }

    // Case-insensitive duplicate check against default tags and this agent's tags
    const existingTags = await prisma.tag.findMany({
      where: {
        OR: [
          { isDefault: true },
          { createdBy: user.id },
        ],
      },
      select: { name: true, isDefault: true },
    });

    const lowerTarget = trimmedName.toLowerCase();
    const duplicate = existingTags.find((t) => t.name.toLowerCase() === lowerTarget);
    if (duplicate) {
      if (duplicate.isDefault) {
        return {
          success: false,
          error: `"${trimmedName}" is reserved as a default tag name.`,
        };
      }
      return {
        success: false,
        error: `You already have a custom tag named "${trimmedName}".`,
      };
    }

    const newTag = await prisma.tag.create({
      data: {
        name: trimmedName,
        color: colorKey,
        isDefault: false,
        createdBy: user.id,
      },
      select: {
        id: true,
        name: true,
        color: true,
        isDefault: true,
        createdBy: true,
        createdAt: true,
      },
    });

    revalidatePath("/agent/dashboard/listings");
    revalidatePath("/agent/dashboard/portfolio");

    return { success: true, tag: newTag };
  } catch (err: any) {
    console.error("createTagAction error:", err);
    return {
      success: false,
      error: err?.message || "Failed to create tag. Please try again.",
    };
  }
}

export async function getTagUsageCountAction(tagId: number): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const user = await requireUser();

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { id: true, isDefault: true, createdBy: true },
    });

    if (!tag) {
      return { success: false, count: 0, error: "Tag not found." };
    }

    if (tag.createdBy !== user.id && user.role !== "ADMIN") {
      return { success: false, count: 0, error: "Not authorized to access this tag." };
    }

    const count = await prisma.listing.count({
      where: { tagId },
    });

    return { success: true, count };
  } catch (err: any) {
    console.error("getTagUsageCountAction error:", err);
    return { success: false, count: 0, error: err?.message || "Failed to get tag usage count." };
  }
}

export async function deleteTagAction(tagId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireUser();

    const tag = await prisma.tag.findUnique({
      where: { id: tagId },
      select: { id: true, name: true, isDefault: true, createdBy: true },
    });

    if (!tag) {
      return { success: false, error: "Tag not found." };
    }

    if (tag.isDefault) {
      return { success: false, error: "Default tags cannot be deleted." };
    }

    if (tag.createdBy !== user.id && user.role !== "ADMIN") {
      return { success: false, error: "You can only delete your own custom tags." };
    }

    // Set all listings using this tag to null
    await prisma.listing.updateMany({
      where: { tagId },
      data: { tagId: null, tags: [] },
    });

    // Delete the tag
    await prisma.tag.delete({
      where: { id: tagId },
    });

    revalidatePath("/agent/dashboard/listings");
    revalidatePath("/agent/dashboard/portfolio");
    revalidatePath("/listings");

    return { success: true };
  } catch (err: any) {
    console.error("deleteTagAction error:", err);
    return {
      success: false,
      error: err?.message || "Failed to delete tag. Please try again.",
    };
  }
}
