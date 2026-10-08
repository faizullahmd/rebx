"use client";

import { useState, useTransition, useEffect } from "react";
import { LISTING_TAG_OPTIONS } from "@/lib/tags";
import { updateListingTagAction } from "@/lib/actions/listings";

interface ListingTagDropdownProps {
  listingId: number;
  initialTag: string | null;
  onTagChange?: (newTag: string | null) => void;
  compact?: boolean;
}

const TAG_STYLES: Record<string, string> = {
  new: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  featured: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
  most_viewed: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
  few_units_left: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
  exclusive: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
  none: "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100",
};

export function ListingTagDropdown({
  listingId,
  initialTag,
  onTagChange,
  compact = false,
}: ListingTagDropdownProps) {
  const [tag, setTag] = useState<string | null>(initialTag);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTag(initialTag);
  }, [initialTag]);

  const styleClass = tag ? TAG_STYLES[tag] || TAG_STYLES.none : TAG_STYLES.none;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = e.target.value === "" ? null : e.target.value;
    const previousTag = tag;
    setError(null);
    setTag(nextValue);
    onTagChange?.(nextValue);

    startTransition(async () => {
      try {
        const res = await updateListingTagAction(listingId, nextValue);
        if (!res.success) {
          setError(res.error || "Failed to update tag");
          setTag(previousTag);
          onTagChange?.(previousTag);
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected error occurred");
        setTag(previousTag);
        onTagChange?.(previousTag);
      }
    });
  };

  return (
    <div className={`flex flex-col items-start gap-1 ${compact ? "w-full max-w-[110px]" : ""}`}>
      <div className={`relative inline-flex items-center ${compact ? "w-full max-w-[110px]" : ""}`}>
        <select
          value={tag ?? ""}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Select listing tag"
          className={`appearance-none rounded-md border font-medium cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-gray-900 ${
            compact
              ? "h-10 min-h-[40px] px-2 py-1 pr-5 text-xs max-w-[110px] w-full truncate"
              : "px-2.5 py-1 pr-6 text-xs"
          } ${styleClass} ${
            isPending ? "opacity-60 cursor-not-allowed" : ""
          }`}
        >
          <option value="">No tag</option>
          {LISTING_TAG_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          className={`pointer-events-none absolute text-gray-500 ${
            compact ? "right-1.5 text-[8px]" : "right-2 text-[9px]"
          }`}
        >
          ▼
        </span>
      </div>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}
