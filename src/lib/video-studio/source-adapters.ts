import "server-only";
import { prisma } from "./deps";
import { formatListingPrice } from "@/lib/price";

import {
  REBX_CONTENT_IDEAS,
  type ContentIdea,
  type SourceHit,
} from "./schemas";

export { REBX_CONTENT_IDEAS, type ContentIdea, type SourceHit };

/**
 * Searches REBX listings.
 */
export async function searchSources(type: string, q: string): Promise<SourceHit[]> {
  if (type === "LISTING") {
    const term = q.trim();
    const where = term
      ? {
          OR: [
            { title: { contains: term } },
            { city: { contains: term } },
            { addressLine: { contains: term } },
          ],
        }
      : {};

    const rows = await prisma.listing.findMany({
      where,
      select: {
        id: true,
        title: true,
        city: true,
        addressLine: true,
      },
      take: 15,
      orderBy: { updatedAt: "desc" },
    });

    return rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      subtitle: [r.addressLine, r.city].filter(Boolean).join(", "),
    }));
  }

  return [];
}

/**
 * Extracts factual summary for a selected listing.
 */
export async function getSourceSummary(type: string, id: string): Promise<{ title: string; summary: string }> {
  if (type === "LISTING") {
    const numericId = Number(id);
    if (isNaN(numericId)) return { title: "", summary: "" };

    const listing = await prisma.listing.findUnique({
      where: { id: numericId },
      include: { tag: true },
    });

    if (!listing) return { title: "", summary: "" };

    const lines: string[] = [];
    lines.push(`Title: ${listing.title}`);

    const locationParts = [listing.addressLine, listing.city, listing.state, listing.country].filter(Boolean);
    if (locationParts.length) {
      lines.push(`Location: ${locationParts.join(", ")}`);
    }

    const priceFormatted = formatListingPrice(
      listing.price,
      listing.currency || "INR",
      listing.priceDisplay,
      listing.priceOnRequest,
    );
    lines.push(`Price: ${priceFormatted}`);

    if (listing.transactionType) {
      lines.push(`Transaction: ${listing.transactionType.replace(/_/g, " ")}`);
    }

    if (listing.propertyType || listing.propertyCategory) {
      const typeStr = [listing.propertyCategory, listing.propertyType].filter(Boolean).join(" - ").replace(/_/g, " ");
      lines.push(`Property Type: ${typeStr}`);
    }

    if (listing.bedrooms != null) lines.push(`Bedrooms: ${listing.bedrooms} BHK`);
    if (listing.bathrooms != null) lines.push(`Bathrooms: ${listing.bathrooms}`);
    if (listing.areaSqFt != null) lines.push(`Area: ${listing.areaSqFt} sq ft`);
    if (listing.furnishing) lines.push(`Furnishing: ${listing.furnishing.replace(/_/g, " ")}`);
    if (listing.facing) lines.push(`Facing: ${listing.facing.replace(/_/g, " ")}`);
    if (listing.availability) lines.push(`Availability: ${listing.availability.replace(/_/g, " ")}`);
    if (listing.reraId) lines.push(`RERA ID: ${listing.reraId}`);

    if (listing.description?.trim()) {
      lines.push(`\nDescription:\n${listing.description.trim()}`);
    }

    return {
      title: listing.title,
      summary: lines.join("\n"),
    };
  }

  return { title: "", summary: "" };
}

