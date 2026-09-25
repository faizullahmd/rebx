import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getDealById } from "@/lib/data/deals";
import { updateDeal, deleteDeal } from "@/lib/actions/deals";
import { DealEditForm } from "@/components/deals/DealEditForm";
import { CommissionPanel } from "@/components/commissions/CommissionPanel";
import { BookingPanel } from "@/components/bookings/BookingPanel";

export default async function AgentDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireRole("AGENT");
  const deal = await getDealById(id);

  if (!deal || deal.agentId !== user.id) {
    notFound();
  }

  const { commissions, booking, ...dealWithoutCommissions } = deal;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/agent/dashboard/deals" className="text-sm text-gray-500 hover:text-gray-900">
          ← Back to deals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{deal.contactName}</h1>
        <p className="text-gray-600">
          Interested in{" "}
          <Link href={`/listings/${deal.listing.slug}`} className="underline" target="_blank">
            {deal.listing.title}
          </Link>
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-4 text-sm">
        <p>
          <span className="text-gray-500">Email:</span> {deal.contactEmail}
        </p>
        {deal.contactPhone && (
          <p>
            <span className="text-gray-500">Phone:</span> {deal.contactPhone}
          </p>
        )}
        {deal.message && (
          <p className="mt-2 whitespace-pre-wrap text-gray-700">
            <span className="text-gray-500">Message:</span> {deal.message}
          </p>
        )}
      </div>

      <DealEditForm
        deal={{
          ...dealWithoutCommissions,
          offerAmount: deal.offerAmount ? Number(deal.offerAmount) : null,
        }}
        action={updateDeal.bind(null, deal.id)}
      />

      {deal.stage === "CLOSED_WON" && booking && (
        <BookingPanel booking={{ ...booking, saleAmount: Number(booking.saleAmount) }} />
      )}

      {deal.stage === "CLOSED_WON" &&
        (booking?.status === "CONFIRMED" ? (
          <CommissionPanel
            dealId={deal.id}
            hasDeveloper={deal.listing.developerId !== null}
            commissions={commissions.map((c) => ({ ...c, amount: Number(c.amount) }))}
          />
        ) : (
          <p className="max-w-2xl rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Commission can be logged once the developer confirms the booking above.
          </p>
        ))}

      <form action={deleteDeal.bind(null, deal.id)}>
        <button type="submit" className="text-sm text-red-600 hover:text-red-800">
          Delete deal
        </button>
      </form>
    </div>
  );
}
