"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface PropertyVideoPlayerProps {
  videoUrl: string;
  title?: string;
}

/**
 * Robustly extracts the YouTube video ID from various YouTube URL formats:
 * - watch?v={id}
 * - youtu.be/{id}
 * - /embed/{id} or /shorts/{id}
 * - raw 11-char ID
 * Returns null if no valid ID is found.
 */
export function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  // Check if raw 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, "");

    if (
      hostname === "youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtube-nocookie.com"
    ) {
      // 1. /watch?v={id}
      const v = urlObj.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        return v;
      }
      // 2. /shorts/{id} or /embed/{id}
      const match = urlObj.pathname.match(/^\/(?:shorts|embed)\/([a-zA-Z0-9_-]{11})/);
      if (match) {
        return match[1];
      }
    } else if (hostname === "youtu.be") {
      // 3. youtu.be/{id}
      const match = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Fall through to regex fallback
  }

  // Regex fallback for non-standard / partial formats
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Builds the embed URL merging any existing query params and guaranteeing:
 * autoplay=1, playsinline=1, rel=0, and modestbranding=1
 */
function buildEmbedUrl(videoId: string, rawUrl: string): string {
  const params = new URLSearchParams();

  try {
    const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    parsed.searchParams.forEach((value, key) => {
      if (key !== "v") {
        params.set(key, value);
      }
    });
  } catch {
    // If not a full URL, no additional query params to copy
  }

  // Required params
  params.set("autoplay", "1");
  params.set("playsinline", "1");
  params.set("rel", "0");
  params.set("modestbranding", "1");

  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

export function PropertyVideoPlayer({ videoUrl, title }: PropertyVideoPlayerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const thumbnailButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const videoId = extractYouTubeId(videoUrl);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle modal escape key, focus trapping, and body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseModal();
        return;
      }

      // Focus trap within modal
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

    // Lock body and html scroll while modal is open
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // If no valid video ID was found, render nothing
  if (!videoId) return null;

  const handleOpenModal = () => {
    setIsOpen(true);
  };

  const handleCloseModal = () => {
    setIsOpen(false);
    // Restore focus to thumbnail button upon closing
    setTimeout(() => {
      thumbnailButtonRef.current?.focus();
    }, 0);
  };

  const embedUrl = buildEmbedUrl(videoId, videoUrl);
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const displayTitle = title || "Property Video";

  return (
    <>
      <section className="mt-3 w-full max-w-full sm:max-w-md overflow-hidden rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3 sm:p-3.5 shadow-2xs">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-900">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <svg className="h-2.5 w-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            Property Video Tour
          </h3>
        </div>

        {title && (
          <p className="mb-2 text-xs text-neutral-600 truncate font-medium" title={title}>
            {title}
          </p>
        )}

        {/* 1. INLINE STATE: 16:9 Thumbnail button with play overlay */}
        <button
          ref={thumbnailButtonRef}
          type="button"
          onClick={handleOpenModal}
          aria-label="Play video"
          className="group relative block aspect-video w-full overflow-hidden rounded-lg bg-neutral-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 cursor-pointer shadow-inner"
        >
          {/* YouTube Video Thumbnail */}
          <img
            src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
            alt={title ? `${title} thumbnail` : "Property video thumbnail"}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />

          {/* Centered Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-200 group-hover:bg-black/40">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-transform duration-200 group-hover:scale-110">
              <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </button>

        {/* Optional fallback link below thumbnail */}
        <div className="mt-2 flex items-center justify-end">
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors"
          >
            <span>Watch on YouTube</span>
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </section>

      {/* 2. MODAL STATE: Rendered in Portal at document.body level */}
      {mounted &&
        isOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={displayTitle}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-0 sm:p-3 md:p-4 lg:p-6 overflow-hidden overscroll-none"
          >
            {/* Dark Backdrop (click to close) */}
            <div
              className="fixed inset-0 bg-black transition-opacity duration-300"
              onClick={handleCloseModal}
              aria-hidden="true"
            />

            {/* Modal Dialog Container */}
            <div
              ref={modalRef}
              style={{
                maxWidth: "min(100%, calc((100vh - 7rem) * 16 / 9), 1280px)",
              }}
              className="relative z-10 flex w-full flex-col bg-black text-white"
            >
              {/* Header with Title & Accessible Close Button (>= 44px tap size) */}
              <div className="flex items-center justify-between border-b border-neutral-800 bg-black px-4 py-2.5 sm:px-5 lg:px-6">
                <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-neutral-200 truncate pr-3">
                  {displayTitle}
                </h2>

                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={handleCloseModal}
                  aria-label="Close video player"
                  className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white cursor-pointer"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 16:9 Responsive Video Player - Iframe rendered ONLY when modal is open */}
              <div className="relative aspect-video w-full bg-black">
                <iframe
                  src={embedUrl}
                  title="Property video"
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="relative h-full w-full border-0"
                />
              </div>

              {/* 3. FALLBACK LINK: Below the player in the modal */}
              <div className="flex items-center justify-between border-t border-neutral-800 bg-black px-4 py-3 sm:px-5 lg:px-6 text-xs sm:text-sm text-neutral-400">
                <span className="truncate pr-3 font-medium text-neutral-300">
                  {title || "Property Video Tour"}
                </span>
                <a
                  href={watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-medium text-rose-400 hover:text-rose-300 transition-colors shrink-0"
                >
                  <span>Watch on YouTube</span>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
