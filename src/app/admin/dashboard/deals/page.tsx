import Link from "next/link";
import { getAllDealsAdmin } from "@/lib/data/deals";
import { deleteDeal } from "@/lib/actions/deals";

const stageLabels: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  VIEWING_SCHEDULED: "Viewing scheduled",
  OFFER_MADE: "Offer made",
  NEGOTIATION: "Negotiation",
  UNDER_CONTRACT: "Under contract",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

export default async function AdminDealsPage() {
  const deals = await getAllDealsAdmin();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">All deals</h1>
      {deals.length === 0 ? (
        <p className="text-sm text-gray-500">No deals yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">Listing</th>
              <th className="py-2 font-medium">Agent</th>
              <th className="py-2 font-medium">Contact</th>
              <th className="py-2 font-medium">Stage</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id} className="border-b border-gray-100">
                <td className="py-3">
                  <Link
                    href={`/listings/${deal.listing.slug}`}
                    className="hover:underline"
                    target="_blank"
                  >
                    {deal.listing.title}
                  </Link>
                </td>
                <td className="py-3 text-gray-600">{deal.agent.name}</td>
                <td className="py-3 text-gray-600">{deal.contactName}</td>
                <td className="py-3 text-gray-600">{stageLabels[deal.stage]}</td>
                <td className="py-3 text-right">
                  <form action={deleteDeal.bind(null, deal.id)}>
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
