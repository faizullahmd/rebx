import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForDeveloper } from "@/lib/data/listings";
import { getCommissionsForDeveloper } from "@/lib/data/commissions";
import { getBookingsForDeveloper } from "@/lib/data/bookings";
import { markCommissionPaidOut } from "@/lib/actions/commissions";
import { deleteListing } from "@/lib/actions/listings";

import { formatListingPrice } from "@/lib/price";

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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">My properties</h1>
          <p className="text-gray-600">Listings agents have linked to your company.</p>
        </div>
        <Link
          href="/developer/dashboard/listings/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-gray-500">
          No listings linked to you yet. You can create a new listing or an agent can link a listing to your account.
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
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {listings.map((listing) => (
              <tr key={listing.id} className="border-b border-gray-100">
                <td className="py-3">{listing.title}</td>
                <td className="py-3 text-gray-600">{listing.agent.name}</td>
                <td className="py-3 text-gray-600">{listing.city}</td>
                <td className="py-3 text-gray-600">
                  {formatListingPrice(listing.price, listing.currency, (listing as any).priceDisplay)}
                </td>
                <td className="py-3">
                  <StatusBadge status={listing.status} />
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/developer/dashboard/listings/${listing.id}/videos`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                      title={
                        (listing.videos?.length || 0) > 0
                          ? `${listing.videos.length} video${listing.videos.length === 1 ? "" : "s"} added`
                          : "Add videos"
                      }
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span>
                        {(listing.videos?.length || 0) > 0
                          ? `Videos (${listing.videos.length})`
                          : "Add videos"}
                      </span>
                    </Link>
                    <Link
                      href={`/developer/dashboard/listings/${listing.id}/edit`}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Edit
                    </Link>
                    <form action={deleteListing.bind(null, listing.id)}>
                      <button type="submit" className="text-red-600 hover:text-red-800 cursor-pointer">
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
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
                  {formatListingPrice(commission.amount, "INR")}
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700",
    ACTIVE: "bg-green-100 text-green-700",
    UNDER_OFFER: "bg-amber-100 text-amber-700",
    SOLD: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
