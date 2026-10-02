"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { parseVideoUrl } from "@/lib/video";
import { TRANSACTION_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/property-taxonomy";
import type { VideoGalleryCardItem } from "./VideoCard";

interface VideoModalPlayerProps {
  listing: VideoGalleryCardItem | null;
  onClose: () => void;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function VideoModalPlayer({ listing: item, onClose }: VideoModalPlayerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [iframeError, setIframeError] = useState(false);

  // Close on Escape & trap focus
  useEffect(() => {
    if (!item) return;

    setIframeError(false);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    }

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);

    // Initial focus on close button
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, onClose]);

  if (!item) return null;

  const parsed = parseVideoUrl(item.url);
  // Construct embed URL with autoplay enabled
  let autoplayEmbedUrl = "";
  if (parsed?.embedUrl) {
    const separator = parsed.embedUrl.includes("?") ? "&" : "?";
    autoplayEmbedUrl = `${parsed.embedUrl}${separator}autoplay=1&mute=0&rel=0`;
  }

  const listing = item.listing;
  const formattedPrice = listing ? currencyFormatter.format(Number(listing.price)) : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Container */}
      <div
        ref={modalRef}
        className="relative z-10 flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-2xl ring-1 ring-white/10 animate-in zoom-in-95 duration-200"
      >
        {/* Top Bar with Title and Close Button */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 truncate pr-4">
            <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            <h2 id="video-modal-title" className="text-sm sm:text-base font-semibold text-white truncate">
              {item.title}
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close video player"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition focus:outline-none focus:ring-2 focus:ring-white cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video Player (16:9 responsive container) */}
        <div className="relative aspect-video w-full bg-black">
          {autoplayEmbedUrl && !iframeError ? (
            <iframe
              src={autoplayEmbedUrl}
              title={`Video player for ${item.title}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              onError={() => setIframeError(true)}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-neutral-300">
                Unable to load video stream
              </p>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition"
                >
                  Watch directly on provider ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* Bottom Property Summary & CTA: Shown if video is attached to a listing */}
        {listing && (
          <div className="flex flex-col gap-4 bg-neutral-950/70 p-4 sm:p-6 sm:flex-row sm:items-center sm:justify-between border-t border-neutral-800">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-neutral-800 px-2 py-0.5 font-medium text-neutral-300">
                  {TRANSACTION_LABELS[listing.transactionType]}
                </span>
                {listing.propertyType && (
                  <span className="rounded bg-neutral-800 px-2 py-0.5 font-medium text-neutral-300">
                    {PROPERTY_TYPE_LABELS[listing.propertyType]}
                  </span>
                )}
                <span className="text-neutral-400">
                  {listing.city}{listing.state ? `, ${listing.state}` : ""}
                </span>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-xl font-bold text-white tracking-tight">
                  {formattedPrice}
                </span>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  {listing.bedrooms != null && (
                    <span>{listing.bedrooms} Beds</span>
                  )}
                  {listing.bathrooms != null && (
                    <>
                      <span>·</span>
                      <span>{listing.bathrooms} Baths</span>
                    </>
                  )}
                  {listing.areaSqFt && (
                    <>
                      <span>·</span>
                      <span>{listing.areaSqFt.toLocaleString()} sqft</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/listings/${listing.slug}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-xs sm:text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-200 focus:outline-none focus:ring-2 focus:ring-white"
              >
                <span>View Property</span>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
