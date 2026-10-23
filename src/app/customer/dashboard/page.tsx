import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDealsForCustomer } from "@/lib/data/deals";

const stageLabels: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  VIEWING_SCHEDULED: "Site visit",
  OFFER_MADE: "Offer made",
  NEGOTIATION: "Negotiation",
  UNDER_CONTRACT: "Under contract",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

export default async function CustomerDashboardPage() {
  const user = await requireRole("CUSTOMER");
  const deals = await getDealsForCustomer(user.id, user.email);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>

      {deals.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-md text-gray-600">
            Your deals will show up here once you contact an agent about a listing.
          </p>
          <Link
            href="/listings"
            className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Browse listings
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Listing</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Latest Message</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deals.map((deal) => (
                <tr key={deal.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col">
                      <Link
                        href={`/customer/dashboard/chat/${deal.id}`}
                        className="font-medium text-gray-900 hover:text-blue-600 hover:underline inline-flex items-center gap-1.5"
                      >
                        <span>{deal.listing.title}</span>
                        {deal.unreadCount > 0 && (
                          <span className="inline-flex items-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {deal.unreadCount} new
                          </span>
                        )}
                      </Link>
                      <Link
                        href={`/listings/${deal.listing.slug}`}
                        className="text-xs text-gray-400 hover:text-gray-600 hover:underline mt-0.5"
                      >
                        View property details →
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-gray-700 font-medium">
                    {deal.agent.name}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                      {stageLabels[deal.stage] || deal.stage}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-gray-500 max-w-xs truncate text-xs">
                    {deal.lastMessage?.text || "No messages yet"}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <Link
                      href={`/customer/dashboard/chat/${deal.id}`}
                      className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 transition-colors"
                    >
                      Open Chat
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
