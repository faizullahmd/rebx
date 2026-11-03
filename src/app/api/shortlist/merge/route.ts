import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MergeShortlistSchema } from "@/lib/validation/shortlist";

export const dynamic = "force-dynamic";

/**
 * POST /api/shortlist/merge
 * Bulk adds guest shortlisted listing IDs into the customer's account upon login/signup.
 * Skips duplicates gracefully and returns the count of actually added listings.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = MergeShortlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid listing IDs array" },
      { status: 400 }
    );
  }

  const { listingIds } = parsed.data;
  const customerId = Number(session.user.id);

  if (listingIds.length === 0) {
    return NextResponse.json({
      success: true,
      addedCount: 0,
      message: "No listings to merge",
      ids: [],
    });
  }

  try {
    const db = (prisma as any).shortlist
      ? prisma
      : new (await import("@prisma/client")).PrismaClient();

    // Unique list of input IDs
    const uniqueInputIds = Array.from(new Set(listingIds));

    // Verify which listings actually exist in DB
    const validListings = await db.listing.findMany({
      where: {
        id: { in: uniqueInputIds },
      },
      select: { id: true },
    });
    const validListingIds = new Set(validListings.map((l: { id: number }) => l.id));

    // Check which listings the customer already has shortlisted
    const alreadyShortlisted = await db.shortlist.findMany({
      where: {
        customerId,
        listingId: { in: Array.from(validListingIds) },
      },
      select: { listingId: true },
    });
    const alreadyShortlistedIds = new Set(
      alreadyShortlisted.map((s: { listingId: number }) => s.listingId)
    );

    // Filter to truly new listing IDs
    const toInsert = Array.from(validListingIds).filter(
      (id) => !alreadyShortlistedIds.has(id)
    );

    let addedCount = 0;
    if (toInsert.length > 0) {
      const result = await db.shortlist.createMany({
        data: toInsert.map((listingId) => ({
          customerId,
          listingId,
        })),
        skipDuplicates: true,
      });
      addedCount = result.count;
    }

    // Fetch all current IDs for the customer to return
    const allRecords = await db.shortlist.findMany({
      where: { customerId },
      select: { listingId: true },
    });
    const currentIds = allRecords.map((r) => r.listingId);

    return NextResponse.json({
      success: true,
      addedCount,
      ids: currentIds,
      message: `${addedCount} properties added to your Shortlist.`,
    });
  } catch (error) {
    console.error("POST /api/shortlist/merge error:", error);
    return NextResponse.json(
      { error: "Failed to merge Shortlist items" },
      { status: 500 }
    );
  }
}

