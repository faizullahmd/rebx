import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
    try {
      await prisma.$executeRawUnsafe(
        `DELETE FROM shortlist WHERE customer_id = ? AND listing_id = ?`,
        customerId,
        listingId
      );
      return NextResponse.json({
        success: true,
        message: "Removed from Shortlist",
        listingId,
      });
    } catch (sqlErr) {
      return NextResponse.json(
        { error: "Failed to remove property from Shortlist" },
        { status: 500 }
      );
    }
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
  const notes = typeof body.notes === "string" ? body.notes.trim() : null;

  try {
    // 1. Direct SQL update to ensure immediate persistence in MySQL
    await prisma.$executeRawUnsafe(
      `UPDATE shortlist SET notes = ?, updated_at = NOW() WHERE customer_id = ? AND listing_id = ?`,
      notes,
      customerId,
      listingId
    );

    // Also attempt Prisma upsert in case row didn't exist or for client consistency
    try {
      await prisma.shortlist.upsert({
        where: {
          customerId_listingId: {
            customerId,
            listingId,
          },
        },
        create: {
          customerId,
          listingId,
          notes,
        },
        update: {
          notes,
        },
      });
    } catch {
      await prisma.$executeRawUnsafe(
        `INSERT INTO shortlist (customer_id, listing_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE notes = ?, updated_at = NOW()`,
        customerId,
        listingId,
        notes,
        notes
      );
    }

    revalidatePath("/dashboard/shortlist");
    revalidatePath("/api/shortlist");

    return NextResponse.json({
      success: true,
      message: "Note saved",
      notes,
    });
  } catch (error) {
    console.error(`PATCH /api/shortlist/${rawParam} error:`, error);
    return NextResponse.json(
      { error: "Failed to save note" },
      { status: 500 }
    );
  }
}

