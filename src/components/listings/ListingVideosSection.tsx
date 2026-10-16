"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ListingVideoItem {
  id: number;
  url: string;
  title: string | null;
  sortOrder: number;
}

interface ListingVideosSectionProps {
  videos: ListingVideoItem[];
}

/**
 * Extracts YouTube video ID from various YouTube URL formats.
 */
function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

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
      const v = urlObj.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const match = urlObj.pathname.match(/^\/(?:shorts|embed)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    } else if (hostname === "youtu.be") {
      const match = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[1];
    }
  } catch {
    // Fallback
  }

  const match = trimmed.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/
  );
  if (match) return match[1];

  return null;
}

/**
 * Extracts Vimeo video ID from Vimeo URL formats.
 */
function extractVimeoId(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  try {
    const urlObj = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, "");

    if (hostname === "vimeo.com") {
      const match = urlObj.pathname.match(/^\/(\d+)/);
      if (match) return match[1];
    } else if (hostname === "player.vimeo.com") {
      const match = urlObj.pathname.match(/^\/video\/(\d+)/);
      if (match) return match[1];
    }
  } catch {
    // Fallback
  }

  const match = trimmed.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (match) return match[1];

  return null;
}

interface VideoMetadata {
  type: "youtube" | "vimeo" | "video";
  id?: string;
  embedUrl: string;
  thumbnailUrl: string;
  watchUrl?: string;
}

function parseVideoMeta(rawUrl: string): VideoMetadata {
  const ytId = extractYouTubeId(rawUrl);
  if (ytId) {
    return {
      type: "youtube",
      id: ytId,
      embedUrl: `https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`,
      thumbnailUrl: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      watchUrl: `https://www.youtube.com/watch?v=${ytId}`,
    };
  }

  const vimeoId = extractVimeoId(rawUrl);
  if (vimeoId) {
    return {
      type: "vimeo",
      id: vimeoId,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}?autoplay=1&badge=0&autopause=0`,
      thumbnailUrl: `https://vumbnail.com/${vimeoId}.jpg`,
      watchUrl: `https://vimeo.com/${vimeoId}`,
    };
  }

  return {
    type: "video",
    embedUrl: rawUrl,
    thumbnailUrl: "/images/property-placeholder.jpg",
  };
}

export function ListingVideosSection({ videos }: ListingVideosSectionProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const thumbnailButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll, handle Escape key, and trap focus
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCloseModal();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!videos || videos.length === 0) {
    return null;
  }

  const currentVideo = videos[activeIdx] || videos[0];
  const meta = parseVideoMeta(currentVideo.url);
  const displayTitle = currentVideo.title || `Project Video ${activeIdx + 1}`;

  const handleOpenModal = () => {
    setIsOpen(true);
  };

  const handleCloseModal = () => {
    setIsOpen(false);
    setTimeout(() => {
      thumbnailButtonRef.current?.focus();
    }, 0);
  };

  return (
    <>
      <section className="mt-3 w-full max-w-full sm:max-w-md overflow-hidden rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3 sm:p-3.5 shadow-2xs">
        {/* Header */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-900">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <svg className="h-2.5 w-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            Project Videos & Virtual Tours
          </h3>

          {videos.length > 1 && (
            <span className="text-[11px] font-medium text-neutral-500">
              {activeIdx + 1} of {videos.length}
            </span>
          )}
        </div>

        {displayTitle && (
          <p className="mb-2 text-xs text-neutral-600 truncate font-medium" title={displayTitle}>
            {displayTitle}
          </p>
        )}

        {/* 1. INLINE STATE: 16:9 Thumbnail button with play overlay */}
        <button
          ref={thumbnailButtonRef}
          type="button"
          onClick={handleOpenModal}
          aria-label={`Play ${displayTitle}`}
          className="group relative block aspect-video w-full overflow-hidden rounded-lg bg-neutral-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 cursor-pointer shadow-inner"
        >
          {/* Thumbnail */}
          {meta.type === "video" ? (
            <video
              src={meta.embedUrl}
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <img
              src={meta.thumbnailUrl}
              alt={displayTitle}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          )}

          {/* Centered Play Button Overlay */}
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors duration-200 group-hover:bg-black/40">
            <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition-transform duration-200 group-hover:scale-110">
              <svg className="h-6 w-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </button>

        {/* Video selector pills if multiple videos */}
        {videos.length > 1 && (
          <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {videos.map((vid, idx) => (
              <button
                key={vid.id || idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition cursor-pointer shrink-0 ${
                  activeIdx === idx
                    ? "bg-neutral-900 text-white shadow-2xs"
                    : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
                }`}
              >
                Video {idx + 1}
              </button>
            ))}
          </div>
        )}

        {/* Fallback link below thumbnail */}
        {meta.watchUrl && (
          <div className="mt-2 flex items-center justify-end">
            <a
              href={meta.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              <span>Watch on {meta.type === "youtube" ? "YouTube" : "Vimeo"}</span>
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        )}
      </section>

      {/* 2. MODAL STATE: Rendered in Portal matching Image 3 */}
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
                <div className="flex items-center gap-2 truncate pr-3">
                  <h2 className="text-xs sm:text-sm lg:text-base font-semibold text-neutral-200 truncate">
                    {displayTitle}
                  </h2>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* In-modal video switcher if multiple */}
                  {videos.length > 1 && (
                    <div className="hidden sm:flex items-center gap-1 bg-neutral-900 p-0.5 rounded-md border border-neutral-800 mr-2">
                      {videos.map((vid, idx) => (
                        <button
                          key={vid.id || idx}
                          type="button"
                          onClick={() => setActiveIdx(idx)}
                          className={`px-2 py-0.5 text-xs font-medium rounded transition cursor-pointer ${
                            activeIdx === idx
                              ? "bg-rose-600 text-white"
                              : "text-neutral-400 hover:text-white"
                          }`}
                        >
                          Video {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

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
              </div>

              {/* 16:9 Responsive Video Player - Iframe/Video rendered ONLY when modal is open */}
              <div className="relative aspect-video w-full bg-black">
                {meta.type === "youtube" || meta.type === "vimeo" ? (
                  <iframe
                    key={meta.embedUrl}
                    src={meta.embedUrl}
                    title={displayTitle}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="relative h-full w-full border-0"
                  />
                ) : (
                  <video
                    key={meta.embedUrl}
                    src={meta.embedUrl}
                    controls
                    autoPlay
                    playsInline
                    className="relative h-full w-full object-contain"
                  />
                )}
              </div>

              {/* Footer matching Image 3: Title on left, Watch on YouTube/Vimeo on right */}
              <div className="flex items-center justify-between border-t border-neutral-800 bg-black px-4 py-3 sm:px-5 lg:px-6 text-xs sm:text-sm text-neutral-400">
                <span className="truncate pr-3 font-medium text-neutral-300">
                  {displayTitle}
                </span>

                {meta.watchUrl && (
                  <a
                    href={meta.watchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-rose-400 hover:text-rose-300 transition-colors shrink-0"
                  >
                    <span>Watch on {meta.type === "youtube" ? "YouTube" : "Vimeo"}</span>
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
