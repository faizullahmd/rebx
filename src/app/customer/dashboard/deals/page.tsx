import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDealsForCustomer } from "@/lib/data/deals";
import { DEAL_STAGE_LABELS, type DEAL_STAGES } from "@/lib/validation/deal";
import { formatListingPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

type Stage = (typeof DEAL_STAGES)[number];

const STAGE_BADGE: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800 border-blue-200",
  CONTACTED: "bg-sky-100 text-sky-800 border-sky-200",
  VIEWING_SCHEDULED: "bg-violet-100 text-violet-800 border-violet-200",
  OFFER_MADE: "bg-amber-100 text-amber-800 border-amber-200",
  NEGOTIATION: "bg-orange-100 text-orange-800 border-orange-200",
  UNDER_CONTRACT: "bg-teal-100 text-teal-800 border-teal-200",
  CLOSED_WON: "bg-green-100 text-green-800 border-green-200",
  CLOSED_LOST: "bg-red-100 text-red-800 border-red-200",
};

export default async function CustomerDealsListPage() {
  const user = await requireRole("CUSTOMER");
  const deals = await getDealsForCustomer(user.id, user.email);

  const dateFormat = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Deals</h1>
        <p className="mt-1 text-sm text-gray-600">
          Track property deals, negotiate offers directly with listing agents, and follow agreement progress.
        </p>
      </div>

      {deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 p-12 text-center">
          <span className="text-3xl mb-2">🏡</span>
          <p className="text-sm font-semibold text-gray-900">No deals yet</p>
          <p className="mt-1 text-xs text-gray-500 max-w-sm">
            Browse our listings and submit an offer to start a direct negotiation with the listing agent.
          </p>
          <Link
            href="/listings"
            className="mt-4 rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-gray-800"
          >
            Browse Properties
          </Link>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-xs overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {deals.map((deal) => {
              const photo = deal.listing.images?.[0]?.url;
              const priceDisplay = formatListingPrice(
                deal.listing.price ? Number(deal.listing.price) : null,
                deal.listing.currency,
                deal.listing.priceDisplay
              );
              const stageLabel = DEAL_STAGE_LABELS[deal.stage as Stage] || deal.stage;
              const badgeStyle = STAGE_BADGE[deal.stage] || "bg-gray-100 text-gray-800 border-gray-200";

              return (
                <li
                  key={deal.id}
                  className="p-4 sm:p-5 hover:bg-gray-50/70 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={deal.listing.title}
                        className="h-16 w-16 sm:h-20 sm:w-20 rounded-lg object-cover shrink-0 border border-gray-100"
                      />
                    ) : (
                      <div className="flex h-16 w-16 sm:h-20 sm:w-20 items-center justify-center rounded-lg bg-gray-100 text-gray-400 text-xl shrink-0">
                        🏠
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/customer/dashboard/deals/${deal.id}`}
                          className="font-bold text-sm sm:text-base text-gray-900 hover:text-blue-600 truncate transition-colors"
                        >
                          {deal.listing.title}
                        </Link>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeStyle}`}
                        >
                          {stageLabel}
                        </span>
                        {deal.unreadCount > 0 && (
                          <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-2xs">
                            {deal.unreadCount} new
                          </span>
                        )}
                      </div>

                      <p className="mt-0.5 text-xs text-gray-500">
                        Listing price: <strong className="text-gray-800">{priceDisplay}</strong> · Agent:{" "}
                        <span className="text-gray-700">{deal.agent.name}</span>
                      </p>

                      {/* Last message preview */}
                      {deal.lastMessage ? (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
                          <span className="shrink-0 font-medium text-gray-400">
                            {deal.lastMessage.senderRole === "CUSTOMER" ? "You:" : "Agent:"}
                          </span>
                          <span className="truncate italic">
                            {deal.lastMessage.type === "OFFER"
                              ? `Offer ${deal.lastMessage.amount ? `₹ ${Number(deal.lastMessage.amount).toLocaleString("en-IN")}` : ""}`
                              : deal.lastMessage.text}
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-xs italic text-gray-400">No messages yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                    <span className="text-xs text-gray-400">
                      Updated {dateFormat.format(new Date(deal.updatedAt))}
                    </span>
                    <Link
                      href={`/customer/dashboard/deals/${deal.id}`}
                      className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 transition-colors"
                    >
                      Open conversation →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
