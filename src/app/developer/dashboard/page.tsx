import { requireRole } from "@/lib/session";
import { getListingsForDeveloper } from "@/lib/data/listings";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function DeveloperDashboardPage() {
  const user = await requireRole("DEVELOPER");
  const listings = await getListingsForDeveloper(user.id);

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
