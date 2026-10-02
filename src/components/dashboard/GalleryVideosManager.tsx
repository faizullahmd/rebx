"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addGalleryVideo, deleteGalleryVideo, type AddVideoState } from "@/lib/actions/videos";
import { parseVideoUrl } from "@/lib/video";

export type UserVideoItem = {
  id: number;
  title: string;
  url: string;
  provider: string;
  videoId: string;
  thumbnailUrl: string | null;
  createdAt: Date | string;
  listings: {
    id: number;
    title: string;
    slug: string;
  }[];
};

interface GalleryVideosManagerProps {
  initialVideos: UserVideoItem[];
  roleTitle: string;
}

export function GalleryVideosManager({ initialVideos, roleTitle }: GalleryVideosManagerProps) {
  const [state, formAction, isPending] = useActionState(
    addGalleryVideo,
    undefined
  );

  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [vimeoThumb, setVimeoThumb] = useState<string | null>(null);

  // Deletion state
  const [videoToDelete, setVideoToDelete] = useState<UserVideoItem | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Parse URL live for preview
  const parsedVideo = useMemo(() => {
    if (!url.trim()) return null;
    return parseVideoUrl(url.trim());
  }, [url]);

  const urlError = useMemo(() => {
    if (!url.trim()) return null;
    if (!parsedVideo) return "Please enter a valid YouTube or Vimeo URL.";
    return null;
  }, [url, parsedVideo]);

  // Fetch Vimeo thumbnail preview if Vimeo link entered
  useEffect(() => {
    if (parsedVideo?.provider === "vimeo") {
      fetch(`/api/video-meta?url=${encodeURIComponent(url.trim())}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.thumbnailUrl) setVimeoThumb(data.thumbnailUrl);
        })
        .catch(() => {});
    } else {
      setVimeoThumb(null);
    }
  }, [parsedVideo, url]);

  const liveThumbnail = parsedVideo?.provider === "vimeo"
    ? (vimeoThumb || parsedVideo.thumbnailUrl)
    : parsedVideo?.thumbnailUrl;

  // Reset form inputs upon successful addition
  useEffect(() => {
    if (state?.success) {
      setTitle("");
      setUrl("");
      setVimeoThumb(null);
    }
  }, [state?.success]);

  function confirmDelete(video: UserVideoItem) {
    setDeleteError(null);
    setVideoToDelete(video);
  }

  function handleDelete() {
    if (!videoToDelete) return;
    setDeleteError(null);

    startDeleteTransition(async () => {
      const res = await deleteGalleryVideo(videoToDelete.id);
      if (res.success) {
        setVideoToDelete(null);
      } else {
        setDeleteError(res.message || "Failed to delete video.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
          Video Gallery Management
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Add property videos and walkthroughs to the REBX Video Gallery. Permitted{" "}
          {roleTitle.toLowerCase()}s can attach any gallery video to their listings.
        </p>
      </div>

      {/* Add Video Form Card */}
      <section className="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 shadow-xs">
        <h2 className="text-base font-bold text-neutral-900">Add Video to Gallery</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          Enter a video title and paste a YouTube or Vimeo link to create a new gallery record.
        </p>

        {state?.success && state.message && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs sm:text-sm text-emerald-800">
            <svg className="h-4 w-4 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{state.message}</span>
          </div>
        )}

        {state?.message && !state.success && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-xs sm:text-sm text-red-800">
            <svg className="h-4 w-4 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{state.message}</span>
          </div>
        )}

        <form action={formAction} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* Title field */}
            <div className="md:col-span-5 flex flex-col gap-1">
              <label htmlFor="video-title-input" className="text-xs font-semibold text-neutral-900">
                Video Title <span className="text-red-500">*</span>
              </label>
              <input
                id="video-title-input"
                name="title"
                type="text"
                required
                placeholder="e.g. Modern Sunset Villa Walkthrough"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={`h-9 w-full rounded-lg border px-3 text-xs outline-none transition ${
                  state?.errors?.title
                    ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    : "border-neutral-300 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                }`}
              />
              {state?.errors?.title && (
                <p className="text-[11px] font-medium text-red-600">{state.errors.title[0]}</p>
              )}
            </div>

            {/* URL field */}
            <div className="md:col-span-5 flex flex-col gap-1">
              <label htmlFor="video-url-input" className="text-xs font-semibold text-neutral-900">
                Video URL <span className="text-red-500">*</span>
              </label>
              <input
                id="video-url-input"
                name="url"
                type="url"
                required
                placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={`h-9 w-full rounded-lg border px-3 text-xs outline-none transition ${
                  urlError || state?.errors?.url
                    ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500"
                    : "border-neutral-300 focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
                }`}
              />
              {(urlError || state?.errors?.url) && (
                <p className="text-[11px] font-medium text-red-600">
                  {urlError || state?.errors?.url?.[0]}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isPending || Boolean(urlError) || !title.trim() || !url.trim()}
                className="h-9 w-full rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 disabled:opacity-50 transition cursor-pointer flex items-center justify-center whitespace-nowrap"
              >
                {isPending ? "Adding…" : "Add to Gallery"}
              </button>
            </div>
          </div>

          {/* Live Preview Card */}
          {liveThumbnail && !urlError && (
            <div className="mt-2.5 flex flex-col sm:flex-row items-start sm:items-center gap-3.5 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3">
              <div className="relative aspect-video w-36 overflow-hidden rounded-lg bg-black shadow-xs shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={liveThumbnail}
                  alt="Live Preview Thumbnail"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 shadow-md">
                    <svg className="h-3 w-3 text-neutral-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
                  {parsedVideo?.provider}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                  ✓ Valid {parsedVideo?.provider === "youtube" ? "YouTube" : "Vimeo"} Video
                </span>
                <p className="mt-0.5 text-xs font-semibold text-neutral-900 truncate">
                  {title || "Untitled Video"}
                </p>
                <p className="text-[11px] text-neutral-500 truncate mt-0.5">{url}</p>
              </div>
            </div>
          )}
        </form>
      </section>

      {/* List of user added videos */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Videos You Added</h2>
            <p className="text-xs text-neutral-500">
              Manage videos you added to the gallery. Deleting a video detaches it from any linked listings.
            </p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
            {initialVideos.length} {initialVideos.length === 1 ? "video" : "videos"}
          </span>
        </div>

        {initialVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-12 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-2xs border border-neutral-200 text-neutral-400">
              <svg className="h-6 w-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-neutral-900">
              No gallery videos added yet
            </h3>
            <p className="mt-1 text-xs text-neutral-500 max-w-sm">
              Use the form above to add property walkthroughs. Once added, you can attach them when creating or editing listings.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {initialVideos.map((video) => {
              const hasListings = video.listings && video.listings.length > 0;
              return (
                <div
                  key={video.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xs hover:shadow-xs transition"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-neutral-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={video.thumbnailUrl || "/images/property-placeholder.jpg"}
                      alt={video.title}
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-xs">
                      {video.provider}
                    </span>
                    <a
                      href={video.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition group"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 group-hover:scale-110 group-hover:bg-white text-neutral-900 shadow-md transition">
                        <svg className="h-4 w-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </a>
                  </div>

                  {/* Body */}
                  <div className="flex flex-1 flex-col p-4">
                    <h3 className="text-sm font-semibold text-neutral-900 line-clamp-1" title={video.title}>
                      {video.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-neutral-500 truncate">{video.url}</p>

                    {/* Attached listings count */}
                    <div className="mt-3 flex items-center gap-1.5">
                      {hasListings ? (
                        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                          </svg>
                          Attached to {video.listings.length} {video.listings.length === 1 ? "listing" : "listings"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
                          Not attached to any listing
                        </span>
                      )}
                    </div>

                    {/* Attached listing preview links */}
                    {hasListings && (
                      <div className="mt-2 text-xs text-neutral-600 line-clamp-1">
                        <span className="font-medium text-neutral-500">Used in: </span>
                        {video.listings.map((l, i) => (
                          <span key={l.id}>
                            <Link href={`/listings/${l.slug}`} className="hover:underline text-neutral-900 font-medium">
                              {l.title}
                            </Link>
                            {i < video.listings.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Footer Actions */}
                    <div className="mt-auto pt-4 flex items-center justify-between border-t border-neutral-100">
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:underline"
                      >
                        Watch ↗
                      </a>

                      <button
                        type="button"
                        onClick={() => confirmDelete(video)}
                        className="rounded-md px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {videoToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5 animate-in zoom-in-95">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 mx-auto">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h3 className="mt-4 text-center text-lg font-bold text-neutral-900">
              Delete Video from Gallery?
            </h3>

            <p className="mt-2 text-center text-xs sm:text-sm text-neutral-600">
              Are you sure you want to permanently delete{" "}
              <span className="font-semibold text-neutral-900">&quot;{videoToDelete.title}&quot;</span>?
            </p>

            {videoToDelete.listings && videoToDelete.listings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900">
                <p className="font-semibold flex items-center gap-1.5">
                  <span>⚠️</span> Warning: Attached to {videoToDelete.listings.length} {videoToDelete.listings.length === 1 ? "Listing" : "Listings"}
                </p>
                <p className="mt-1 text-amber-800">
                  This video is currently attached to:{" "}
                  <span className="font-medium">
                    {videoToDelete.listings.map((l) => l.title).join(", ")}
                  </span>
                  . Deleting it will remove the video tour from those property pages.
                </p>
              </div>
            )}

            {deleteError && (
              <p className="mt-3 text-xs text-center font-medium text-red-600">
                {deleteError}
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setVideoToDelete(null)}
                disabled={isDeleting}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition cursor-pointer"
              >
                {isDeleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
