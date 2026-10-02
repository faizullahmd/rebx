"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseVideoUrl } from "@/lib/video";
import { VideoCard, type ListingWithVideo } from "./VideoCard";
import { VideoModalPlayer } from "./VideoModalPlayer";

interface VideoGalleryGridProps {
  listings: ListingWithVideo[];
  initialPlayId?: string;
}

export function VideoGalleryGrid({ listings, initialPlayId }: VideoGalleryGridProps) {
  function findListing(param?: string | null): ListingWithVideo | null {
    if (!param) return null;
    const trimmed = param.trim();
    if (!trimmed) return null;

    return (
      listings.find((item) => {
        if (String(item.id) === trimmed) return true;
        if (item.videoId === trimmed) return true;
        if (item.url) {
          const parsed = parseVideoUrl(item.url);
          if (parsed?.videoId === trimmed) return true;
        }
        if (item.listing && (item.listing.slug === trimmed || String(item.listing.id) === trimmed)) {
          return true;
        }
        return false;
      }) || null
    );
  }

  const [selectedListing, setSelectedListing] = useState<ListingWithVideo | null>(() =>
    findListing(initialPlayId)
  );

  const searchParams = useSearchParams();
  const playParam = searchParams.get("play");

  useEffect(() => {
    if (playParam) {
      const match = findListing(playParam);
      if (match) {
        setSelectedListing(match);
      }
    }
  }, [playParam, listings]);

  function handleClose() {
    setSelectedListing(null);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.has("play")) {
        url.searchParams.delete("play");
        const nextQuery = url.searchParams.toString();
        const nextPath = url.pathname + (nextQuery ? `?${nextQuery}` : "");
        window.history.replaceState(null, "", nextPath);
      }
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {listings.map((listing) => (
          <VideoCard
            key={listing.id}
            listing={listing}
            onSelect={(item) => setSelectedListing(item)}
          />
        ))}
      </div>

      {/* Accessible Video Modal Player */}
      <VideoModalPlayer listing={selectedListing} onClose={handleClose} />
    </>
  );
}
