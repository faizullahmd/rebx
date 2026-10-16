import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDealsForAgent } from "@/lib/data/deals";
import { DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/validation/deal";
import { DealRowManage } from "@/components/deals/DealRowManage";

export const dynamic = "force-dynamic";

type Stage = (typeof DEAL_STAGES)[number];
const PAGE_SIZE = 15;

const STAGE_TONE: Record<Stage, { box: string; badge: string }> = {
  NEW: { box: "border-blue-200 bg-blue-50 text-blue-900", badge: "bg-blue-100 text-blue-800" },
  CONTACTED: { box: "border-sky-200 bg-sky-50 text-sky-900", badge: "bg-sky-100 text-sky-800" },
  VIEWING_SCHEDULED: { box: "border-violet-200 bg-violet-50 text-violet-900", badge: "bg-violet-100 text-violet-800" },
  OFFER_MADE: { box: "border-amber-200 bg-amber-50 text-amber-900", badge: "bg-amber-100 text-amber-800" },
  NEGOTIATION: { box: "border-orange-200 bg-orange-50 text-orange-900", badge: "bg-orange-100 text-orange-800" },
  UNDER_CONTRACT: { box: "border-teal-200 bg-teal-50 text-teal-900", badge: "bg-teal-100 text-teal-800" },
  CLOSED_WON: { box: "border-green-200 bg-green-50 text-green-900", badge: "bg-green-100 text-green-800" },
  CLOSED_LOST: { box: "border-red-200 bg-red-50 text-red-900", badge: "bg-red-100 text-red-800" },
};

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function href(params: { stage?: string; q?: string; page?: number }) {
  const sp = new URLSearchParams();
  if (params.stage) sp.set("stage", params.stage);
  if (params.q) sp.set("q", params.q);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return `/agent/dashboard/deals${qs ? `?${qs}` : ""}`;
}

export default async function AgentDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string; page?: string }>;
}) {
  const user = await requireRole("AGENT");
  const { stage: rawStage, q: rawQ, page: rawPage } = await searchParams;
  const stageFilter = DEAL_STAGES.includes(rawStage as Stage) ? (rawStage as Stage) : undefined;
  const q = (rawQ ?? "").trim().slice(0, 100);

  const all = (await getDealsForAgent(user.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const counts = Object.fromEntries(DEAL_STAGES.map((s) => [s, all.filter((d) => d.stage === s).length])) as Record<Stage, number>;

  const needle = q.toLowerCase();
  const filtered = all.filter(
    (d) =>
      (!stageFilter || d.stage === stageFilter) &&
      (!needle ||
        [d.contactName, d.contactEmail, d.contactPhone ?? "", d.message ?? "", d.listing.title].some((v) => v.toLowerCase().includes(needle)))
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Deals</h1>
          <p className="mt-1 text-sm text-gray-500">{all.length} inquiries and deals across your listings.</p>
        </div>
        <Link
          href="/agent/dashboard/deals/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New deal
        </Link>
      </div>

      {all.length === 0 ? (
        <p className="text-sm text-gray-500">
          No deals yet. Deals appear here when a customer inquires on one of your listings, or you
          can add one manually.
        </p>
      ) : (
        <>
          <nav aria-label="Deals by stage" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
            {DEAL_STAGES.map((s) => {
              const active = stageFilter === s;
              return (
                <Link
                  key={s}
                  href={href({ stage: active ? undefined : s, q })}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-lg border px-3 py-2 transition hover:shadow-sm ${STAGE_TONE[s].box} ${active ? "ring-2 ring-gray-900" : ""}`}
                >
                  <span className="block text-2xl font-semibold leading-tight">{counts[s]}</span>
                  <span className="block truncate text-xs font-medium">{DEAL_STAGE_LABELS[s]}</span>
                </Link>
              );
            })}
          </nav>

          <form action="/agent/dashboard/deals" className="flex flex-wrap items-center gap-2">
            {stageFilter && <input type="hidden" name="stage" value={stageFilter} />}
            <input
              name="q"
              defaultValue={q}
              placeholder="Search contact, listing or message"
              aria-label="Search deals"
              className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Search</button>
            {(stageFilter || q) && (
              <Link href="/agent/dashboard/deals" className="text-sm text-gray-500 underline hover:text-gray-900">
                Clear filters
              </Link>
            )}
            <span className="ml-auto text-xs text-gray-500">
              {stageFilter ? `${DEAL_STAGE_LABELS[stageFilter]}: ` : ""}
              {filtered.length} shown
            </span>
          </form>

          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              No inquiries match these filters.
            </p>
          ) : (
            <div className="rounded-xl border border-gray-200">
              <div className="hidden grid-cols-12 gap-4 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 lg:grid">
                <span className="col-span-3">Contact</span>
                <span className="col-span-3">Property &amp; enquiry</span>
                <span className="col-span-2">Status</span>
                <span className="col-span-3">Manage</span>
                <span className="col-span-1" />
              </div>
              <ul className="divide-y divide-gray-200">
                {rows.map((deal) => {
                  const offer = deal.offerAmount ? Number(deal.offerAmount) : null;
                  return (
                    <li key={deal.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-12 lg:gap-4">
                      <div className="min-w-0 lg:col-span-3">
                        <p className="font-medium text-gray-900">{deal.contactName}</p>
                        <a href={`mailto:${deal.contactEmail}`} className="block truncate text-xs text-gray-600 hover:underline">
                          {deal.contactEmail}
                        </a>
                        {deal.contactPhone && (
                          <a href={`tel:${deal.contactPhone.replace(/[^\d+]/g, "")}`} className="block text-xs text-gray-600 hover:underline">
                            {deal.contactPhone}
                          </a>
                        )}
                        <p className="mt-1 text-xs text-gray-400">
                          #{deal.id} · {dateFormat.format(deal.createdAt)}
                          {deal.customerId ? " · Account" : ""}
                        </p>
                      </div>

                      <div className="min-w-0 lg:col-span-3">
                        <Link href={`/listings/${deal.listing.slug}`} target="_blank" className="font-medium text-gray-900 hover:underline">
                          {deal.listing.title}
                        </Link>
                        {deal.message ? (
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-gray-600" title={deal.message}>
                            “{deal.message}”
                          </p>
                        ) : (
                          <p className="mt-1 text-xs italic text-gray-400">No message, just interested.</p>
                        )}
                      </div>

                      <div className="flex flex-col items-start gap-1 lg:col-span-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_TONE[deal.stage].badge}`}>
                          {DEAL_STAGE_LABELS[deal.stage]}
                        </span>
                        {deal.booking && (
                          <span className={`rounded-full px-2 py-0.5 text-xs ${deal.booking.status === "CONFIRMED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                            Booking {deal.booking.status.replaceAll("_", " ").toLowerCase()}
                          </span>
                        )}
                        {offer !== null && <span className="text-xs text-gray-600">Offer: {offer.toLocaleString("en-IN")}</span>}
                        <span className="text-xs text-gray-400">Updated {dateFormat.format(deal.updatedAt)}</span>
                      </div>

                      <div className="min-w-0 lg:col-span-3">
                        <DealRowManage
                          dealId={deal.id}
                          stage={deal.stage}
                          offerAmount={offer}
                          notes={deal.notes}
                        />
                      </div>

                      <div className="lg:col-span-1 lg:text-right">
                        <Link href={`/agent/dashboard/deals/${deal.id}`} className="text-xs font-medium text-gray-900 underline hover:text-gray-600">
                          Open
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm">
              {page > 1 ? <Link href={href({ stage: stageFilter, q, page: page - 1 })} className="underline">← Previous</Link> : <span />}
              <span className="text-gray-500">Page {page} of {pageCount}</span>
              {page < pageCount ? <Link href={href({ stage: stageFilter, q, page: page + 1 })} className="underline">Next →</Link> : <span />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
