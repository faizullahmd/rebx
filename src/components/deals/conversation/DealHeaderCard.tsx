import Link from "next/link";
import { formatListingPrice } from "@/lib/price";
import { DEAL_STAGE_LABELS, type DEAL_STAGES } from "@/lib/validation/deal";

type Stage = (typeof DEAL_STAGES)[number];

interface DealHeaderCardProps {
  deal: {
    id: number;
    stage: string;
    createdAt: Date;
    offerAmount: number | null;
    initialOfferAmount?: number | null;
    contactName: string;
    contactEmail: string;
    contactPhone?: string | null;
    listing: {
      title: string;
      slug: string;
      price: number | null;
      priceDisplay?: string | null;
      currency?: string;
      city?: string | null;
      state?: string | null;
      propertyType?: string | null;
      images?: { url: string }[];
    };
    agent?: { name: string; email: string };
  };
  viewerRole?: "AGENT" | "CUSTOMER";
}

export function DealHeaderCard({ deal }: DealHeaderCardProps) {
  const listing = deal.listing;
  const photo = listing.images?.[0]?.url;

  // Listed offer price from listing (matching the listings page display)
  const listedOfferPrice = formatListingPrice(
    listing.price,
    listing.currency || "INR",
    listing.priceDisplay
  );

  // Initial offer price negotiated in chat
  const initialOfferPrice = deal.initialOfferAmount
    ? formatListingPrice(deal.initialOfferAmount, listing.currency || "INR")
    : null;

  const dateFormatted = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(deal.createdAt));

  const stageLabel = DEAL_STAGE_LABELS[deal.stage as Stage] || deal.stage;

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

          {/* 3 Metrics */}
          <div className="mt-4 flex flex-wrap items-start gap-6 sm:gap-10">
            <div>
              <span className="block text-xs font-medium text-gray-400">
                Listed offer price
              </span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900">
                {listedOfferPrice}
              </span>
              <div className="mt-2.5">
                <span className="block text-xs font-medium text-gray-400">
                  Your initial offer
                </span>
                <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900">
                  {initialOfferPrice ?? "No offer yet"}
                </span>
              </div>
            </div>

            <div className="mt-0.5 h-9 w-px bg-gray-100 hidden sm:block" />

            <div>
              <span className="block text-xs font-medium text-gray-400">
                Offer Date
              </span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900">
                {dateFormatted}
              </span>
            </div>

            <div className="mt-0.5 h-9 w-px bg-gray-100 hidden sm:block" />

            <div>
              <span className="block text-xs font-medium text-gray-400">Status</span>
              <span className="mt-1 block text-sm sm:text-base font-bold text-gray-900 capitalize">
                {stageLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Framed Brand / Property Box (Matching the reference image) */}
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
    </div>
  );
}
