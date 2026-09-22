import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getCommissionsForAgent } from "@/lib/data/commissions";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Source</th>
              <th className="py-2 font-medium">Amount</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {commissions.map((commission) => (
              <tr key={commission.id} className="border-b border-gray-100">
                <td className="py-3">
                  <Link
                    href={`/agent/dashboard/deals/${commission.dealId}`}
                    className="hover:underline"
                  >
                    {commission.deal.listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">
                  {commission.source === "DEVELOPER" ? "Developer" : "Customer"}
                </td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(commission.amount))}
                </td>
                <td className="py-3 text-gray-600">{statusLabels[commission.status]}</td>
                <td className="py-3 text-gray-600">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                    commission.updatedAt
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
