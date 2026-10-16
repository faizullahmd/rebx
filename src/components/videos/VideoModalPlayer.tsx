"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseVideoUrl } from "@/lib/video";
import type { VideoGalleryCardItem } from "./VideoCard";

interface VideoModalPlayerProps {
  listing: VideoGalleryCardItem | null;
  onClose: () => void;
}

export function VideoModalPlayer({ listing: item, onClose }: VideoModalPlayerProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close on Escape & trap focus
  useEffect(() => {
    if (!item) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
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

    // Lock body and html scroll
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);

    // Initial focus on close button
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    return () => {
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, onClose]);

  if (!item || !mounted) return null;

  const parsed = parseVideoUrl(item.url);
  let autoplayEmbedUrl = "";
  if (parsed?.embedUrl) {
    const separator = parsed.embedUrl.includes("?") ? "&" : "?";
    autoplayEmbedUrl = `${parsed.embedUrl}${separator}autoplay=1&playsinline=1&rel=0&modestbranding=1`;
  } else if (item.url) {
    autoplayEmbedUrl = item.url;
  }

  const isYouTube = parsed?.provider === "youtube" || item.provider === "youtube";
  const isVimeo = parsed?.provider === "vimeo" || item.provider === "vimeo";
  const watchUrl =
    isYouTube && parsed?.videoId
      ? `https://www.youtube.com/watch?v=${parsed.videoId}`
      : isVimeo && parsed?.videoId
        ? `https://vimeo.com/${parsed.videoId}`
        : item.url;

  const displayTitle = item.title || "Property Video";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={displayTitle}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-0 sm:p-3 md:p-4 lg:p-6 overflow-hidden overscroll-none"
    >
      {/* Dark Backdrop (click to close) */}
      <div
        className="fixed inset-0 bg-black transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Container matching Image 3 */}
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
            onClick={onClose}
            aria-label="Close video player"
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-white cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 16:9 Responsive Video Player */}
        <div className="relative aspect-video w-full bg-black">
          {isYouTube || isVimeo || autoplayEmbedUrl.startsWith("http") ? (
            <iframe
              src={autoplayEmbedUrl}
              title={displayTitle}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="relative h-full w-full border-0"
            />
          ) : (
            <video
              src={autoplayEmbedUrl}
              controls
              autoPlay
              playsInline
              className="relative h-full w-full object-contain"
            />
          )}
        </div>

        {/* Footer matching Image 3 */}
        <div className="flex items-center justify-between border-t border-neutral-800 bg-black px-4 py-3 sm:px-5 lg:px-6 text-xs sm:text-sm text-neutral-400">
          <span className="truncate pr-3 font-medium text-neutral-300">
            {displayTitle}
          </span>

          {watchUrl && (
            <a
              href={watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-rose-400 hover:text-rose-300 transition-colors shrink-0"
            >
              <span>Watch on {isVimeo ? "Vimeo" : "YouTube"}</span>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
