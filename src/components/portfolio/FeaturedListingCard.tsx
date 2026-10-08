import Link from "next/link";
import type { Listing, ListingImage } from "@prisma/client";
import { TRANSACTION_LABELS } from "@/lib/property-taxonomy";
import { ListingTagBadge } from "@/components/listings/ListingTagBadge";

import { formatListingPrice } from "@/lib/price";

export function FeaturedListingCard({
  listing,
}: {
  listing: Omit<Listing, "price"> & {
    price: number | any;
    priceDisplay?: string | null;
    images: ListingImage[];
  };
}) {
  const cover =
    listing.images && listing.images.length > 0 && listing.images[0]?.url
      ? listing.images[0].url
      : "/images/property-placeholder.jpg";

  const formattedPrice = formatListingPrice(
    listing.price,
    listing.currency || "INR",
    (listing as any).priceDisplay
  );
  const hasSlug = Boolean(listing.slug);

  const cardMarkup = (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-neutral-200/90 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-md">
      {/* Property Image Container */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={listing.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Badges Overlay */}
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur-sm">
            {TRANSACTION_LABELS[listing.transactionType] || "For Sale"}
          </span>
          <ListingTagBadge tag="featured" />
        </div>

        {/* Preview badge (hover on desktop, always visible on touch) */}
        {hasSlug && (
          <div className="absolute top-3 right-3 inline-flex items-center gap-1 rounded bg-black/75 px-2 py-1 text-[11px] font-medium text-white shadow-xs backdrop-blur-sm transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
            <span>Preview</span>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Property Details */}
      <div className="flex flex-1 flex-col p-4">
        {/* Location */}
        <div className="flex items-center gap-1 text-xs font-medium text-neutral-500">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-neutral-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="truncate">
            {listing.city}
            {listing.state ? `, ${listing.state}` : ""}
            {listing.country ? ` · ${listing.country}` : ""}
          </span>
        </div>

        {/* Title */}
        <h3 className="mt-1.5 text-base font-semibold text-neutral-900 group-hover:underline line-clamp-1">
          {listing.title}
        </h3>

        {/* Price */}
        <p className="mt-1 text-lg font-bold text-neutral-950">{formattedPrice}</p>

        {/* Specs */}
        {(listing.bedrooms || listing.bathrooms || listing.areaSqFt) && (
          <p className="mt-0.5 text-xs text-neutral-500">
            {[
              listing.bedrooms ? `${listing.bedrooms} Beds` : null,
              listing.bathrooms ? `${listing.bathrooms} Baths` : null,
              listing.areaSqFt ? `${listing.areaSqFt.toLocaleString()} sqft` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {/* Card Footer: Edit link is isolated and not nested inside preview link */}
        <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-2 text-xs">
          <span className="text-neutral-400">Public preview ↗</span>
          <Link
            href={`/agent/dashboard/listings/${listing.id}/edit`}
            className="relative z-10 rounded px-2.5 py-1 font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-800"
          >
            Edit
          </Link>
        </div>
      </div>
    </article>
  );

  if (!hasSlug) {
    return cardMarkup;
  }

  return (
    <div className="relative group h-full">
      {/* Whole card preview link - placed as a sibling to avoid nested <a> elements */}
      <Link
        href={`/listings/${listing.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Preview ${listing.title} as buyers see it`}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
      />
      {cardMarkup}
    </div>
  );
}
