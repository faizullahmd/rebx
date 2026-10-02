"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";

export interface SubmitReviewInput {
  agentId: number;
  listingId?: number | null;
  rating: number;
  comment: string;
  name?: string;
  role?: string;
  communicationRating?: number;
  localKnowledgeRating?: number;
  negotiationRating?: number;
}

export async function submitAgentReview(input: SubmitReviewInput) {
  try {
    const session = await auth();
    const reviewerName = input.name?.trim() || session?.user?.name || "Verified Client";
    const reviewerRole = input.role?.trim() || "Verified Buyer";
    const rating = Math.min(5, Math.max(1, Math.round(Number(input.rating) || 5)));
    const comment = input.comment?.trim();

    if (!comment) {
      return { success: false, error: "Please enter your review comment." };
    }

    if (!input.agentId) {
      return { success: false, error: "Agent ID is required." };
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO Review (name, role, rating, comment, communicationRating, localKnowledgeRating, negotiationRating, isVerified, agentId, listingId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())`,
      reviewerName,
      reviewerRole,
      rating,
      comment,
      input.communicationRating ?? Number(rating),
      input.localKnowledgeRating ?? Number(rating),
      input.negotiationRating ?? Number(rating),
      input.agentId,
      input.listingId ?? null
    );

    revalidatePath("/listings/[slug]", "page");
    revalidatePath("/portfolio/[username]", "page");

    return { success: true };
  } catch (err) {
    console.error("Failed to submit review:", err);
    return { success: false, error: "Failed to submit review. Please try again." };
  }
}

export async function getReviewsForAgent(agentId: number) {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, role, rating, comment, communicationRating, localKnowledgeRating, negotiationRating, isVerified, createdAt
       FROM Review
       WHERE agentId = ?
       ORDER BY createdAt DESC`,
      agentId
    );
    return rows;
  } catch (err) {
    console.error("Failed to fetch reviews:", err);
    return [];
  }
}
