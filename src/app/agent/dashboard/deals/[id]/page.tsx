import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getDealForConversation, getDealMessages } from "@/lib/data/deals";
import { getSiteVisitsForDeal } from "@/lib/data/site-visits";
import { DealHeaderCard } from "@/components/deals/conversation/DealHeaderCard";
import { DealConversationView } from "@/components/deals/conversation/DealConversationView";
import { DealTabs } from "@/components/deals/conversation/DealTabs";
import { DealMoreMenu } from "@/components/deals/conversation/DealMoreMenu";
import { DealContextBanner } from "@/components/deals/conversation/DealContextBanner";

export const dynamic = "force-dynamic";

export default async function AgentDealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const dealId = Number(id);
  if (Number.isNaN(dealId)) {
    notFound();
  }

  const user = await requireRole("AGENT");
  const deal = await getDealForConversation(dealId, "AGENT", user.id);

  if (!deal) {
    notFound();
  }

  const [messages, siteVisits] = await Promise.all([
    getDealMessages(dealId, "AGENT", user.id),
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

  const privateNotes = messages
    .filter((m) => m.type === "NOTE")
    .map((m) => ({ id: m.id, text: m.text, createdAt: m.createdAt }));

  const firstOffer = messages.find(
    (m) => m.type === "OFFER" && m.amount != null && Number(m.amount) > 0
  );
  const initialOfferAmount = firstOffer
    ? Number(firstOffer.amount)
    : deal.offerAmount
      ? Number(deal.offerAmount)
      : null;

  const offerAmountNumber = deal.offerAmount ? Number(deal.offerAmount) : null;
  const listingPriceNumber = deal.listing.price ? Number(deal.listing.price) : null;

  const acceptedOffer = messages.find(
    (m) => m.type === "OFFER" && m.offerStatus === "ACCEPTED"
  );
  const acceptedOfferAmount = acceptedOffer?.amount
    ? Number(acceptedOffer.amount)
    : deal.offerAmount
      ? Number(deal.offerAmount)
      : null;
  const hasAcceptedOffer = Boolean(
    acceptedOffer ||
    deal.stage === "UNDER_CONTRACT" ||
    deal.stage === "CLOSED_WON"
  );

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto pb-12">
      {/* Top Bar: Back Link + More Actions Dropdown */}
      <div className="flex items-center justify-between">
        <Link
          href="/agent/dashboard/deals"
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>← Back to deals</span>
        </Link>
        <DealMoreMenu dealId={deal.id} currentStage={deal.stage} />
      </div>

      {/* 1. Header Summary Card */}
      <DealHeaderCard
        deal={{
          id: deal.id,
          stage: deal.stage,
          createdAt: deal.createdAt,
          offerAmount: offerAmountNumber,
          initialOfferAmount,
          contactName: deal.contactName,
          contactEmail: deal.contactEmail,
          contactPhone: deal.contactPhone,
          listing: {
            title: deal.listing.title,
            slug: deal.listing.slug,
            price: listingPriceNumber,
            priceDisplay: deal.listing.priceDisplay,
            currency: deal.listing.currency,
            city: deal.listing.city,
            state: deal.listing.state,
            propertyType: deal.listing.propertyType,
            images: deal.listing.images,
          },
          agent: deal.agent,
        }}
        viewerRole="AGENT"
      />

      {/* Context Banner */}
      <DealContextBanner
        stage={deal.stage}
        offerAmount={offerAmountNumber}
        currency={deal.listing.currency || "INR"}
        viewerRole="AGENT"
      />

      {/* 2. Conversation Card with Message Bubbles, Offer Cards, & Sticky Composer */}
      <DealConversationView
        dealId={deal.id}
        messages={messages}
        viewerRole="AGENT"
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

      {/* 4. Tabs below the thread: Booking | Commission | Private Notes */}
      <DealTabs
        dealId={deal.id}
        dealStage={deal.stage}
        hasDeveloper={deal.listing.developerId !== null}
        hasAcceptedOffer={hasAcceptedOffer}
        acceptedOfferAmount={acceptedOfferAmount}
        currency={deal.listing.currency === "USD" ? "INR" : (deal.listing.currency || "INR")}
        booking={
          deal.booking
            ? {
                ...deal.booking,
                saleAmount: Number(deal.booking.saleAmount),
                advance: deal.booking.advance
                  ? {
                      ...deal.booking.advance,
                      amount: Number(deal.booking.advance.amount),
                      percentUsed: Number(deal.booking.advance.percentUsed),
                    }
                  : null,
              }
            : null
        }
        commissions={deal.commissions.map((c) => ({
          ...c,
          amount: Number(c.amount),
        }))}
        privateNotes={privateNotes}
      />
    </div>
  );
}
