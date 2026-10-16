"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  TRANSACTION_LABELS,
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@/lib/property-taxonomy";
import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";

interface ActiveFiltersBarProps {
  count: number;
}

export function ActiveFiltersBar({ count }: ActiveFiltersBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get("q") || "";
  const tag = searchParams.get("tag") || "";
  const city = searchParams.get("city") || "";
  const propertyType = searchParams.get("propertyType") || "";
  const propertyCategory = searchParams.get("propertyCategory") || "";
  const transactionType = searchParams.get("transactionType") || "";
  const minPrice = searchParams.get("minPrice") || "";
  const maxPrice = searchParams.get("maxPrice") || "";
  const bedrooms = searchParams.get("bedrooms") || "";

  interface ActiveFilterPill {
    id: string;
    label: string;
    removeKey: string;
    extraRemoveKeys?: string[];
  }

  const activePills: ActiveFilterPill[] = [];

  if (q) {
    activePills.push({ id: "q", label: `Search: "${q}"`, removeKey: "q" });
  }
  if (tag) {
    activePills.push({ id: "tag", label: `Tag: ${tag}`, removeKey: "tag" });
  }
  if (city) {
    activePills.push({ id: "city", label: `City: ${city}`, removeKey: "city" });
  }
  if (propertyType) {
    const label = PROPERTY_TYPE_LABELS[propertyType as PropertyType] || propertyType;
    activePills.push({
      id: "propertyType",
      label: `Type: ${label}`,
      removeKey: "propertyType",
      extraRemoveKeys: ["propertyCategory"],
    });
  }
  if (propertyCategory) {
    const label = CATEGORY_LABELS[propertyCategory as PropertyCategory] || propertyCategory;
    activePills.push({
      id: "propertyCategory",
      label: `Category: ${label}`,
      removeKey: "propertyCategory",
      extraRemoveKeys: ["propertyType"],
    });
  }
  if (transactionType) {
    const label = TRANSACTION_LABELS[transactionType as TransactionType] || transactionType;
    activePills.push({
      id: "transactionType",
      label: `Transaction: ${label}`,
      removeKey: "transactionType",
    });
  }
  if (minPrice) {
    activePills.push({ id: "minPrice", label: `Min price: ₹${Number(minPrice).toLocaleString()}`, removeKey: "minPrice" });
  }
  if (maxPrice) {
    activePills.push({ id: "maxPrice", label: `Max price: ₹${Number(maxPrice).toLocaleString()}`, removeKey: "maxPrice" });
  }
  if (bedrooms) {
    activePills.push({ id: "bedrooms", label: `Min beds: ${bedrooms}`, removeKey: "bedrooms" });
  }

  const handleRemove = (pill: ActiveFilterPill) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete(pill.removeKey);
    if (pill.extraRemoveKeys) {
      pill.extraRemoveKeys.forEach((k) => nextParams.delete(k));
    }
    const qs = nextParams.toString();
    router.push(qs ? `/listings?${qs}` : "/listings");
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between py-1">
      {/* Result Count */}
      <div className="text-sm font-medium text-neutral-700">
        <span className="font-semibold text-neutral-900">{count}</span>{" "}
        {count === 1 ? "property" : "properties"} found
      </div>

      {/* Active Filter Pills */}
      {activePills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {activePills.map((pill) => (
            <span
              key={pill.id}
              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100/80 px-2.5 py-0.5 text-xs text-neutral-800"
            >
              <span>{pill.label}</span>
              <button
                type="button"
                onClick={() => handleRemove(pill)}
                aria-label={`Remove filter ${pill.label}`}
                className="ml-0.5 rounded-full p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 transition-colors cursor-pointer"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}

          {/* Clear All Action */}
          <Link
            href="/listings"
            className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 underline underline-offset-2 ml-1 cursor-pointer"
          >
            Clear all
          </Link>
        </div>
      )}
    </div>
  );
}
