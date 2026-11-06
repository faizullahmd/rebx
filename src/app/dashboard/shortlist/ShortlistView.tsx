"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useShortlist } from "@/context/ShortlistContext";
import { useToast } from "@/context/ToastContext";
import { HeartButton } from "@/components/shortlist/HeartButton";
import { ComparisonModal } from "@/components/shortlist/ComparisonModal";
import { ShortlistCompareBar } from "@/components/shortlist/ShortlistCompareBar";
import { PrivateNoteModal } from "@/components/shortlist/PrivateNoteModal";
import type { ShortlistItem } from "@/lib/data/shortlist";

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
  const { showToast } = useToast();
  const [items, setItems] = useState<ShortlistItem[]>(initialItems || []);
  const [isLoading, setIsLoading] = useState(!initialItems);
  const [isError, setIsError] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("recent");

  // Comparison State
  const [selectedCompareIds, setSelectedCompareIds] = useState<Set<number>>(new Set());
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isCompareMode, setIsCompareMode] = useState(false);
  const [limitWarning, setLimitWarning] = useState<string | null>(null);

  // Auto-dismiss 4-property limit warning after 3.5s
  useEffect(() => {
    if (!limitWarning) return;
    const timer = setTimeout(() => {
      setLimitWarning(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [limitWarning]);

  // Private Note Modal State
  const [activeNoteListing, setActiveNoteListing] = useState<{
    listingId: number;
    title: string;
    initialNote: string | null;
  } | null>(null);

  // Keep items in sync when initialItems changes
  useEffect(() => {
    if (initialItems) {
      setItems(initialItems);
      setIsLoading(false);
      setIsError(false);
    }
  }, [initialItems]);

  const fetchShortlist = useCallback(async () => {
    try {
      const res = await fetch("/api/shortlist", {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setItems(data.items);
      }
    } catch {
      // keep existing items if fetch fails
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShortlist();
  }, [fetchShortlist]);

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

  // Selected items for comparison
  const selectedCompareItems = useMemo(() => {
    return visibleItems.filter((item) => selectedCompareIds.has(item.listingId));
  }, [visibleItems, selectedCompareIds]);

  // Clean up selection if items are removed from shortlist
  useEffect(() => {
    setSelectedCompareIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (visibleItems.some((item) => item.listingId === id)) {
          next.add(id);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [visibleItems]);

  function toggleCompare(listingId: number) {
    if (!selectedCompareIds.has(listingId) && selectedCompareIds.size >= 4) {
      setLimitWarning("You can compare up to 4 properties at once.");
      return;
    }

    setSelectedCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(listingId)) {
        next.delete(listingId);
      } else if (next.size < 4) {
        next.add(listingId);
      }
      return next;
    });
  }

  function handleRemoveFromCompare(listingId: number) {
    setSelectedCompareIds((prev) => {
      const next = new Set(prev);
      next.delete(listingId);
      return next;
    });
  }

  function handleClearCompare() {
    setSelectedCompareIds(new Set());
  }

  function handleSaveNoteLocally(listingId: number, note: string | null) {
    setItems((prev) =>
      prev.map((item) =>
        item.listingId === listingId ? { ...item, notes: note } : item
      )
    );
  }

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-4.5">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <div className="aspect-[16/10] w-full animate-pulse bg-neutral-200" />
              <div className="p-3.5 flex flex-col gap-2.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-neutral-200" />
                <div className="h-4.5 w-3/4 animate-pulse rounded bg-neutral-200" />
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-neutral-200" />
                <div className="h-5 w-1/3 animate-pulse rounded bg-neutral-200" />
                <div className="mt-1.5 flex gap-2 pt-2 border-t border-neutral-100">
                  <div className="h-8 flex-1 animate-pulse rounded bg-neutral-200" />
                  <div className="h-8 flex-1 animate-pulse rounded bg-neutral-200" />
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
            My Shortlist
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            0 properties saved for later
          </p>
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
    <div className="flex flex-col gap-6 pb-20">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-neutral-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
            My Shortlist
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {visibleItems.length} {visibleItems.length === 1 ? "property" : "properties"} saved for later
          </p>
        </div>

        {/* Toolbar: Compare Properties Button + Sort Dropdown */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {isCompareMode ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectedCompareIds.size >= 2) {
                    setIsCompareOpen(true);
                  }
                }}
                disabled={selectedCompareIds.size < 2}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all shadow-xs ${
                  selectedCompareIds.size >= 2
                    ? "bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer active:scale-95"
                    : "bg-neutral-900 text-white/75 opacity-70 cursor-not-allowed"
                }`}
                title={
                  selectedCompareIds.size < 2
                    ? "Select at least 2 properties to compare"
                    : "Compare selected properties side-by-side"
                }
              >
                <span>Compare Properties ({selectedCompareIds.size})</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCompareMode(false);
                  setSelectedCompareIds(new Set());
                }}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs sm:text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition cursor-pointer shadow-2xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsCompareMode(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all shadow-xs cursor-pointer active:scale-95"
            >
              <span>Compare Properties</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <label
              htmlFor="shortlist-sort"
              className="text-xs sm:text-sm font-medium text-neutral-600 shrink-0"
            >
              Sort by:
            </label>
            <select
              id="shortlist-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-700 shadow-xs focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 cursor-pointer"
            >
              <option value="recent">Recently added</option>
              <option value="price_asc">Price low to high</option>
              <option value="price_desc">Price high to low</option>
            </select>
          </div>
        </div>
      </div>

      {/* Responsive Property Grid - Compact & refined sizing */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-4.5">
        {sortedItems.map((item) => {
          const isAvailable = item.status === "Available";
          const addedDate = formatAddedDate(item.createdAt);
          const isSelectedForCompare = selectedCompareIds.has(item.listingId);

          return (
            <div
              key={item.id}
              className={`flex flex-col overflow-hidden rounded-xl border transition-all ${
                isCompareMode && isSelectedForCompare
                  ? "border-neutral-900 ring-2 ring-neutral-900/15 bg-neutral-50/30 shadow-md"
                  : isAvailable
                    ? "border-neutral-200/90 bg-white shadow-xs hover:shadow-md"
                    : "border-neutral-200 bg-neutral-50/70 opacity-75"
              }`}
            >
              {/* Cover Photo */}
              <div
                onClick={isCompareMode ? () => toggleCompare(item.listingId) : undefined}
                className={`relative aspect-[16/10] w-full overflow-hidden bg-neutral-100 ${
                  isCompareMode ? "cursor-pointer" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.coverImage}
                  alt={item.name}
                  loading="lazy"
                  className={`h-full w-full object-cover ${
                    !isAvailable ? "grayscale-[40%]" : ""
                  }`}
                />

                {/* Status Badges (Top-Left of photo) */}
                <div className="absolute top-2 left-2 sm:top-2.5 sm:left-2.5 flex flex-wrap items-center gap-1.5 z-10">
                  {isAvailable ? (
                    <span className="inline-flex items-center rounded bg-emerald-600/95 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-xs shadow-xs">
                      Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-neutral-700/90 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur-xs">
                      No longer available
                    </span>
                  )}
                  {item.type && (
                    <span className="inline-flex items-center rounded border border-neutral-200/60 bg-white/95 px-2 py-0.5 text-[10.5px] font-medium text-neutral-800 backdrop-blur-xs shadow-2xs">
                      {item.type}
                    </span>
                  )}
                </div>

                {/* Heart Button (Top-Right) */}
                <div className="absolute top-2 right-2 sm:top-2.5 sm:right-2.5 flex items-center h-[24px] z-20">
                  <HeartButton listingId={item.listingId} />
                </div>

                {/* Selection Checkbox (Bottom-Left of photo) - only shown when Compare Properties is clicked */}
                {isCompareMode && (
                  <div className="absolute bottom-2 left-2 sm:bottom-2.5 sm:left-2.5 z-10 animate-in fade-in duration-150">
                    <label
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${item.name} for comparison`}
                      className={`flex h-6 w-6 items-center justify-center rounded border transition-all cursor-pointer shadow-xs ${
                        isSelectedForCompare
                          ? "bg-neutral-900 border-neutral-900 text-white"
                          : "bg-white/90 border-neutral-300/80 hover:bg-white hover:border-neutral-400 backdrop-blur-xs"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelectedForCompare}
                        onChange={() => toggleCompare(item.listingId)}
                        aria-label={`Select ${item.name} for comparison`}
                        className="sr-only"
                      />
                      {isSelectedForCompare ? (
                        <svg
                          className="h-3.5 w-3.5 stroke-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      ) : (
                        <div className="h-3 w-3 rounded-xs border border-neutral-400/60" />
                      )}
                    </label>
                  </div>
                )}
              </div>

              {/* Property Details */}
              <div className="flex flex-1 flex-col p-3.5 sm:p-4">
                {/* Location */}
                <div className="flex items-center gap-1.5 text-[11.5px] sm:text-xs font-medium text-neutral-500">
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
                <h3 className="mt-1 text-sm sm:text-[15px] font-semibold text-neutral-900 line-clamp-1 leading-snug">
                  {item.name}
                </h3>

                {/* Added on Date */}
                {addedDate && (
                  <p className="mt-0.5 text-[11px] text-neutral-400">{addedDate}</p>
                )}

                {/* Specs: Beds & Sq Ft */}
                {(item.beds !== null || item.sqFt !== null) && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-neutral-600">
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

                {/* Price */}
                <div className="mt-2">
                  <span className="text-base sm:text-[17px] font-bold tracking-tight text-neutral-950">
                    {item.formattedPrice}
                  </span>
                </div>

                {/* Private Notes Section */}
                <div className="mt-2.5 pt-2 border-t border-neutral-100">
                  {item.notes ? (
                    <div className="rounded-lg bg-amber-50/90 border border-amber-200/90 p-2.5 transition-colors shadow-2xs hover:bg-amber-100/70">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 text-amber-800">
                          <svg
                            className="h-3.5 w-3.5 shrink-0 text-amber-700"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.75}
                            stroke="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                            />
                          </svg>
                          <span className="text-[11px] font-bold text-amber-900 tracking-tight">
                            Private Note
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setActiveNoteListing({
                              listingId: item.listingId,
                              title: item.name,
                              initialNote: item.notes,
                            })
                          }
                          className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 transition-colors cursor-pointer hover:underline"
                        >
                          Edit note
                        </button>
                      </div>
                      <p
                        onClick={() =>
                          setActiveNoteListing({
                            listingId: item.listingId,
                            title: item.name,
                            initialNote: item.notes,
                          })
                        }
                        className="text-xs text-neutral-900 font-medium line-clamp-2 leading-relaxed cursor-pointer hover:text-black"
                        title="Click to edit private note"
                      >
                        {item.notes}
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setActiveNoteListing({
                          listingId: item.listingId,
                          title: item.name,
                          initialNote: null,
                        })
                      }
                      className="w-full flex items-center justify-between rounded-lg bg-amber-50/70 border border-dashed border-amber-300/80 hover:border-amber-400 p-2 text-xs text-amber-900 hover:bg-amber-100/70 transition-all cursor-pointer group shadow-2xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className="h-3.5 w-3.5 shrink-0 text-amber-700 group-hover:text-amber-800"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.75}
                          stroke="currentColor"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                          />
                        </svg>
                        <span className="text-xs font-semibold text-amber-900">Add private note</span>
                      </div>
                      <span className="text-[11px] font-medium text-amber-700 group-hover:text-amber-950 group-hover:underline">
                        + Add
                      </span>
                    </button>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="mt-2.5 flex items-center gap-2 pt-2 border-t border-neutral-100">
                  {isAvailable && item.slug ? (
                    <>
                      <Link
                        href={`/listings/${item.slug}`}
                        className="flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 sm:py-2 text-center text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 transition-colors shadow-xs"
                      >
                        View Property
                      </Link>
                      <Link
                        href={`/listings/${item.slug}#contact-agent`}
                        className="flex-1 rounded-lg bg-neutral-900 px-2.5 py-1.5 sm:py-2 text-center text-xs font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs"
                      >
                        Contact Agent
                      </Link>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled
                        className="flex-1 rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 sm:py-2 text-center text-xs font-medium text-neutral-400 cursor-not-allowed"
                      >
                        View Property
                      </button>
                      <button
                        type="button"
                        disabled
                        className="flex-1 rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 sm:py-2 text-center text-xs font-medium text-neutral-400 cursor-not-allowed"
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

      {/* Floating Compare Dock (at bottom when in compare mode and 1+ selected) */}
      {isCompareMode && (
        <ShortlistCompareBar
          selectedItems={selectedCompareItems}
          onRemoveItem={handleRemoveFromCompare}
          onClearAll={handleClearCompare}
          onOpenCompare={() => setIsCompareOpen(true)}
        />
      )}

      {/* Side-by-Side Comparison Matrix Modal */}
      <ComparisonModal
        isOpen={isCompareOpen}
        onClose={() => {
          setIsCompareOpen(false);
          setIsCompareMode(false);
          setSelectedCompareIds(new Set());
        }}
        properties={selectedCompareItems}
        onRemoveProperty={handleRemoveFromCompare}
        onOpenNoteEditor={(listingId) => {
          const target = items.find((p) => p.listingId === listingId);
          if (target) {
            setActiveNoteListing({
              listingId: target.listingId,
              title: target.name,
              initialNote: target.notes,
            });
          }
        }}
      />

      {/* Top Notification Popup for 4-Property Comparison Limit (White BG) */}
      {limitWarning && (
        <div
          role="alert"
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-xl border border-neutral-200/90 bg-white px-4 py-2.5 text-neutral-900 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200"
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
            !
          </div>
          <span className="text-xs sm:text-sm font-medium text-neutral-800">
            {limitWarning}
          </span>
          <button
            type="button"
            onClick={() => setLimitWarning(null)}
            className="ml-2 text-neutral-400 hover:text-neutral-700 text-xs font-bold p-1 rounded-md transition cursor-pointer"
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      )}

      {/* Private Note Editor Modal */}
      {activeNoteListing && (
        <PrivateNoteModal
          isOpen={Boolean(activeNoteListing)}
          onClose={() => setActiveNoteListing(null)}
          listingId={activeNoteListing.listingId}
          listingTitle={activeNoteListing.title}
          initialNote={activeNoteListing.initialNote}
          onSaveNote={handleSaveNoteLocally}
        />
      )}
    </div>
  );
}
