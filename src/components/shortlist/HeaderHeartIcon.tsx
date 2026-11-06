"use client";

import React from "react";
import Link from "next/link";
import { useShortlist } from "@/context/ShortlistContext";

export function HeaderHeartIcon({
  className = "",
  showTextOnDesktop = false,
}: {
  className?: string;
  showTextOnDesktop?: boolean;
}) {
  const { count } = useShortlist();

  return (
    <Link
      href="/dashboard/shortlist"
      aria-label={`View your Shortlist (${count} ${
        count === 1 ? "item" : "items"
      })`}
      className={`relative inline-flex items-center justify-center rounded-lg p-2 text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 min-h-[44px] min-w-[44px] ${className}`}
    >
      <div className="relative flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke={count > 0 ? "#FF385C" : "currentColor"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-6 w-6 transition-colors"
          aria-hidden="true"
        >
          <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>

        {/* Count Badge */}
        {count > 0 && (
          <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#FF385C] px-1 text-[10px] font-bold text-white shadow-xs">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </div>

      {showTextOnDesktop && (
        <span className="ml-2 hidden lg:inline text-sm font-medium">
          Shortlist
        </span>
      )}
    </Link>
  );
}
