import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { deleteListing } from "@/lib/actions/listings";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function AgentListingsPage() {
  const user = await requireRole("AGENT");
  const listings = await getListingsForAgent(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My listings</h1>
        <Link
          href="/agent/dashboard/listings/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New listing
        </Link>
      </div>

      {listings.length === 0 ? (
        <p className="text-sm text-gray-500">You haven&apos;t created any listings yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Title</th>
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
                <td className="py-3 text-gray-600">{listing.city}</td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(listing.price))}
                </td>
                <td className="py-3">
                  <StatusBadge status={listing.status} />
                </td>
                <td className="py-3 text-right">
                  <div className="flex justify-end gap-3">
                    <Link
                      href={`/agent/dashboard/listings/${listing.id}/edit`}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Edit
                    </Link>
                    <form action={deleteListing.bind(null, listing.id)}>
                      <button type="submit" className="text-red-600 hover:text-red-800">
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
