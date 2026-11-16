"use client";

import type { ShortlistItem } from "@/lib/data/shortlist";

export interface ShortlistCompareBarProps {
  selectedItems: ShortlistItem[];
  onRemoveItem: (listingId: number) => void;
  onClearAll: () => void;
  onOpenCompare: () => void;
}

export function ShortlistCompareBar({
  selectedItems,
  onRemoveItem,
  onClearAll,
  onOpenCompare,
}: ShortlistCompareBarProps) {
  if (selectedItems.length === 0) return null;

  const canCompare = selectedItems.length >= 2;

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-2xl animate-in slide-in-from-bottom-5 duration-200">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-neutral-900/95 p-3 sm:px-5 sm:py-3.5 text-white shadow-2xl backdrop-blur-md border border-neutral-800">
        {/* Left: Thumbnails & count */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex -space-x-2 shrink-0">
            {selectedItems.map((item) => (
              <div
                key={item.id}
                className="group relative h-9 w-9 sm:h-10 sm:w-10 rounded-full border-2 border-neutral-900 overflow-hidden bg-neutral-800 shadow-xs"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.coverImage}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(item.listingId);
                  }}
                  title="Remove"
                  className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-semibold truncate text-white">
              {selectedItems.length} {selectedItems.length === 1 ? "property" : "properties"} selected
            </p>
            <p className="text-[11px] text-neutral-400 truncate hidden sm:block">
              {canCompare
                ? "Ready to compare side-by-side"
                : "Select 1 to 3 more properties to compare"}
            </p>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="text-xs text-neutral-400 hover:text-white px-2.5 py-1.5 transition cursor-pointer font-medium"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onOpenCompare}
            disabled={!canCompare}
            className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer shadow-sm ${
              canCompare
                ? "bg-white text-neutral-900 hover:bg-neutral-100 active:scale-95"
                : "bg-neutral-800 text-neutral-500 cursor-not-allowed opacity-60"
            }`}
          >
            Compare ({selectedItems.length})
          </button>
        </div>
      </div>
    </div>
  );
}

