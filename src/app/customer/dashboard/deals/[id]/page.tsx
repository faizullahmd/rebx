import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getDealForConversation, getDealMessages } from "@/lib/data/deals";
import { getSiteVisitsForDeal } from "@/lib/data/site-visits";
import { CustomerDealChatHeader } from "@/components/deals/conversation/CustomerDealChatHeader";
import { DealConversationView } from "@/components/deals/conversation/DealConversationView";
import { DealContextBanner } from "@/components/deals/conversation/DealContextBanner";
import { CustomerBookingAdvanceCard } from "@/components/deals/booking/CustomerBookingAdvanceCard";

export const dynamic = "force-dynamic";

export default async function CustomerDealChatPage({
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

  const [messages, siteVisits] = await Promise.all([
    getDealMessages(dealId, "CUSTOMER", user.id, user.email),
    getSiteVisitsForDeal(dealId),
  ]);

  const serializedSiteVisits = siteVisits.map((v) => ({
    ...v,
    date: v.date.toISOString(),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    reminded24hAt: v.reminded24hAt?.toISOString() || null,
    reminded1hAt: v.reminded1hAt?.toISOString() || null,
  }));

  const firstOffer = messages.find(
    (m) => m.type === "OFFER" && m.amount != null && Number(m.amount) > 0
  );
  const initialOfferAmount = firstOffer
    ? Number(firstOffer.amount)
    : deal.offerAmount
      ? Number(deal.offerAmount)
      : null;

  const listingPriceNumber = deal.listing.price ? Number(deal.listing.price) : null;

  const hasAcceptedOffer =
    deal.stage !== "CLOSED_LOST" &&
    (deal.stage === "UNDER_CONTRACT" ||
      deal.stage === "CLOSED_WON" ||
      messages.some((m) => m.type === "OFFER" && m.offerStatus === "ACCEPTED"));

  const advance = (deal.booking as any)?.advance ?? null;
  const advanceAmount = advance?.amount != null ? Number(advance.amount) : null;
  const advanceStatus = advance?.status ?? null;

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto pb-12">
      {/* Top Bar: Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/customer/dashboard/deals"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>← Back to Deals</span>
        </Link>
      </div>

      {/* 1. Dedicated Header Card for Deals Chat */}
      <CustomerDealChatHeader
        deal={{
          id: deal.id,
          stage: deal.stage,
          createdAt: deal.createdAt,
          initialOfferAmount,
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

      {/* Context Banner */}
      <DealContextBanner
        stage={deal.stage}
        offerAmount={initialOfferAmount}
        currency={deal.listing.currency || "INR"}
        viewerRole="CUSTOMER"
        advanceStatus={advanceStatus}
        advanceAmount={advanceAmount}
      />

      {/* 2. Conversation Card with Message Bubbles, Offer Cards, & Sticky Composer */}
      <DealConversationView
        dealId={deal.id}
        messages={messages}
        viewerRole="CUSTOMER"
        dealAgentName={deal.agent.name}
        dealCustomerName={deal.contactName}
        currencySymbol={
          deal.listing.currency === "USD" || deal.listing.currency === "INR" || !deal.listing.currency
            ? "₹"
            : deal.listing.currency
        }
        siteVisits={serializedSiteVisits}
        propertyTitle={deal.listing.title}
        propertyAddress={[deal.listing.addressLine, deal.listing.city, deal.listing.state]
          .filter(Boolean)
          .join(", ")}
      />

      {/* 3. Booking & advance Card (Customer Read-Only, shown ONLY when offer accepted / closed won) */}
      {hasAcceptedOffer && (
        <CustomerBookingAdvanceCard
          propertyName={deal.listing.title}
          currency={deal.listing.currency === "USD" ? "INR" : (deal.listing.currency || "INR")}
          agreedPrice={deal.offerAmount ? Number(deal.offerAmount) : listingPriceNumber}
          booking={
            deal.booking
              ? {
                  ...deal.booking,
                  saleAmount: Number(deal.booking.saleAmount),
                  advance: (deal.booking as any).advance
                    ? {
                        ...(deal.booking as any).advance,
                        amount: Number((deal.booking as any).advance.amount),
                        percentUsed: Number((deal.booking as any).advance.percentUsed),
                      }
                    : null,
                }
              : null
          }
        />
      )}
    </div>
  );
}
