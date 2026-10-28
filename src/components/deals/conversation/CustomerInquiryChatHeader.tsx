import Link from "next/link";
import { formatListingPrice } from "@/lib/price";
import { DEAL_STAGE_LABELS, type DEAL_STAGES } from "@/lib/validation/deal";
import {
  CustomerDealHeaderActions,
  type SerializedSiteVisitHeaderInfo,
} from "./CustomerDealHeaderActions";

type Stage = (typeof DEAL_STAGES)[number];

interface CustomerInquiryChatHeaderProps {
  deal: {
    id: number;
    stage: string;
    createdAt: Date;
    listing: {
      title: string;
      slug: string;
      price: number | null;
      priceDisplay?: string | null;
      currency?: string;
      images?: { url: string }[];
      address?: string | null;
    };
  };
  siteVisit?: SerializedSiteVisitHeaderInfo | null;
}

export function CustomerInquiryChatHeader({
  deal,
  siteVisit,
}: CustomerInquiryChatHeaderProps) {
  const listing = deal.listing;
  const photo = listing.images?.[0]?.url;

  // Listed offer price matching the listing page display
  const listedOfferPrice = formatListingPrice(
    listing.price,
    listing.currency || "INR",
    listing.priceDisplay
  );

  const enquiryDateFormatted = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(deal.createdAt));

  const statusLabel =
    deal.stage === "VIEWING_SCHEDULED"
      ? "Site Visit"
      : DEAL_STAGE_LABELS[deal.stage as Stage] || deal.stage;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Title + Key Metrics */}
        <div className="flex-1 min-w-0">
          <Link
            href={`/listings/${listing.slug}`}
            target="_blank"
            className="text-xl sm:text-2xl font-bold text-gray-900 hover:text-blue-600 transition-colors block truncate"
          >
            {listing.title}
          </Link>

          {/* 3 Metrics: Listed offer price | Enquiry Date | Status */}
          <div className="mt-4 flex flex-wrap items-center gap-6 sm:gap-10">
            <div>
              <span className="block text-xs font-medium text-gray-400">
                Listed offer price
              </span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900">
                {listedOfferPrice}
              </span>
            </div>

            <div className="h-8 w-px bg-gray-100 hidden sm:block" />

            <div>
              <span className="block text-xs font-medium text-gray-400">
                Enquiry Date
              </span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900">
                {enquiryDateFormatted}
              </span>
            </div>

            <div className="h-8 w-px bg-gray-100 hidden sm:block" />

            <div>
              <span className="block text-xs font-medium text-gray-400">Status</span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900 capitalize">
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Framed Brand / Property Box */}
        <div className="shrink-0 self-start sm:self-center">
          {photo ? (
            <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt={listing.title}
                className="h-full w-full rounded object-cover"
              />
            </div>
          ) : (
            <div className="flex h-16 w-28 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-center">
              <span className="text-xs font-bold text-indigo-900 truncate">
                {listing.title}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons for Overview Chat: Book site visit | Make a deal | Not interested */}
      <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-end">
        <CustomerDealHeaderActions
          dealId={deal.id}
          currentStage={deal.stage}
          propertyTitle={listing.title}
          propertyAddress={listing.address}
          siteVisit={siteVisit}
        />
      </div>
    </div>
  );
}
