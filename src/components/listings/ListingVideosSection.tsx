"use client";

import { useState } from "react";

interface ListingVideoItem {
  id: number;
  url: string;
  title: string | null;
  sortOrder: number;
}

interface ListingVideosSectionProps {
  videos: ListingVideoItem[];
}

function getEmbedUrl(rawUrl: string): { type: "youtube" | "vimeo" | "video"; embedUrl: string } {
  try {
    const parsed = new URL(rawUrl);

    // YouTube
    if (parsed.hostname.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) {
        return {
          type: "youtube",
          embedUrl: `https://www.youtube-nocookie.com/embed/${v}?rel=0`,
        };
      }
      if (parsed.pathname.startsWith("/embed/")) {
        return {
          type: "youtube",
          embedUrl: `https://www.youtube-nocookie.com${parsed.pathname}?rel=0`,
        };
      }
    }
    if (parsed.hostname.includes("youtu.be")) {
      const v = parsed.pathname.slice(1);
      if (v) {
        return {
          type: "youtube",
          embedUrl: `https://www.youtube-nocookie.com/embed/${v}?rel=0`,
        };
      }
    }

    // Vimeo
    if (parsed.hostname.includes("vimeo.com")) {
      const match = parsed.pathname.match(/\/(\d+)/);
      if (match) {
        return {
          type: "vimeo",
          embedUrl: `https://player.vimeo.com/video/${match[1]}`,
        };
      }
    }
  } catch {
    // If not a valid URL or local relative path
  }

  return { type: "video", embedUrl: rawUrl };
}

export function ListingVideosSection({ videos }: ListingVideosSectionProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (!videos || videos.length === 0) {
    return null;
  }

  const currentVideo = videos[activeIdx] || videos[0];
  const { type, embedUrl } = getEmbedUrl(currentVideo.url);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <svg
              className="h-5 w-5 text-indigo-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            Project Videos & Virtual Tours
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Watch drone walkthroughs, project highlights, and virtual presentations ({videos.length}{" "}
            {videos.length === 1 ? "video" : "videos"})
          </p>
        </div>

        {videos.length > 1 && (
          <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-lg">
            {videos.map((vid, idx) => (
              <button
                key={vid.id || idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeIdx === idx
                    ? "bg-white text-gray-900 shadow-xs"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Video {idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main active video player */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-inner">
        {type === "youtube" || type === "vimeo" ? (
          <iframe
            src={embedUrl}
            title={currentVideo.title || `Video ${activeIdx + 1}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full border-0"
          />
        ) : (
          <video
            key={currentVideo.url}
            src={currentVideo.url}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-contain"
          />
        )}
      </div>

      {/* Video caption/title */}
      {currentVideo.title && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <p className="font-medium text-gray-800">{currentVideo.title}</p>
          <span className="text-xs text-gray-400">
            {activeIdx + 1} of {videos.length}
          </span>
        </div>
      )}

      {/* Thumbnails list if multiple videos */}
      {videos.length > 1 && (
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-gray-100 pt-4">
          {videos.map((vid, idx) => {
            const isSelected = activeIdx === idx;
            return (
              <button
                key={vid.id || idx}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`group relative flex flex-col items-start gap-1 rounded-lg p-2 text-left transition-all ${
                  isSelected
                    ? "bg-indigo-50/70 ring-2 ring-indigo-600"
                    : "bg-gray-50 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                      isSelected
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="truncate">
                    {vid.title || `Project Video ${idx + 1}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
