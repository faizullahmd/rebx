import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_NOTE_LENGTH = 2000;

/**
 * DELETE /api/shortlist/[listingId]
 * Removes one listing from the customer's Shortlist (idempotent).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ listingId: string }> | { listingId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawParams = await Promise.resolve(context?.params);
  const rawParam = rawParams?.listingId;
  const listingId = parseInt(rawParam, 10);

  if (Number.isNaN(listingId) || listingId <= 0) {
    return NextResponse.json(
      { error: "Invalid listing ID in route parameter" },
      { status: 400 }
    );
  }

  const customerId = Number(session.user.id);
  if (!customerId || Number.isNaN(customerId)) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
  }

  try {
    const result = await prisma.shortlist.deleteMany({
      where: {
        customerId,
        listingId,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Removed from Shortlist",
      listingId,
      deletedCount: result.count,
    });
  } catch (error) {
    console.error(`DELETE /api/shortlist/${rawParam} error:`, error);
    return NextResponse.json(
      { error: "Failed to remove property from Shortlist" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/shortlist/[listingId]
 * Updates private notes for a shortlisted property.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ listingId: string }> | { listingId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawParams = await Promise.resolve(context?.params);
  const rawParam = rawParams?.listingId;
  const listingId = parseInt(rawParam, 10);

  if (Number.isNaN(listingId) || listingId <= 0) {
    return NextResponse.json(
      { error: "Invalid listing ID in route parameter" },
      { status: 400 }
    );
  }

  const customerId = Number(session.user.id);
  if (!customerId || Number.isNaN(customerId)) {
    return NextResponse.json({ error: "Invalid user session" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.notes != null && typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be text" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `Notes can be at most ${MAX_NOTE_LENGTH} characters` },
      { status: 400 }
    );
  }

  try {
    // Update only: a note must never create a shortlist entry (that would bypass the public-listing check).
    const result = await prisma.shortlist.updateMany({
      where: { customerId, listingId },
      data: { notes: notes || null },
    });
    if (result.count === 0) {
      return NextResponse.json({ error: "Property is not in your Shortlist" }, { status: 404 });
    }

    revalidatePath("/dashboard/shortlist");
    revalidatePath("/api/shortlist");

    return NextResponse.json({
      success: true,
      message: "Note saved",
      notes: notes || null,
    });
  } catch (error) {
    console.error(`PATCH /api/shortlist/${rawParam} error:`, error);
    return NextResponse.json(
      { error: "Failed to save note" },
      { status: 500 }
    );
  }
}

