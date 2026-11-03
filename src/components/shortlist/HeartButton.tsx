"use client";

import React, { useTransition } from "react";
import { useShortlist } from "@/context/ShortlistContext";

interface HeartButtonProps {
  listingId: number;
  variant?: "icon" | "button";
  className?: string;
  showLabelOnMobile?: boolean;
}

export function HeartButton({
  listingId,
  variant = "icon",
  className = "",
  showLabelOnMobile = true,
}: HeartButtonProps) {
  const { isShortlisted, toggleShortlist } = useShortlist();
  const [, startTransition] = useTransition();

  const shortlisted = isShortlisted(listingId);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    startTransition(() => {
      toggleShortlist(listingId);
    });
  };

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={shortlisted}
        aria-label={
          shortlisted
            ? "Remove property from Shortlist"
            : "Add property to Shortlist"
        }
        className={`min-h-[44px] min-w-[44px] cursor-pointer inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 select-none ${
          shortlisted
            ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100/80 shadow-xs"
            : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 hover:text-neutral-900 shadow-xs"
        } ${className}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          aria-hidden="true"
          role="presentation"
          focusable="false"
          className="h-5 w-5 transition-transform duration-150 active:scale-90"
          style={{
            display: "block",
            fill: shortlisted ? "#FF385C" : "none",
            stroke: shortlisted ? "#FF385C" : "currentColor",
            strokeWidth: 2,
          }}
        >
          <path d="M16 28c7-4.73 14-10 14-17a6.98 6.98 0 0 0-7-7c-1.8 0-3.58.68-4.95 2.05L16 8.1l-2.05-2.05a6.98 6.98 0 0 0-9.9 0A6.98 6.98 0 0 0 2 11c0 7 7 12.27 14 17z" />
        </svg>
        <span className={showLabelOnMobile ? "inline" : "hidden sm:inline"}>
          {shortlisted ? "Shortlisted" : "Shortlist"}
        </span>
      </button>
    );
  }

  // variant === "icon" (Airbnb-style overlay heart on photo cards)
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={shortlisted}
      aria-label={
        shortlisted
          ? "Remove property from Shortlist"
          : "Add property to Shortlist"
      }
      className={`group/heart relative cursor-pointer flex items-center justify-center bg-transparent transition-transform duration-150 hover:scale-110 active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white select-none before:absolute before:-inset-2.5 before:content-[''] ${className}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        aria-hidden="true"
        role="presentation"
        focusable="false"
        className={`h-6 w-6 transition-transform duration-150 group-active/heart:scale-90 ${
          shortlisted ? "animate-in zoom-in-75 duration-150" : ""
        }`}
        style={{
          display: "block",
          fill: shortlisted ? "#FF385C" : "rgba(0, 0, 0, 0.5)",
          stroke: "#ffffff",
          strokeWidth: 2,
          overflow: "visible",
        }}
      >
        <path d="M16 28c7-4.73 14-10 14-17a6.98 6.98 0 0 0-7-7c-1.8 0-3.58.68-4.95 2.05L16 8.1l-2.05-2.05a6.98 6.98 0 0 0-9.9 0A6.98 6.98 0 0 0 2 11c0 7 7 12.27 14 17z" />
      </svg>
    </button>
  );
}
