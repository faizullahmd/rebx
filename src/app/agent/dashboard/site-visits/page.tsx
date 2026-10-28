import { requireRole } from "@/lib/session";
import { getSiteVisitsForAgent, getSiteVisitStatsForAgent } from "@/lib/data/site-visits";
import { AgentSiteVisitsList } from "@/components/agent/site-visits/AgentSiteVisitsList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Site Visits | Agent Dashboard | REBX",
  description: "Manage client site visit requests, confirmations, cancellations, and reschedules.",
};

export default async function AgentSiteVisitsPage() {
  const user = await requireRole("AGENT");

  const [visits, stats] = await Promise.all([
    getSiteVisitsForAgent(user.id),
    getSiteVisitStatsForAgent(user.id),
  ]);

  // Serialize Prisma Decimal to primitive number/null for client component
  const serializedVisits = visits.map((v) => ({
    ...v,
    date: v.date.toISOString(),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    listing: {
      ...v.listing,
      price: v.listing.price ? Number(v.listing.price) : null,
    },
  }));

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Site Visits</h1>
          <p className="text-sm text-neutral-500">
            Review customer tour requests, confirm available slots, reschedule, or cancel visits.
          </p>
        </div>
      </div>

      <AgentSiteVisitsList initialVisits={serializedVisits} stats={stats} />
    </div>
  );
}
