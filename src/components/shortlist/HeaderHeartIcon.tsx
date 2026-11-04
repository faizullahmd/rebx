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
          viewBox="0 0 32 32"
          aria-hidden="true"
          role="presentation"
          focusable="false"
          className="h-5 w-5"
          style={{
            display: "block",
            fill: count > 0 ? "#FF385C" : "none",
            stroke: count > 0 ? "#FF385C" : "currentColor",
            strokeWidth: 2,
            overflow: "visible",
          }}
        >
          <path d="M16 28c7-4.73 14-10 14-17a6.98 6.98 0 0 0-7-7c-1.8 0-3.58.68-4.95 2.05L16 8.1l-2.05-2.05a6.98 6.98 0 0 0-9.9 0A6.98 6.98 0 0 0 2 11c0 7 7 12.27 14 17z" />
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
