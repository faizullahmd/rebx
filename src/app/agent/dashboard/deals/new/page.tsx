import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { ManualDealForm } from "@/components/deals/ManualDealForm";

export default async function NewManualDealPage() {
  const user = await requireRole("AGENT");
  const listings = await getListingsForAgent(user.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New deal</h1>
      <p className="text-sm text-gray-600">
        Log a lead you picked up outside the platform (a phone call or walk-in, for example).
      </p>
      <ManualDealForm listings={listings} />
    </div>
  );
}
