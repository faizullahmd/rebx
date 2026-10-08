import Link from "next/link";
import type { Listing, ListingImage } from "@prisma/client";
import { TRANSACTION_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/property-taxonomy";
import { getListingTag } from "@/lib/tags";
import { ListingTagBadge } from "@/components/listings/ListingTagBadge";

import { formatListingPrice } from "@/lib/price";

export function ListingCard({
  listing,
}: {
  listing: Listing & { images: ListingImage[]; priceDisplay?: string | null };
}) {
  const cover = listing.images && listing.images.length > 0 && listing.images[0]?.url
    ? listing.images[0].url
    : "/images/property-placeholder.jpg";

  const formattedPrice = formatListingPrice(listing.price, listing.currency, listing.priceDisplay);
  const tag = getListingTag((listing as Record<string, unknown>).tags);
  const isFeatured = Boolean((listing as Record<string, unknown>).featured || (listing as Record<string, unknown>).isFeatured);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200/90 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md">
      {/* Property Image Container */}
      <Link
        href={`/listings/${listing.slug}`}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-neutral-100"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={listing.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Badges Overlay */}
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
          {/* Sale / Rent status */}
          <span className="inline-flex items-center rounded bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur-sm">
            {TRANSACTION_LABELS[listing.transactionType] || "For Sale"}
          </span>

          {listing.status === "UNDER_OFFER" && (
            <span className="inline-flex items-center rounded bg-amber-500/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow-xs backdrop-blur-sm">
              Under Offer
            </span>
          )}

          {/* Property Type */}
          {listing.propertyType && (
            <span className="inline-flex items-center rounded border border-neutral-200/60 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-800 backdrop-blur-sm">
              {PROPERTY_TYPE_LABELS[listing.propertyType]}
            </span>
          )}

          {/* Selected Tag Badge */}
          {tag ? (
            <ListingTagBadge tag={tag} />
          ) : isFeatured ? (
            <span className="inline-flex items-center rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white">
              Featured
            </span>
          ) : null}
        </div>
      </Link>

      {/* Property Details */}
      <div className="flex flex-1 flex-col p-5">
        {/* Location */}
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-500">
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

        {/* Property Name */}
        <h3 className="mt-2 text-base font-semibold text-neutral-900 transition-colors group-hover:text-neutral-700">
          <Link href={`/listings/${listing.slug}`} className="line-clamp-1">
            {listing.title}
          </Link>
        </h3>

        {/* Price */}
        <div className="mt-2.5">
          <span className="text-xl font-bold tracking-tight text-neutral-950">
            {formattedPrice}
          </span>
        </div>

        {/* Specs: Bedrooms, Bathrooms, Sq Ft */}
        <div className="mt-3 flex items-center gap-3 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          {listing.bedrooms !== null && listing.bedrooms !== undefined && (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-neutral-900">{listing.bedrooms}</span>
              <span>{listing.bedrooms === 1 ? "Bed" : "Beds"}</span>
            </div>
          )}
          {listing.bedrooms !== null && listing.bathrooms !== null && (
            <span className="text-neutral-300">·</span>
          )}
          {listing.bathrooms !== null && listing.bathrooms !== undefined && (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-neutral-900">{listing.bathrooms}</span>
              <span>{listing.bathrooms === 1 ? "Bath" : "Baths"}</span>
            </div>
          )}
          {((listing.bedrooms !== null || listing.bathrooms !== null) && listing.areaSqFt) && (
            <span className="text-neutral-300">·</span>
          )}
          {listing.areaSqFt ? (
            <div className="flex items-center gap-1">
              <span className="font-semibold text-neutral-900">
                {listing.areaSqFt.toLocaleString()}
              </span>
              <span>sq ft</span>
            </div>
          ) : null}
        </div>

        {/* View Property Button */}
        <div className="mt-5 pt-1">
          <Link
            href={`/listings/${listing.slug}`}
            className="flex w-full items-center justify-center gap-2 rounded border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-800 transition-all group-hover:border-neutral-900 group-hover:bg-neutral-900 group-hover:text-white"
          >
            <span>View Property</span>
            <svg
              className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
