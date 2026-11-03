import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AddShortlistSchema } from "@/lib/validation/shortlist";
import { getShortlistForCustomer } from "@/lib/data/shortlist";

export const dynamic = "force-dynamic";

/**
 * GET /api/shortlist
 * Returns full shortlist for the authenticated customer, newest first.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = Number(session.user.id);

  try {
    const items = await getShortlistForCustomer(customerId);

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
    });
  } catch (error) {
    console.error("GET /api/shortlist error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve your Shortlist" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/shortlist
 * Adds one listing to the customer's Shortlist (idempotent).
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

  const parsed = AddShortlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid listing ID" },
      { status: 400 }
    );
  }

  const { listingId } = parsed.data;
  const customerId = Number(session.user.id);

  try {

    // Only publicly visible listings can be shortlisted (ids are sequential, so drafts must not be reachable).
    const listing = await prisma.listing.findFirst({
      where: { id: listingId, status: { in: ["ACTIVE", "UNDER_OFFER"] } },
      select: { id: true, title: true, status: true },
    });

    if (!listing) {
      return NextResponse.json(
        { error: "Listing not found" },
        { status: 404 }
      );
    }

    // Idempotent upsert
    const record = await prisma.shortlist.upsert({
      where: {
        customerId_listingId: {
          customerId,
          listingId,
        },
      },
      update: {},
      create: {
        customerId,
        listingId,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: "Added to your Shortlist",
        shortlistId: record.id,
        listingId: record.listingId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/shortlist error:", error);
    return NextResponse.json(
      { error: "Failed to add property to Shortlist" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/shortlist
 * Fallback delete accepting ?listingId=123 in URL query or body.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let listingId = Number(searchParams.get("listingId"));

  if (!listingId || Number.isNaN(listingId)) {
    try {
      const body = await request.json();
      listingId = Number(body?.listingId);
    } catch {}
  }

  if (!listingId || Number.isNaN(listingId) || listingId <= 0) {
    return NextResponse.json(
      { error: "Valid listingId is required" },
      { status: 400 }
    );
  }

  const customerId = Number(session.user.id);

  try {

    await prisma.shortlist.deleteMany({
      where: {
        customerId,
        listingId,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Removed from Shortlist",
      listingId,
    });
  } catch (error) {
    console.error("DELETE /api/shortlist error:", error);
    return NextResponse.json(
      { error: "Failed to remove property from Shortlist" },
      { status: 500 }
    );
  }
}

