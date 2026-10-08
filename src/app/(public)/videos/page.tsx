import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import type { PropertyType, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getVideoGalleryListings } from "@/lib/data/listings";
import { getVideoDetails, parseVideoUrl } from "@/lib/video";
import { VideoFilters } from "@/components/videos/VideoFilters";
import { VideoGalleryGrid } from "@/components/videos/VideoGalleryGrid";
import type { ListingWithVideo } from "@/components/videos/VideoCard";

export const metadata: Metadata = {
  title: "Property Videos | REBX",
  description:
    "Explore high-definition property video tours, drone walkthroughs, and virtual presentations for properties and developments across REBX.",
  openGraph: {
    title: "Property Videos | REBX",
    description:
      "Explore high-definition property video tours, drone walkthroughs, and virtual presentations for properties and developments across REBX.",
    url: "https://rebx.app/videos",
    siteName: "REBX",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Property Videos | REBX",
    description:
      "Explore high-definition property video tours, drone walkthroughs, and virtual presentations for properties and developments across REBX.",
  },
};

export const dynamic = "force-dynamic";

function paramString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === "string" ? value : undefined;
}

export default async function VideoGalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    const params = await searchParams;

    const search = paramString(params?.search);
    const propertyType = paramString(params?.propertyType) as PropertyType | undefined;
    const transactionType = paramString(params?.transactionType) as TransactionType | undefined;
    const sort = (paramString(params?.sort) || "newest") as "newest" | "price_asc" | "price_desc";
    const page = Math.max(1, Number(paramString(params?.page)) || 1);

    const playParam = paramString(params?.play);

    const { videos, totalCount, totalPages, currentPage } = await getVideoGalleryListings({
      search,
      propertyType,
      transactionType,
      sort,
      page,
      limit: 12,
    });

    if (playParam) {
      const trimmedPlay = playParam.trim();
      const alreadyIncluded = videos.some(
        (v) =>
          String(v.id) === trimmedPlay ||
          v.videoId === trimmedPlay ||
          v.listings?.[0]?.slug === trimmedPlay
      );

      if (!alreadyIncluded) {
        const found = await prisma.video.findFirst({
          where: {
            OR: [
              { id: Number(trimmedPlay) || -1 },
              { videoId: trimmedPlay },
              { url: { contains: trimmedPlay } },
              { listings: { some: { slug: trimmedPlay } } },
            ],
          },
          include: {
            listings: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { images: { take: 1 } },
            },
          },
        });
        if (found) {
          videos.unshift(found);
        }
      }
    }

    // Resolve thumbnail images (including server-side cached Vimeo oEmbed thumbnails)
    const resolvedListings: ListingWithVideo[] = await Promise.all(
      videos.map(async (v) => {
        let resolvedThumbnail = v.thumbnailUrl;
        if (!resolvedThumbnail && v.url) {
          try {
            const details = await getVideoDetails(v.url);
            if (details?.thumbnailUrl) {
              resolvedThumbnail = details.thumbnailUrl;
            }
          } catch {
            // Fallback
          }
        }

        const primaryListing = v.listings?.[0];

        return {
          id: v.id,
          title: v.title,
          url: v.url,
          provider: v.provider,
          videoId: v.videoId,
          thumbnailUrl: v.thumbnailUrl,
          resolvedThumbnail: resolvedThumbnail || undefined,
          createdAt: v.createdAt.toISOString(),
          listing: primaryListing
            ? {
                id: primaryListing.id,
                title: primaryListing.title,
                slug: primaryListing.slug,
                price: Number(primaryListing.price),
                city: primaryListing.city,
                state: primaryListing.state,
                country: primaryListing.country,
                bedrooms: primaryListing.bedrooms,
                bathrooms: primaryListing.bathrooms,
                areaSqFt: primaryListing.areaSqFt,
                transactionType: primaryListing.transactionType,
                propertyType: primaryListing.propertyType,
              }
            : null,
        };
      })
    );

    // Helper to build pagination links while preserving filters
    function getPageUrl(targetPage: number) {
      const q = new URLSearchParams();
      if (search) q.set("search", search);
      if (propertyType) q.set("propertyType", propertyType);
      if (transactionType) q.set("transactionType", transactionType);
      if (sort && sort !== "newest") q.set("sort", sort);
      if (targetPage > 1) q.set("page", String(targetPage));
      const qs = q.toString();
      return qs ? `/videos?${qs}` : "/videos";
    }

  return (
    <div className="flex flex-col gap-5">
      {/* Header section */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-900">
          <svg className="h-4 w-4 text-neutral-900" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
          </svg>
          REBX Property Tours
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
          Property Videos
        </h1>
        <p className="max-w-2xl text-xs sm:text-sm text-neutral-600">
          Immerse yourself in high-resolution video walkthroughs, drone flyovers, and virtual
          presentations of properties and development projects.
        </p>
      </div>

      {/* Filter controls */}
      <VideoFilters
        initialSearch={search}
        initialPropertyType={propertyType}
        initialTransactionType={transactionType}
        initialSort={sort}
      />

      {/* Gallery content or Empty state */}
      {resolvedListings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-16 px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-2xs border border-neutral-200 text-neutral-400">
            <svg className="h-8 w-8 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">
            No property videos yet.
          </h2>
          <p className="mt-1 max-w-sm text-sm text-neutral-500">
            {search || propertyType || transactionType
              ? "No videos matched your filter criteria. Try adjusting or clearing your filters."
              : "Check back soon as developers and verified builders upload immersive property walkthroughs."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {(search || propertyType || transactionType || sort !== "newest") && (
              <Link
                href="/videos"
                className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 transition"
              >
                Clear all filters
              </Link>
            )}
            <Link
              href="/listings"
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 shadow-2xs hover:bg-neutral-50 transition"
            >
              Browse all listings
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {/* Responsive 3-col Grid */}
          <Suspense fallback={<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" />}>
            <VideoGalleryGrid listings={resolvedListings} initialPlayId={playParam} />
          </Suspense>

          {/* Server-side Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-neutral-200 pt-6">
              <p className="text-xs sm:text-sm text-neutral-500">
                Showing <span className="font-semibold text-neutral-900">{resolvedListings.length}</span> of{" "}
                <span className="font-semibold text-neutral-900">{totalCount}</span> property videos
                (Page {currentPage} of {totalPages})
              </p>

              <div className="flex items-center gap-2">
                {currentPage > 1 ? (
                  <Link
                    href={getPageUrl(currentPage - 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-400 cursor-not-allowed">
                    ← Previous
                  </span>
                )}

                {/* Page numbers */}
                <div className="hidden sm:flex items-center gap-1">
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    const pageNum = idx + 1;
                    const isActive = pageNum === currentPage;
                    return (
                      <Link
                        key={pageNum}
                        href={getPageUrl(pageNum)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold transition ${
                          isActive
                            ? "bg-neutral-900 text-white"
                            : "border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50"
                        }`}
                      >
                        {pageNum}
                      </Link>
                    );
                  })}
                </div>

                {currentPage < totalPages ? (
                  <Link
                    href={getPageUrl(currentPage + 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition"
                  >
                    Next →
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-400 cursor-not-allowed">
                    Next →
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
  } catch (error) {
    console.error("VideoGalleryPage error:", error);
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-neutral-50/50 py-16 px-4 text-center">
        <h2 className="text-lg font-semibold text-neutral-900">Unable to load videos right now</h2>
        <p className="mt-1 text-sm text-neutral-500">Please refresh the page or browse our full listings catalog.</p>
        <Link
          href="/listings"
          className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-neutral-800 transition"
        >
          Browse listings
        </Link>
      </div>
    );
  }
}
