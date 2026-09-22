import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { getDealsForAgent } from "@/lib/data/deals";
import { getCommissionsForAgent } from "@/lib/data/commissions";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function AgentOverviewPage() {
  const user = await requireRole("AGENT");
  const [listings, deals, commissions] = await Promise.all([
    getListingsForAgent(user.id),
    getDealsForAgent(user.id),
    getCommissionsForAgent(user.id),
  ]);

  const active = listings.filter((l) => l.status === "ACTIVE").length;
  const draft = listings.filter((l) => l.status === "DRAFT").length;
  const underOffer = listings.filter((l) => l.status === "UNDER_OFFER").length;
  const sold = listings.filter((l) => l.status === "SOLD").length;
  const newLeads = deals.filter((d) => d.stage === "NEW").length;
  const pendingCommissions = commissions
    .filter((c) => c.status !== "RECEIVED")
    .reduce((sum, c) => sum + Number(c.amount), 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {user.name}</h1>
        <p className="text-gray-600">Here&apos;s what&apos;s happening with your listings.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <Stat label="Active" value={active} />
        <Stat label="Draft" value={draft} />
        <Stat label="Under offer" value={underOffer} />
        <Stat label="Sold" value={sold} />
        <Stat label="New leads" value={newLeads} />
        <Stat label="Pending commissions" value={currencyFormatter.format(pendingCommissions)} />
      </div>

      <Link
        href="/agent/dashboard/listings/new"
        className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        + New listing
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
