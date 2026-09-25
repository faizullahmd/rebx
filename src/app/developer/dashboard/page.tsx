import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForDeveloper } from "@/lib/data/listings";
import { getCommissionsForDeveloper } from "@/lib/data/commissions";
import { getBookingsForDeveloper } from "@/lib/data/bookings";
import { markCommissionPaidOut } from "@/lib/actions/commissions";

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

export default async function DeveloperDashboardPage() {
  const user = await requireRole("DEVELOPER");
  const [listings, commissions, bookings] = await Promise.all([
    getListingsForDeveloper(user.id),
    getCommissionsForDeveloper(user.id),
    getBookingsForDeveloper(user.id),
  ]);
  const pendingBookings = bookings.filter((booking) => booking.status === "PENDING_CONFIRMATION");

  return (
    <div className="flex flex-col gap-6">
      {pendingBookings.length > 0 && (
        <Link
          href="/developer/dashboard/bookings"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          {pendingBookings.length} booking{pendingBookings.length === 1 ? "" : "s"} awaiting your
          confirmation →
        </Link>
      )}

      <div>
        <h1 className="text-2xl font-semibold">My properties</h1>
        <p className="text-gray-600">Listings agents have linked to your company.</p>
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-gray-500">
          No listings linked to you yet. An agent can link a listing to your account when they
          create it.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">City</th>
              <th className="py-2 font-medium">Price</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id} className="border-b border-gray-100">
                <td className="py-3">{listing.title}</td>
                <td className="py-3 text-gray-600">{listing.agent.name}</td>
                <td className="py-3 text-gray-600">{listing.city}</td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(listing.price))}
                </td>
                <td className="py-3 text-gray-600">{listing.status.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <h2 className="text-xl font-semibold">Commissions owed to agents</h2>
        <p className="text-gray-600">For deals closed on your linked properties.</p>
      </div>

      {commissions.length === 0 ? (
        <p className="text-sm text-gray-500">No commissions owed yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Amount</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Payout</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {commissions.map((commission) => (
              <tr key={commission.id} className="border-b border-gray-100">
                <td className="py-3">{commission.deal.listing.title}</td>
                <td className="py-3 text-gray-600">{commission.agent.name}</td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(commission.amount))}
                </td>
                <td className="py-3 text-gray-600">{statusLabels[commission.status]}</td>
                <td className="py-3 text-gray-600">
                  {commission.paidOutAt ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      Paid out {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(commission.paidOutAt)}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Not yet</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  {!commission.paidOutAt && (
                    <form action={markCommissionPaidOut.bind(null, commission.id)}>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                      >
                        Mark paid out
                      </button>
                    </form>
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
