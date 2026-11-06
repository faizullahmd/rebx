import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { prisma } from "@/lib/prisma";
import { DashboardListingsTable } from "@/components/dashboard/DashboardListingsTable";

export default async function AgentListingsPage() {
  const user = await requireRole("AGENT");
  const [rawListings, agentProfile] = await Promise.all([
    getListingsForAgent(user.id),
    prisma.agentProfile.findUnique({
      where: { userId: user.id },
      select: { phone: true },
    }),
  ]);

  const listings = rawListings.map((listing) => ({
    ...listing,
    price: listing.price != null ? Number(listing.price) : null,
    projectArea: listing.projectArea != null ? Number(listing.projectArea) : null,
    tag: (listing as any).tag,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">My listings</h1>
        <Link
          href="/agent/dashboard/listings/new"
          className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 w-full sm:w-auto"
        >
          + New listing
        </Link>
      </div>

      <DashboardListingsTable
        listings={listings}
        agentName={user.name}
        agentPhone={agentProfile?.phone}
        emptyMessage="You haven't created any listings yet."
      />
    </div>
  );
}
