import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDealsForAgent } from "@/lib/data/deals";
import { DEAL_STAGES } from "@/lib/validation/deal";

const stageLabels: Record<(typeof DEAL_STAGES)[number], string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  VIEWING_SCHEDULED: "Viewing scheduled",
  OFFER_MADE: "Offer made",
  NEGOTIATION: "Negotiation",
  UNDER_CONTRACT: "Under contract",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(date: Date) {
  const days = Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  return relativeTime.format(days, "day");
}

export default async function AgentDealsPage() {
  const user = await requireRole("AGENT");
  const deals = await getDealsForAgent(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Deals</h1>
        <Link
          href="/agent/dashboard/deals/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New deal
        </Link>
      </div>

      {deals.length === 0 ? (
        <p className="text-sm text-gray-500">
          No deals yet. Deals appear here when a customer inquires on one of your listings, or you
          can add one manually.
        </p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {DEAL_STAGES.map((stage) => {
            const stageDeals = deals.filter((deal) => deal.stage === stage);
            return (
              <div key={stage} className="w-64 shrink-0">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  {stageLabels[stage]} ({stageDeals.length})
                </p>
                <div className="flex flex-col gap-2">
                  {stageDeals.map((deal) => (
                    <Link
                      key={deal.id}
                      href={`/agent/dashboard/deals/${deal.id}`}
                      className="rounded-lg border border-gray-200 p-3 text-sm hover:shadow-sm"
                    >
                      <p className="font-medium text-gray-900">{deal.listing.title}</p>
                      <p className="mt-1 text-gray-600">{deal.contactName}</p>
                      {deal.offerAmount && (
                        <p className="mt-1 font-medium text-gray-900">
                          {currencyFormatter.format(Number(deal.offerAmount))}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">{timeAgo(deal.updatedAt)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
