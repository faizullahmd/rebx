"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PROPERTY_TYPE_LABELS, TRANSACTION_LABELS } from "@/lib/property-taxonomy";
import type { PropertyType, TransactionType } from "@prisma/client";

interface PortfolioFiltersProps {
  currentTransactionType?: string;
  currentPropertyType?: string;
  currentSort?: string;
  totalResults: number;
}

export function PortfolioFilters({
  currentTransactionType = "",
  currentPropertyType = "",
  currentSort = "newest",
  totalResults,
}: PortfolioFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function updateQuery(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(name, value);
    } else {
      params.delete(name);
    }
    // Reset to page 1 whenever filters change
    params.delete("page");

    startTransition(() => {
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    });
  }

  function handleReset() {
    startTransition(() => {
      router.push(pathname);
    });
  }

  const hasActiveFilters =
    Boolean(currentTransactionType) ||
    Boolean(currentPropertyType) ||
    (currentSort !== "newest" && Boolean(currentSort));

  return (
    <div className="flex flex-col gap-3.5 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Title & Count */}
      <div>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900">
          Agent Listings
        </h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          {totalResults} {totalResults === 1 ? "property" : "properties"} available
          {isPending && <span className="ml-2 text-neutral-400 animate-pulse">Updating…</span>}
        </p>
      </div>

      {/* Filter controls row */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Transaction Type Filter */}
        <select
          value={currentTransactionType}
          onChange={(e) => updateQuery("transactionType", e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-800 shadow-2xs outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        >
          <option value="">All Transactions</option>
          {Object.entries(TRANSACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Property Type Filter */}
        <select
          value={currentPropertyType}
          onChange={(e) => updateQuery("propertyType", e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-800 shadow-2xs outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        >
          <option value="">All Property Types</option>
          {Object.entries(PROPERTY_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Sort Filter */}
        <select
          value={currentSort}
          onChange={(e) => updateQuery("sort", e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-neutral-800 shadow-2xs outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
        >
          <option value="newest">Sort: Newest First</option>
          <option value="price-asc">Sort: Price (Low to High)</option>
          <option value="price-desc">Sort: Price (High to Low)</option>
        </select>

        {/* Reset button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
