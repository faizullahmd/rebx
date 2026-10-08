"use client";

import { useState } from "react";
import Link from "next/link";
import type { Listing, ListingImage } from "@prisma/client";
import { AgentProfileHeader, type AgentProfileHeaderProps } from "@/components/portfolio/AgentProfileHeader";
import { getListingTag } from "@/lib/tags";
import { DashboardListingsTable } from "@/components/dashboard/DashboardListingsTable";

type ListingWithImages = Omit<Listing, "price"> & { price: number; images: ListingImage[] };

interface AgentPortfolioManagerProps {
  agentProfile: Omit<AgentProfileHeaderProps, "activeListingCount" | "mode">;
  initialListings: ListingWithImages[];
}

function isFeatured(listing: ListingWithImages): boolean {
  return getListingTag(listing.tags) === "featured";
}

function sortListings(items: ListingWithImages[]): ListingWithImages[] {
  return [...items].sort((a, b) => (isFeatured(a) ? 0 : 1) - (isFeatured(b) ? 0 : 1));
}

export function AgentPortfolioManager({
  agentProfile,
  initialListings,
}: AgentPortfolioManagerProps) {
  const [listings, setListings] = useState<ListingWithImages[]>(() =>
    sortListings(initialListings)
  );

  const activeListingCount = listings.filter(
    (l) => l.status === "ACTIVE" || l.status === "UNDER_OFFER"
  ).length;

  const handleTagChange = (listingId: number, nextTag: string | null) => {
    setListings((prev) => {
      const updated = prev.map((item) =>
        item.id === listingId
          ? { ...item, tags: nextTag ? [nextTag] : [] }
          : item
      );
      return sortListings(updated);
    });
  };

  return (
    <div className="flex flex-col gap-10">
      {/* SECTION 1: Agent profile header */}
      <section aria-label="Agent Profile Header">
        <AgentProfileHeader
          {...agentProfile}
          activeListingCount={activeListingCount}
          mode="dashboard"
        />
      </section>

      {/* SECTION 2: My listings table */}
      <section aria-labelledby="my-listings-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="my-listings-heading" className="text-xl font-bold text-neutral-900 sm:text-2xl">
            My listings
          </h2>
          <Link
            href="/agent/dashboard/listings/new"
            className="inline-flex items-center justify-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 w-full sm:w-auto"
          >
            + New listing
          </Link>
        </div>

        <DashboardListingsTable
          listings={listings}
          onTagChange={handleTagChange}
          emptyMessage="No listings yet"
        />
      </section>
    </div>
  );
}
