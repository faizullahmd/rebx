import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getDealForConversation, getDealMessages } from "@/lib/data/deals";
import { CustomerInquiryChatHeader } from "@/components/deals/conversation/CustomerInquiryChatHeader";
import { DealConversationView } from "@/components/deals/conversation/DealConversationView";
import { formatListingPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

export default async function CustomerOverviewChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dealId = Number(id);
  if (Number.isNaN(dealId)) {
    notFound();
  }

  const user = await requireRole("CUSTOMER");
  const deal = await getDealForConversation(dealId, "CUSTOMER", user.id, user.email);

  if (!deal) {
    notFound();
  }

  const messages = await getDealMessages(dealId, "CUSTOMER", user.id, user.email);

  const listingPriceNumber = deal.listing.price ? Number(deal.listing.price) : null;

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto pb-12">
      {/* Top Bar: Back to Overview Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/customer/dashboard"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>← Back to Overview</span>
        </Link>
      </div>

      {/* 1. Dedicated Header Card for Overview Chat */}
      <CustomerInquiryChatHeader
        deal={{
          id: deal.id,
          stage: deal.stage,
          createdAt: deal.createdAt,
          listing: {
            title: deal.listing.title,
            slug: deal.listing.slug,
            price: listingPriceNumber,
            priceDisplay: deal.listing.priceDisplay,
            currency: deal.listing.currency,
            images: deal.listing.images,
          },
        }}
      />

      {/* 2. Conversation Card with Message Bubbles, Offer Cards, & Sticky Composer */}
      <DealConversationView
        dealId={deal.id}
        messages={messages}
        viewerRole="CUSTOMER"
        dealAgentName={deal.agent.name}
        dealCustomerName={deal.contactName}
        currencySymbol={deal.listing.currency === "INR" || !deal.listing.currency ? "₹" : deal.listing.currency}
      />

      {/* 3. Booking Summary (Customer Read-Only, when under contract or closed) */}
      {deal.booking && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-xs">
          <div className="flex items-center gap-2 mb-3">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-semibold text-emerald-900">
              Booking Confirmation & Details
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-gray-500">Agreed Sale Amount</p>
              <p className="font-semibold text-gray-900 text-sm mt-0.5">
                {formatListingPrice(deal.booking.saleAmount, deal.listing.currency)}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Booking Status</p>
              <p className="font-medium text-emerald-700 capitalize mt-0.5">
                {deal.booking.status.toLowerCase().replace("_", " ")}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Booking Date</p>
              <p className="font-medium text-gray-800 mt-0.5">
                {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                  new Date(deal.booking.bookingDate)
                )}
              </p>
            </div>
            {deal.booking.unitNumber && (
              <div>
                <p className="text-gray-500">Unit / Flat</p>
                <p className="font-medium text-gray-800 mt-0.5">
                  {deal.booking.unitNumber}
                </p>
              </div>
            )}
            {deal.booking.bookingNumber && (
              <div>
                <p className="text-gray-500">Booking Reference #</p>
                <p className="font-medium text-gray-800 mt-0.5">
                  {deal.booking.bookingNumber}
                </p>
              </div>
            )}
          </div>
          {deal.booking.notes && (
            <div className="mt-3 pt-3 border-t border-emerald-100 text-xs text-emerald-950">
              <span className="font-medium">Booking notes:</span> {deal.booking.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
