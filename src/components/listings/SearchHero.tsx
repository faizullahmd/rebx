"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PopularChipItem } from "@/lib/data/listings";
import { getTagBadgeClass } from "@/lib/tags";

interface SearchHeroProps {
  popularChips: PopularChipItem[];
}

export function SearchHero({ popularChips }: SearchHeroProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [queryText, setQueryText] = useState(searchParams.get("q") || "");

  // Sync state if URL changes externally (e.g., Back/Forward navigation)
  useEffect(() => {
    setQueryText(searchParams.get("q") || "");
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextParams = new URLSearchParams(searchParams.toString());
    const trimmed = queryText.trim();
    if (trimmed) {
      nextParams.set("q", trimmed);
    } else {
      nextParams.delete("q");
    }
    const qs = nextParams.toString();
    router.push(qs ? `/listings?${qs}` : "/listings");
  };

  const handleClear = () => {
    setQueryText("");
    if (searchParams.has("q")) {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("q");
      const qs = nextParams.toString();
      router.push(qs ? `/listings?${qs}` : "/listings");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQueryText("");
    }
  };

  const handleChipClick = (chip: PopularChipItem) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    const currentValue = nextParams.get(chip.paramKey);

    // Toggle off if already active
    if (currentValue === chip.paramValue) {
      nextParams.delete(chip.paramKey);
      if (chip.paramKey === "propertyType") {
        nextParams.delete("propertyCategory");
      }
    } else {
      nextParams.set(chip.paramKey, chip.paramValue);
      // Remove any leftover or conflicting category so type filter works directly
      if (chip.paramKey === "propertyType") {
        nextParams.delete("propertyCategory");
      }
    }

    const qs = nextParams.toString();
    router.push(qs ? `/listings?${qs}` : "/listings");
  };

  return (
    <section className="relative overflow-hidden rounded-2xl border border-neutral-200/80 bg-gradient-to-b from-neutral-50/90 via-white to-neutral-50/40 p-5 sm:p-8 md:p-10 shadow-2xs">
      <div className="mx-auto max-w-3xl text-center">
        {/* Heading */}
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl md:text-4xl">
          Find your next home
        </h1>

        {/* Subtext */}
        <p className="mt-2 text-xs sm:text-sm md:text-base text-neutral-600">
          Search apartments, villas and projects by name, area or city.
        </p>

        {/* Wide Pill Search Input */}
        <form
          onSubmit={handleSubmit}
          className="relative mx-auto mt-5 sm:mt-6 max-w-2xl"
          role="search"
        >
          <div className="relative flex items-center rounded-full border border-neutral-300 bg-white p-1.5 shadow-sm transition-all focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/10">
            {/* Search Icon */}
            <div className="pointer-events-none pl-3.5 pr-2 text-neutral-400">
              <svg
                className="h-4 w-4 sm:h-5 sm:w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
            </div>

            {/* Input Field */}
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by project, locality or city"
              aria-label="Search properties"
              className="w-full bg-transparent py-1.5 text-xs sm:text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-hidden"
            />

            {/* Clear (x) button when text exists */}
            {queryText && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search input"
                className="mr-1.5 rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors cursor-pointer"
              >
                <svg
                  className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}

            {/* Dark Search Button */}
            <button
              type="submit"
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-900 px-4 sm:px-6 py-2 sm:py-2.5 text-xs sm:text-sm font-medium text-white shadow-xs hover:bg-neutral-800 transition-colors cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-neutral-900 focus:ring-offset-1"
            >
              Search
            </button>
          </div>
        </form>

        {/* Popular Chips Row */}
        {popularChips.length > 0 && (
          <div className="mt-4 sm:mt-5 flex items-center justify-center gap-2 text-xs">
            <span className="shrink-0 font-medium text-neutral-500">Popular:</span>
            <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-1 scroll-smooth max-w-full [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {popularChips.map((chip) => {
                const isActive = searchParams.get(chip.paramKey) === chip.paramValue;

                let chipStyle = "";
                if (chip.type === "tag") {
                  if (isActive) {
                    chipStyle = `${getTagBadgeClass(chip.tagColor, "solid")} shadow-xs border-transparent`;
                  } else {
                    chipStyle = `${getTagBadgeClass(chip.tagColor, "soft")} border`;
                  }
                } else {
                  if (isActive) {
                    chipStyle = "bg-neutral-900 text-white border-neutral-900 shadow-xs";
                  } else {
                    chipStyle = "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50";
                  }
                }

                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    aria-pressed={isActive}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-medium border transition-all cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-neutral-900/20 ${chipStyle}`}
                  >
                    {isActive && (
                      <svg
                        className="h-3 w-3 shrink-0 stroke-current"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    <span>{chip.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
