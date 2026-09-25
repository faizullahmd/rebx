import Link from "next/link";
import { getAllCommissionsAdmin } from "@/lib/data/commissions";
import { deleteCommission, markCommissionPaidOut } from "@/lib/actions/commissions";

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

export default async function AdminCommissionsPage() {
  const commissions = await getAllCommissionsAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">All commissions</h1>
      {commissions.length === 0 ? (
        <p className="text-sm text-gray-500">No commissions yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Source</th>
              <th className="py-2 font-medium">Amount</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Payout</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {commissions.map((commission) => (
              <tr key={commission.id} className="border-b border-gray-100">
                <td className="py-3">
                  <Link
                    href={`/listings/${commission.deal.listing.slug}`}
                    className="hover:underline"
                    target="_blank"
                  >
                    {commission.deal.listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">{commission.agent.name}</td>
                <td className="py-3 text-gray-600">
                  {commission.source === "DEVELOPER" ? "Developer" : "Customer"}
                </td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(commission.amount))}
                </td>
                <td className="py-3 text-gray-600">{statusLabels[commission.status]}</td>
                <td className="py-3 text-gray-600">
                  {commission.paidOutAt ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Paid out
                    </span>
                  ) : (
                    <form action={markCommissionPaidOut.bind(null, commission.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                      >
                        Mark paid out
                      </button>
                    </form>
                  )}
                </td>
                <td className="py-3 text-right">
                  <form action={deleteCommission.bind(null, commission.id)}>
                    <button type="submit" className="text-red-600 hover:text-red-800">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
