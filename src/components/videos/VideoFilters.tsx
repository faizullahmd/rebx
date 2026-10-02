"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  PROPERTY_TYPE_LABELS,
  TRANSACTION_LABELS,
} from "@/lib/property-taxonomy";
import type { PropertyType, TransactionType } from "@prisma/client";

interface VideoFiltersProps {
  initialSearch?: string;
  initialPropertyType?: string;
  initialTransactionType?: string;
  initialSort?: string;
}

export function VideoFilters({
  initialSearch = "",
  initialPropertyType = "",
  initialTransactionType = "",
  initialSort = "newest",
}: VideoFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function updateFilter(updates: Record<string, string | null>) {
    const current = new URLSearchParams(Array.from(searchParams.entries()));

    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "" || (key === "sort" && value === "newest")) {
        current.delete(key);
      } else {
        current.set(key, value);
      }
    }

    // Always reset page to 1 on filter changes
    current.delete("page");

    startTransition(() => {
      const qs = current.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function handleReset() {
    startTransition(() => {
      router.push(pathname);
    });
  }

  const hasActiveFilters = Boolean(
    initialSearch ||
    initialPropertyType ||
    initialTransactionType ||
    (initialSort && initialSort !== "newest")
  );

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200/80 bg-neutral-50/70 p-4 sm:p-5 shadow-2xs">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Search by Title / Location */}
        <div className="relative">
          <label htmlFor="video-search" className="sr-only">
            Search property title or location
          </label>
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-neutral-400">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <input
            id="video-search"
            type="search"
            defaultValue={initialSearch}
            placeholder="Search by title or location..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                updateFilter({ search: (e.target as HTMLInputElement).value });
              }
            }}
            onBlur={(e) => {
              if (e.target.value !== initialSearch) {
                updateFilter({ search: e.target.value });
              }
            }}
            className="w-full rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-3 text-xs sm:text-sm text-neutral-900 placeholder-neutral-400 shadow-2xs outline-none transition focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          />
        </div>

        {/* Transaction Type (For Sale / For Rent) */}
        <div>
          <label htmlFor="filter-transaction" className="sr-only">
            Transaction Type
          </label>
          <select
            id="filter-transaction"
            value={initialTransactionType}
            onChange={(e) => updateFilter({ transactionType: e.target.value })}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs sm:text-sm text-neutral-800 shadow-2xs outline-none transition focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 cursor-pointer"
          >
            <option value="">All Transactions (Sale / Rent)</option>
            {Object.entries(TRANSACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Property Type */}
        <div>
          <label htmlFor="filter-type" className="sr-only">
            Property Type
          </label>
          <select
            id="filter-type"
            value={initialPropertyType}
            onChange={(e) => updateFilter({ propertyType: e.target.value })}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs sm:text-sm text-neutral-800 shadow-2xs outline-none transition focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 cursor-pointer"
          >
            <option value="">All Property Types</option>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Dropdown */}
        <div>
          <label htmlFor="filter-sort" className="sr-only">
            Sort Order
          </label>
          <select
            id="filter-sort"
            value={initialSort}
            onChange={(e) => updateFilter({ sort: e.target.value })}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs sm:text-sm text-neutral-800 shadow-2xs outline-none transition focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 cursor-pointer"
          >
            <option value="newest">Sort: Newest first</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
          </select>
        </div>
      </div>

      {/* Active filters bar and pending indicator */}
      <div className="flex items-center justify-between pt-1">
        <div className="text-xs text-neutral-500">
          {isPending ? (
            <span className="flex items-center gap-1.5 text-neutral-600 font-medium">
              <span className="h-2 w-2 rounded-full bg-neutral-900 animate-ping" />
              Updating gallery...
            </span>
          ) : (
            <span>Showing verified property videos</span>
          )}
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:underline cursor-pointer"
          >
            Reset all filters ✕
          </button>
        )}
      </div>
    </div>
  );
}
