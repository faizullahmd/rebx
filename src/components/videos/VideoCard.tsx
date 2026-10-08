"use client";

import Link from "next/link";
import type { PropertyType, TransactionType } from "@prisma/client";
import { TRANSACTION_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/property-taxonomy";
import { parseVideoUrl } from "@/lib/video";

export type VideoGalleryCardItem = {
  id: number;
  title: string;
  url: string;
  provider: string;
  videoId: string;
  thumbnailUrl: string | null;
  resolvedThumbnail?: string;
  createdAt?: Date | string;
  listing?: {
    id: number;
    title: string;
    slug: string;
    price: number | string;
    priceDisplay?: string | null;
    currency?: string;
    city: string;
    state?: string | null;
    country: string;
    bedrooms?: number | null;
    bathrooms?: number | null;
    areaSqFt?: number | null;
    transactionType: TransactionType;
    propertyType?: PropertyType | null;
  } | null;
};

// Backwards compatibility alias
export type ListingWithVideo = VideoGalleryCardItem;

interface VideoCardProps {
  listing: VideoGalleryCardItem;
  onSelect: (item: VideoGalleryCardItem) => void;
}

import { formatListingPrice } from "@/lib/price";

export function VideoCard({ listing: item, onSelect }: VideoCardProps) {
  const parsed = parseVideoUrl(item.url);
  const thumbnail =
    item.resolvedThumbnail ||
    item.thumbnailUrl ||
    parsed?.thumbnailUrl ||
    "/images/property-placeholder.jpg";

  const listing = item.listing;

  return (
    <article
      onClick={() => onSelect(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(item);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Watch video: ${item.title}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-neutral-200/90 bg-white shadow-2xs transition-all duration-300 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 cursor-pointer"
    >
      {/* Video Thumbnail with Play Button Overlay */}
      <div className="relative aspect-video w-full overflow-hidden bg-neutral-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnail}
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        {/* Dark gradient overlay for contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/30 transition-opacity duration-300 group-hover:opacity-80" />

        {/* Center Play Button Overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-neutral-900 shadow-xl backdrop-blur-xs transition-all duration-300 group-hover:scale-110 group-hover:bg-neutral-900 group-hover:text-white">
            <svg
              className="h-6 w-6 ml-0.5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>

        {/* Top Badges */}
        {listing && (
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-md bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              {TRANSACTION_LABELS[listing.transactionType] || "For Sale"}
            </span>
            {listing.propertyType && (
              <span className="inline-flex items-center rounded-md border border-white/20 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-800 backdrop-blur-sm">
                {PROPERTY_TYPE_LABELS[listing.propertyType]}
              </span>
            )}
          </div>
        )}

        {/* Provider Tag */}
        {(parsed?.provider || item.provider) && (
          <div className="absolute top-3 right-3 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
            {parsed?.provider || item.provider}
          </div>
        )}

        {/* Duration / Tour Hint */}
        <div className="absolute bottom-2.5 right-2.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-xs">
          Virtual Tour
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* If attached to listing, show location */}
        {listing ? (
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
        ) : (
          <div className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
            Property Walkthrough
          </div>
        )}

        {/* Title */}
        <h3 className="mt-1.5 text-base font-semibold text-neutral-900 line-clamp-2 transition-colors group-hover:text-neutral-700">
          {item.title}
        </h3>

        {/* Price & Specs if listing attached */}
        {listing && (
          <div className="mt-2 flex items-baseline justify-between border-t border-neutral-100 pt-3">
            <span className="text-lg font-bold tracking-tight text-neutral-950">
              {formatListingPrice(listing.price, listing.currency, listing.priceDisplay)}
            </span>

            <div className="flex items-center gap-2 text-xs text-neutral-500 font-medium">
              {listing.bedrooms != null && (
                <span>{listing.bedrooms} {listing.bedrooms === 1 ? "Bed" : "Beds"}</span>
              )}
              {listing.bathrooms != null && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span>{listing.bathrooms} {listing.bathrooms === 1 ? "Bath" : "Baths"}</span>
                </>
              )}
              {listing.areaSqFt && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span>{listing.areaSqFt.toLocaleString()} sqft</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Actions / Watch indicator / View Property button */}
        <div className="mt-auto pt-4 flex items-center justify-between border-t border-neutral-100">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800 group-hover:text-neutral-950">
            <svg className="h-4 w-4 text-rose-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
            </svg>
            Watch Video
          </span>

          {/* View Property button: Shown ONLY if one or more listings use that video, linking to /listings/[slug] */}
          {listing && (
            <Link
              href={`/listings/${listing.slug}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 transition"
            >
              <span>View Property</span>
              <span>→</span>
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
