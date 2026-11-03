import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/shortlist/[listingId]
 * Removes one listing from the customer's Shortlist (idempotent).
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ listingId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { listingId: rawParam } = await context.params;
  const listingId = parseInt(rawParam, 10);

  if (Number.isNaN(listingId) || listingId <= 0) {
    return NextResponse.json(
      { error: "Invalid listing ID in route parameter" },
      { status: 400 }
    );
  }

  const customerId = Number(session.user.id);

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

