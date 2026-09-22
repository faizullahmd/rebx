import Link from "next/link";
import { getAllListingsAdmin } from "@/lib/data/listings";
import { deleteListing } from "@/lib/actions/listings";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function AdminListingsPage() {
  const listings = await getAllListingsAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">All listings</h1>
      {listings.length === 0 ? (
        <p className="text-sm text-gray-500">No listings yet.</p>
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
                <td className="py-3">
                  <Link
                    href={`/listings/${listing.slug}`}
                    className="hover:underline"
                    target="_blank"
                  >
                    {listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">{listing.agent.name}</td>
                <td className="py-3 text-gray-600">{listing.city}</td>
                <td className="py-3 text-gray-600">
                  {currencyFormatter.format(Number(listing.price))}
                </td>
                <td className="py-3 text-gray-600">{listing.status.replace("_", " ")}</td>
                <td className="py-3 text-right">
                  <form action={deleteListing.bind(null, listing.id)}>
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
