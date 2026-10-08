import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { DashboardListingsTable } from "@/components/dashboard/DashboardListingsTable";

export default async function AgentListingsPage() {
  const user = await requireRole("AGENT");
  const rawListings = await getListingsForAgent(user.id);

  const listings = rawListings.map((listing) => ({
    id: listing.id,
    title: listing.title,
    city: listing.city,
    price: Number(listing.price),
    priceDisplay: listing.priceDisplay,
    currency: listing.currency,
    status: listing.status,
    tags: listing.tags,
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
        emptyMessage="You haven't created any listings yet."
      />
    </div>
  );
}
