import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDealsForCustomer } from "@/lib/data/deals";

const stageLabels: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  VIEWING_SCHEDULED: "Viewing scheduled",
  OFFER_MADE: "Offer made",
  NEGOTIATION: "Negotiation",
  UNDER_CONTRACT: "Under contract",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

export default async function CustomerDashboardPage() {
  const user = await requireRole("CUSTOMER");
  const deals = await getDealsForCustomer(user.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>

      {deals.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-md text-gray-600">
            Your inquiries will show up here once you contact an agent about a listing.
          </p>
          <Link
            href="/listings"
            className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Browse listings
          </Link>
        </div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id} className="border-b border-gray-100">
                <td className="py-3">
                  <Link href={`/listings/${deal.listing.slug}`} className="hover:underline">
                    {deal.listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">{stageLabels[deal.stage]}</td>
                <td className="py-3 text-gray-600">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                    deal.updatedAt
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
