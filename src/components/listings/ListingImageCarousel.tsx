"use client";

import { useState } from "react";

export function ListingImageCarousel({
  images,
  alt,
}: {
  images: { id: string; url: string }[];
  alt: string;
}) {
  const [index, setIndex] = useState(0);

  if (images.length === 0) return null;

  const showArrows = images.length > 1;
  const goTo = (next: number) => setIndex((next + images.length) % images.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="group relative aspect-[16/9] w-full overflow-hidden rounded-lg bg-gray-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[index].url} alt={alt} className="h-full w-full object-cover" />

        {showArrows && (
          <>
            <button
              type="button"
              aria-label="Previous image"
              onClick={() => goTo(index - 1)}
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-gray-900 opacity-0 shadow transition hover:bg-white group-hover:opacity-100"
            >
              <ChevronIcon direction="left" />
            </button>
            <button
              type="button"
              aria-label="Next image"
              onClick={() => goTo(index + 1)}
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-gray-900 opacity-0 shadow transition hover:bg-white group-hover:opacity-100"
            >
              <ChevronIcon direction="right" />
            </button>
            <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
              {index + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {showArrows && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              aria-label={`View image ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-16 w-24 flex-none overflow-hidden rounded-md border-2 ${
                i === index ? "border-gray-900" : "border-transparent"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      {direction === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
    </svg>
  );
}
