"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useShortlist } from "@/context/ShortlistContext";
import { HeartButton } from "@/components/shortlist/HeartButton";

interface ShortlistItem {
  id: number;
  listingId: number;
  createdAt: string;
  name: string;
  slug: string;
  type: string;
  price: number | null;
  currency: string;
  formattedPrice: string;
  beds: number | null;
  sqFt: number | null;
  location: string;
  city: string;
  coverImage: string;
  status: "Available" | "Unavailable";
  rawStatus: string;
  agent: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
  } | null;
}

type SortOption = "recent" | "price_asc" | "price_desc";

function formatAddedDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "";
    return `Added on ${d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  } catch {
    return "";
  }
}

export function ShortlistView({
  initialItems,
}: {
  initialItems?: ShortlistItem[];
}) {
  const { shortlistIds, isLoading: contextLoading } = useShortlist();
  const [items, setItems] = useState<ShortlistItem[]>(initialItems || []);
  const [isLoading, setIsLoading] = useState(!initialItems);
  const [isError, setIsError] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  // Keep items in sync when initialItems changes
  useEffect(() => {
    if (initialItems) {
      setItems(initialItems);
      setIsLoading(false);
      setIsError(false);
    }
  }, [initialItems]);

  const fetchShortlist = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch("/api/shortlist", {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) {
        setIsError(true);
        return;
      }
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialItems) {
      fetchShortlist();
    }
  }, [initialItems, fetchShortlist]);

  // If shortlistIds has an ID not present in items (e.g. after undo or added elsewhere), fetch latest
  useEffect(() => {
    if (!contextLoading && shortlistIds.size > 0) {
      const hasMissing = Array.from(shortlistIds).some(
        (id) => !items.some((item) => item.listingId === id)
      );
      if (hasMissing) {
        fetchShortlist();
      }
    }
  }, [shortlistIds, items, contextLoading, fetchShortlist]);

  // Derive visible items: hide items that were toggled off in shortlistIds
  const visibleItems = useMemo(() => {
    if (contextLoading && items.length > 0) return items;
    return items.filter((item) => shortlistIds.has(item.listingId));
  }, [items, shortlistIds, contextLoading]);

  // Sort visible items
  const sortedItems = useMemo(() => {
    const list = [...visibleItems];
    if (sortBy === "price_asc") {
      return list.sort((a, b) => {
        if (a.price === null || a.price === undefined) return 1;
        if (b.price === null || b.price === undefined) return -1;
        return a.price - b.price;
      });
    }
    if (sortBy === "price_desc") {
      return list.sort((a, b) => {
        if (a.price === null || a.price === undefined) return 1;
        if (b.price === null || b.price === undefined) return -1;
        return b.price - a.price;
      });
    }
    // Default: Recently added (newest first)
    return list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [visibleItems, sortBy]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-200">
          <div className="h-8 w-48 animate-pulse rounded bg-neutral-200" />
          <div className="h-9 w-36 animate-pulse rounded bg-neutral-200" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <div className="aspect-[4/3] w-full animate-pulse bg-neutral-200" />
              <div className="p-4 flex flex-col gap-3">
                <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-neutral-200" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-neutral-200" />
                <div className="h-6 w-1/3 animate-pulse rounded bg-neutral-200" />
                <div className="mt-2 flex gap-2 pt-2 border-t border-neutral-100">
                  <div className="h-9 flex-1 animate-pulse rounded bg-neutral-200" />
                  <div className="h-9 flex-1 animate-pulse rounded bg-neutral-200" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600 mb-4">
          <svg
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">
          Couldn&apos;t load your Shortlist
        </h2>
        <p className="mt-1 text-sm text-neutral-500 max-w-sm">
          Something went wrong while retrieving your saved properties. Please try again.
        </p>
        <button
          onClick={fetchShortlist}
          className="mt-5 rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (visibleItems.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div className="pb-4 border-b border-neutral-200">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Shortlist (0)
          </h1>
        </div>
        <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-[#FF385C] mb-4">
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 32 32"
              stroke="#FF385C"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path d="M16 28c7-4.73 14-10 14-17a6.98 6.98 0 0 0-7-7c-1.8 0-3.58.68-4.95 2.05L16 8.1l-2.05-2.05a6.98 6.98 0 0 0-9.9 0A6.98 6.98 0 0 0 2 11c0 7 7 12.27 14 17z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Your Shortlist is empty
          </h2>
          <p className="mt-1.5 max-w-md text-sm text-neutral-600">
            Tap the heart on any listing to start building it.
          </p>
          <Link
            href="/listings"
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs"
          >
            Browse Listings
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            Shortlist ({visibleItems.length})
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Properties you have saved to view or inquire about later.
          </p>
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="shortlist-sort"
            className="text-sm font-medium text-neutral-600 shrink-0"
          >
            Sort by:
          </label>
          <select
            id="shortlist-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 shadow-xs focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 cursor-pointer"
          >
            <option value="recent">Recently added</option>
            <option value="price_asc">Price low to high</option>
            <option value="price_desc">Price high to low</option>
          </select>
        </div>
      </div>

      {/* Responsive Property Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {sortedItems.map((item) => {
          const isAvailable = item.status === "Available";
          const addedDate = formatAddedDate(item.createdAt);

          return (
            <div
              key={item.id}
              className={`flex flex-col overflow-hidden rounded-xl border transition-shadow ${
                isAvailable
                  ? "border-neutral-200/90 bg-white shadow-xs hover:shadow-md"
                  : "border-neutral-200 bg-neutral-50/70 opacity-75"
              }`}
            >
              {/* Cover Photo */}
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.coverImage}
                  alt={item.name}
                  loading="lazy"
                  className={`h-full w-full object-cover ${
                    !isAvailable ? "grayscale-[40%]" : ""
                  }`}
                />

                {/* Status and Type Badges (Top-Left) */}
                <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex flex-wrap items-center gap-1.5 z-10">
                  {isAvailable ? (
                    <span className="inline-flex items-center rounded bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-xs">
                      Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-neutral-700/90 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-xs">
                      No longer available
                    </span>
                  )}
                  {item.type && (
                    <span className="inline-flex items-center rounded border border-neutral-200/60 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-800 backdrop-blur-xs">
                      {item.type}
                    </span>
                  )}
                </div>

                {/* Heart Button (Top-Right) - Filled heart, click to remove with Undo */}
                <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 flex items-center h-[26px] z-10">
                  <HeartButton listingId={item.listingId} />
                </div>
              </div>

              {/* Property Details */}
              <div className="flex flex-1 flex-col p-4 sm:p-5">
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
                  <span className="truncate">{item.location}</span>
                </div>

                {/* Name */}
                <h3 className="mt-1.5 text-base font-semibold text-neutral-900 line-clamp-1">
                  {item.name}
                </h3>

                {/* Added on Date */}
                {addedDate && (
                  <p className="mt-0.5 text-xs text-neutral-500">{addedDate}</p>
                )}

                {/* Specs: Beds & Sq Ft */}
                {(item.beds !== null || item.sqFt !== null) && (
                  <div className="mt-2.5 flex items-center gap-2 text-xs font-medium text-neutral-600">
                    {item.beds !== null && (
                      <span>
                        {item.beds} {item.beds === 1 ? "Bed" : "Beds"}
                      </span>
                    )}
                    {item.beds !== null && item.sqFt !== null && (
                      <span className="text-neutral-300">•</span>
                    )}
                    {item.sqFt !== null && (
                      <span>{item.sqFt.toLocaleString()} sq ft</span>
                    )}
                  </div>
                )}

                {/* Price Range */}
                <div className="mt-3">
                  <span className="text-lg font-bold tracking-tight text-neutral-950">
                    {item.formattedPrice}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="mt-4 flex items-center gap-2 pt-3 border-t border-neutral-100">
                  {isAvailable && item.slug ? (
                    <>
                      <Link
                        href={`/listings/${item.slug}`}
                        className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-center text-xs sm:text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors shadow-xs"
                      >
                        View Property
                      </Link>
                      <Link
                        href={`/listings/${item.slug}#contact-agent`}
                        className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-center text-xs sm:text-sm font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs"
                      >
                        Contact Agent
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled
                        className="flex-1 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2 text-center text-xs sm:text-sm font-medium text-neutral-400 cursor-not-allowed"
                      >
                        View Property
                      </button>
                      <button
                        type="button"
                        disabled
                        className="flex-1 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-2 text-center text-xs sm:text-sm font-medium text-neutral-400 cursor-not-allowed"
                      >
                        Contact Agent
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

