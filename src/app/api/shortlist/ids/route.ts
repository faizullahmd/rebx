import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/shortlist/ids
 * Fast retrieval of all shortlisted listing IDs for the logged-in customer.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const customerId = Number(session.user.id);

  try {
    const db = (prisma as any).shortlist
      ? prisma
      : new (await import("@prisma/client")).PrismaClient();

    const records = await db.shortlist.findMany({
      where: { customerId },
      select: { listingId: true },
    });

    const ids = records.map((r) => r.listingId);

    return NextResponse.json({
      success: true,
      ids,
      count: ids.length,
    });
  } catch (error) {
    console.error("GET /api/shortlist/ids error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve shortlist IDs" },
      { status: 500 }
    );
  }
}

