import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getCommissionsForAgent } from "@/lib/data/commissions";

import { formatListingPrice } from "@/lib/price";

const statusLabels: Record<string, string> = {
  PENDING: "Pending",
  INVOICED: "Invoiced",
  RECEIVED: "Received",
};

export default async function AgentCommissionsPage() {
  const user = await requireRole("AGENT");
  const commissions = await getCommissionsForAgent(user.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Commissions</h1>

      {commissions.length === 0 ? (
        <p className="text-sm text-gray-500">
          No commissions yet. Add one from a closed deal&apos;s page.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-2xs">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/60 text-gray-500">
                <th className="py-2.5 px-3 font-medium">Listing</th>
                <th className="py-2.5 px-3 font-medium">Source</th>
                <th className="py-2.5 px-3 font-medium">Amount</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Payout</th>
                <th className="py-2.5 px-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((commission) => (
                <tr key={commission.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/40">
                  <td className="py-3 px-3">
                    <Link
                      href={`/agent/dashboard/deals/${commission.dealId}`}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {commission.deal.listing.title}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-gray-600">
                    {commission.source === "DEVELOPER" ? "Developer" : "Customer"}
                  </td>
                  <td className="py-3 px-3 text-gray-600">
                    {formatListingPrice(commission.amount, "INR")}
                  </td>
                  <td className="py-3 px-3 text-gray-600">{statusLabels[commission.status]}</td>
                  <td className="py-3 px-3 text-gray-600">
                    {commission.paidOutAt ? (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Paid out
                        {commission.paidOutBy ? ` by ${commission.paidOutBy.name}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not yet</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-gray-600">
                    {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                      commission.updatedAt
                    )}
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
