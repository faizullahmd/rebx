"use client";

import { useEffect, useRef, useState } from "react";
import {
  type PropertyLocation,
  formatDisplayAddress,
  getGoogleMapsEmbedUrl,
  getGoogleMapsDirectionsUrl,
  getGoogleMapsSearchUrl,
} from "@/lib/maps";

interface PropertyLocationSectionProps {
  title: string;
  location: PropertyLocation;
}

export function PropertyLocationSection({
  title,
  location,
}: PropertyLocationSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInViewport, setIsInViewport] = useState(false);
  const [isIframeLoaded, setIsIframeLoaded] = useState(false);
  const [hasTimedOut, setHasTimedOut] = useState(false);

  const embedUrl = getGoogleMapsEmbedUrl(location);
  const displayAddress = formatDisplayAddress(location);
  const directionsUrl = getGoogleMapsDirectionsUrl(location);
  const searchUrl = getGoogleMapsSearchUrl(location);

  // If the listing has no address and no coordinates, hide the Location section entirely
  if (!embedUrl) {
    return null;
  }

  // IntersectionObserver for lazy mounting
  useEffect(() => {
    const el = containerRef.current;
    if (!el || isInViewport) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsInViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isInViewport]);

  // 8-second failure fallback if iframe onLoad never fires
  useEffect(() => {
    if (!isInViewport || isIframeLoaded || hasTimedOut) return;

    const timer = setTimeout(() => {
      setHasTimedOut(true);
    }, 8000);

    return () => clearTimeout(timer);
  }, [isInViewport, isIframeLoaded, hasTimedOut]);

  return (
    <section className="mt-8 flex flex-col gap-4 border-t border-gray-100 pt-8">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-gray-900">Location</h2>
          {displayAddress && (
            <p className="mt-1 text-sm text-gray-600">{displayAddress}</p>
          )}
        </div>

        {directionsUrl && (
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3.5 py-2 text-xs font-semibold text-white bg-black rounded-lg hover:bg-gray-800 focus:outline-hidden focus:ring-2 focus:ring-black transition shadow-xs"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>Get directions</span>
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>

      {/* Map Container (fixed height to prevent layout shift: 300px mobile, 400px desktop) */}
      <div
        ref={containerRef}
        className="w-full h-[300px] md:h-[400px] rounded-xl border border-gray-200 bg-gray-100 overflow-hidden relative shadow-xs"
      >
        {/* Fallback View: Shown if iframe times out after 8s or encounters failure */}
        {hasTimedOut && !isIframeLoaded ? (
          <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gray-50">
            <svg
              className="w-10 h-10 text-gray-400 mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <p className="text-sm font-medium text-gray-800">Map preview could not be loaded.</p>
            {displayAddress && (
              <p className="text-xs text-gray-500 max-w-md mt-1">{displayAddress}</p>
            )}
            {searchUrl && (
              <a
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-black rounded-lg hover:bg-gray-800 focus:outline-hidden focus:ring-2 focus:ring-black transition shadow-xs"
              >
                View on Google Maps ↗
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Loading skeleton while waiting for viewport scroll or iframe onLoad */}
            {(!isInViewport || !isIframeLoaded) && (
              <div
                className="absolute inset-0 bg-gray-100 flex flex-col items-center justify-center gap-2 animate-pulse z-10"
                aria-label="Loading map"
              >
                <div className="w-8 h-8 rounded-full bg-gray-200" />
                <span className="text-xs text-gray-400 font-medium">Loading map...</span>
              </div>
            )}

            {/* Google Maps Iframe */}
            {isInViewport && (
              <iframe
                src={embedUrl}
                title={`Map showing the location of ${title}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
                onLoad={() => setIsIframeLoaded(true)}
                className={`w-full h-full border-0 transition-opacity duration-300 ${
                  isIframeLoaded ? "opacity-100" : "opacity-0"
                }`}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

