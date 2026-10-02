"use client";

import { useEffect, useState, useMemo, useRef } from "react";

export interface VideoOption {
  id: number;
  title: string;
  thumbnailUrl: string | null;
}

interface VideoSelectProps {
  name?: string;
  value?: number | string | null;
  initialVideo?: VideoOption | null;
  onChange?: (videoId: number | null, video: VideoOption | null) => void;
  disabled?: boolean;
}

export function VideoSelect({
  name = "videoId",
  value,
  initialVideo,
  onChange,
  disabled = false,
}: VideoSelectProps) {
  const [videos, setVideos] = useState<VideoOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Normalized internal ID state
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    if (value !== undefined && value !== null && value !== "") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    return initialVideo?.id ?? null;
  });

  // Sync when prop value changes
  useEffect(() => {
    if (value !== undefined) {
      if (value === null || value === "") {
        setSelectedId(null);
      } else {
        const parsed = Number(value);
        setSelectedId(Number.isNaN(parsed) ? null : parsed);
      }
    }
  }, [value]);

  // Fetch videos from GET /api/videos
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetch("/api/videos")
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load videos (${res.status})`);
        }
        return res.json();
      })
      .then((data: VideoOption[]) => {
        if (!isMounted) return;
        setVideos(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.warn("VideoSelect fetch error:", err);
        setError("Unable to load video gallery");
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filtered videos when searching
  const filteredVideos = useMemo(() => {
    if (!searchQuery.trim()) return videos;
    const q = searchQuery.toLowerCase().trim();
    return videos.filter((v) => v.title.toLowerCase().includes(q));
  }, [videos, searchQuery]);

  // Active video object
  const currentVideo = useMemo(() => {
    if (selectedId == null) return null;
    return videos.find((v) => v.id === selectedId) || (initialVideo?.id === selectedId ? initialVideo : null);
  }, [selectedId, videos, initialVideo]);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Auto-focus search input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  function handleSelect(newId: number | null) {
    setSelectedId(newId);
    const video = newId ? videos.find((v) => v.id === newId) || null : null;
    if (onChange) {
      onChange(newId, video);
    }
  }

  function handleRemove() {
    handleSelect(null);
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {/* Hidden input to ensure value submits with standard form data */}
      <input type="hidden" name={name} value={selectedId != null ? String(selectedId) : ""} />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          Video (optional)
        </label>
        <p className="text-xs text-neutral-500">
          Attach an existing walkthrough video from the Video Gallery.
        </p>
      </div>

      {/* Main Select Button / Combobox Trigger */}
      <div className="relative">
        <button
          type="button"
          disabled={disabled || isLoading}
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex w-full items-center justify-between rounded-md border bg-white px-3 py-2 text-sm text-left outline-none transition cursor-pointer disabled:bg-neutral-100 disabled:text-neutral-400 ${
            isOpen
              ? "border-neutral-900 ring-1 ring-neutral-900"
              : "border-gray-300 hover:border-neutral-400 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
          }`}
        >
          <span className={`truncate ${currentVideo ? "font-medium text-neutral-900" : "text-neutral-600"}`}>
            {isLoading ? "Loading video gallery..." : currentVideo ? currentVideo.title : "Select"}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-100">
            {/* Search Bar inside dropdown */}
            <div className="border-b border-neutral-100 p-2.5 bg-neutral-50/60">
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search videos by title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-md border border-neutral-200 bg-white pl-8 pr-7 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 outline-none focus:border-neutral-900"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-600 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Options List */}
            <div className="max-h-60 overflow-y-auto py-1">
              {/* Default "Select" Option */}
              <button
                type="button"
                onClick={() => {
                  handleSelect(null);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-xs sm:text-sm transition hover:bg-neutral-50 cursor-pointer ${
                  selectedId == null ? "bg-neutral-100 font-semibold text-neutral-900" : "text-neutral-700"
                }`}
              >
                <span>Select</span>
                {selectedId == null && (
                  <span className="text-xs font-bold text-neutral-900">✓</span>
                )}
              </button>

              {/* Filtered Videos */}
              {filteredVideos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => {
                    handleSelect(video.id);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 px-3.5 py-2 text-left text-xs sm:text-sm transition hover:bg-neutral-50 cursor-pointer ${
                    selectedId === video.id
                      ? "bg-neutral-100 font-semibold text-neutral-900"
                      : "text-neutral-800"
                  }`}
                >
                  {video.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      className="h-7 w-11 shrink-0 rounded object-cover border border-neutral-200"
                    />
                  )}
                  <span className="flex-1 truncate">{video.title}</span>
                  {selectedId === video.id && (
                    <span className="text-xs font-bold text-neutral-900 shrink-0">✓</span>
                  )}
                </button>
              ))}

              {filteredVideos.length === 0 && searchQuery && (
                <div className="py-6 px-4 text-center text-xs text-neutral-500">
                  No videos match &quot;{searchQuery}&quot;
                </div>
              )}

              {videos.length === 0 && !isLoading && !error && (
                <div className="py-6 px-4 text-center text-xs text-neutral-500">
                  No videos available in the gallery yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Empty Gallery Notice */}
      {!isLoading && !error && videos.length === 0 && (
        <p className="text-xs text-neutral-500">
          No videos available in the gallery yet. You can add videos in the Videos section of your dashboard.
        </p>
      )}

      {/* Graceful Error Notice */}
      {error && (
        <p className="text-xs text-amber-600">
          {error}. You can continue creating your listing without attaching a video.
        </p>
      )}

      {/* Video Preview Card */}
      {currentVideo && (
        <div className="mt-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3 shadow-2xs">
          <div className="flex items-center gap-3 min-w-0">
            {/* Thumbnail */}
            <div className="relative aspect-video w-28 sm:w-36 shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-2xs">
              {currentVideo.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentVideo.thumbnailUrl}
                  alt={currentVideo.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
                  No Thumbnail
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow-xs">
                  <svg className="h-3 w-3 text-neutral-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="min-w-0 flex-1">
              <span className="inline-block rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 mb-1">
                Selected Video
              </span>
              <p className="text-xs font-semibold text-neutral-900 truncate" title={currentVideo.title}>
                {currentVideo.title}
              </p>
            </div>
          </div>

          {/* Remove Link/Button */}
          <button
            type="button"
            onClick={handleRemove}
            className="text-xs font-semibold text-red-600 hover:text-red-800 hover:underline cursor-pointer shrink-0 self-end sm:self-center"
          >
            Remove video
          </button>
        </div>
      )}
    </div>
  );
}
