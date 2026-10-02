"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { VideoUploader } from "@/components/listings/VideoUploader";
import { saveListingVideos } from "@/lib/actions/listings";

interface DeveloperVideoManagerProps {
  listingId: number;
  listingTitle: string;
  initialVideos: { id: number; url: string; title: string | null }[];
}

export function DeveloperVideoManager({
  listingId,
  listingTitle,
  initialVideos,
}: DeveloperVideoManagerProps) {
  const [videos, setVideos] = useState<{ url: string; title?: string }[]>(
    initialVideos.map((v) => ({ url: v.url, title: v.title || undefined }))
  );
  const [isPending, startTransition] = useTransition();
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  function handleSave() {
    setErrorMessage("");
    setSavedSuccess(false);

    startTransition(async () => {
      try {
        await saveListingVideos(listingId, videos);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3500);
      } catch (err: unknown) {
        setErrorMessage((err as Error)?.message || "Failed to save project videos.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Top navigation */}
      <div>
        <Link
          href="/developer/dashboard"
          className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 transition flex items-center gap-1.5"
        >
          ← Back to My properties
        </Link>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">
              Project Videos
            </h1>
            <p className="text-sm text-neutral-600 mt-0.5">
              Manage video tours and walkthroughs for{" "}
              <span className="font-semibold text-neutral-900">{listingTitle}</span>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/developer/dashboard/listings/${listingId}/edit`}
              className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 shadow-2xs hover:bg-neutral-50"
            >
              Edit Property Details
            </Link>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
            >
              {isPending ? "Saving Videos…" : "Save Videos"}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-2xs">
          <svg className="h-5 w-5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Project videos updated successfully!</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-2xs">
          <svg className="h-5 w-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Video Uploader Container */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-xs">
        <VideoUploader
          initialVideos={initialVideos}
          onChange={(updated) => setVideos(updated)}
        />
      </div>

      {/* Bottom Save Action */}
      <div className="flex justify-end gap-3 pt-2">
        <Link
          href="/developer/dashboard"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 shadow-2xs"
        >
          Done
        </Link>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 shadow-2xs disabled:opacity-50 cursor-pointer"
        >
          {isPending ? "Saving Videos…" : "Save Videos"}
        </button>
      </div>
    </div>
  );
}
