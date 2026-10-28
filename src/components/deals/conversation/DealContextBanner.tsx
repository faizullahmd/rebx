import { formatListingPrice } from "@/lib/price";

interface DealContextBannerProps {
  stage: string;
  offerAmount: number | null;
  currency?: string;
  viewerRole: "AGENT" | "CUSTOMER";
  advanceStatus?: "PENDING" | "PAID" | null;
  advanceAmount?: number | null;
}

export function DealContextBanner({
  stage,
  offerAmount,
  currency = "INR",
  viewerRole,
  advanceStatus,
  advanceAmount,
}: DealContextBannerProps) {
  const formattedAmount = offerAmount ? formatListingPrice(offerAmount, currency) : "";

  let bannerText = "";
  let toneClass = "bg-blue-50 text-blue-900 border-blue-200";

  if (viewerRole === "AGENT") {
    switch (stage) {
      case "NEW":
        bannerText = "New inquiry. Reply to start the conversation.";
        toneClass = "bg-blue-50 text-blue-900 border-blue-200";
        break;
      case "CONTACTED":
        bannerText = "Waiting for the customer's reply.";
        toneClass = "bg-sky-50 text-sky-900 border-sky-200";
        break;
      case "VIEWING_SCHEDULED":
        // Omit banner since dedicated site visit management card & status flow are active
        return null;
      case "OFFER_MADE":
        bannerText = formattedAmount
          ? `Customer offered ${formattedAmount}. Accept, counter, or reject.`
          : "Customer made an offer. Accept, counter, or reject.";
        toneClass = "bg-amber-50 text-amber-900 border-amber-200";
        break;
      case "NEGOTIATION":
        bannerText = "Counter sent. Waiting for the customer's decision.";
        toneClass = "bg-orange-50 text-orange-900 border-orange-200";
        break;
      case "UNDER_CONTRACT":
        bannerText = "Offer agreed. Add booking details and the advance.";
        toneClass = "bg-teal-50 text-teal-900 border-teal-200";
        break;
      case "CLOSED_WON":
        bannerText = "Deal closed (Won).";
        toneClass = "bg-green-50 text-green-900 border-green-200";
        break;
      case "CLOSED_LOST":
        bannerText = "Deal closed (Lost).";
        toneClass = "bg-red-50 text-red-900 border-red-200";
        break;
      default:
        bannerText = "Active negotiation.";
        toneClass = "bg-gray-50 text-gray-900 border-gray-200";
    }
  } else {
    // Customer perspective
    switch (stage) {
      case "NEW":
        bannerText = "Your inquiry has been received. The agent will reply soon.";
        toneClass = "bg-blue-50 text-blue-900 border-blue-200";
        break;
      case "CONTACTED":
        bannerText = "Agent replied. You can continue the discussion or submit an offer below.";
        toneClass = "bg-sky-50 text-sky-900 border-sky-200";
        break;
      case "VIEWING_SCHEDULED":
        // Omit outdated banner since CustomerSiteVisitBanner & conversation card display full details
        return null;
      case "OFFER_MADE":
        bannerText = formattedAmount
          ? `Your offer of ${formattedAmount} is awaiting the agent's review.`
          : "Your offer is awaiting the agent's review.";
        toneClass = "bg-amber-50 text-amber-900 border-amber-200";
        break;
      case "NEGOTIATION":
        bannerText = "The agent sent a counter-offer. You can accept, counter, or reject.";
        toneClass = "bg-orange-50 text-orange-900 border-orange-200";
        break;
      case "UNDER_CONTRACT":
        if (advanceStatus === "PAID") {
          bannerText = "Advance received. Your booking is progressing.";
          toneClass = "bg-green-50 text-green-900 border-green-200";
        } else if (advanceStatus === "PENDING") {
          const advStr = advanceAmount ? formatListingPrice(advanceAmount, currency) : formattedAmount;
          bannerText = advStr
            ? `Advance of ${advStr} is pending. Contact your agent to complete it.`
            : "Advance of amount is pending. Contact your agent to complete it.";
          toneClass = "bg-amber-50 text-amber-900 border-amber-200";
        } else {
          bannerText = "Your offer was accepted. The agent will share booking details shortly.";
          toneClass = "bg-teal-50 text-teal-900 border-teal-200";
        }
        break;
      case "CLOSED_WON":
        bannerText = "Booking confirmed. Congratulations!";
        toneClass = "bg-green-50 text-green-900 border-green-200";
        break;
      case "CLOSED_LOST":
        bannerText = "This inquiry is closed.";
        toneClass = "bg-red-50 text-red-900 border-red-200";
        break;
      default:
        bannerText = "Active negotiation.";
        toneClass = "bg-gray-50 text-gray-900 border-gray-200";
    }
  }

  if (!bannerText) {
    return null;
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-xs sm:text-sm font-medium ${toneClass}`}
      role="status"
    >
      <span className="text-base select-none">💬</span>
      <span>{bannerText}</span>
    </div>
  );
}
