import "server-only";
import { prisma } from "@/lib/prisma";
import { formatListingPrice } from "@/lib/price";
import {
  PROPERTY_TYPE_LABELS,
  CATEGORY_LABELS,
  FACING_LABELS,
  FURNISHING_LABELS,
  AVAILABILITY_LABELS,
} from "@/lib/property-taxonomy";

export interface ShortlistItem {
  id: number;
  listingId: number;
  createdAt: string;
  name: string;
  slug: string;
  type: string;
  price: number | null;
  currency: string;
  priceDisplay: string | null;
  priceOnRequest: boolean;
  formattedPrice: string;
  beds: number | null;
  baths: number | null;
  sqFt: number | null;
  pricePerSqFt: number | null;
  facing: string | null;
  furnishing: string | null;
  availability: string | null;
  parking: number | null;
  reraId: string | null;
  projectUnits: number | null;
  projectArea: number | null;
  possessionStarts: string | null;
  notes: string | null;
  location: string;
  city: string;
  coverImage: string;
  status: "Available" | "Unavailable";
  rawStatus: string;
  agent: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
  } | null;
}

export async function getShortlistForCustomer(
  customerId: number
): Promise<ShortlistItem[]> {
  try {

    const items = await prisma.shortlist.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        listing: {
          include: {
            images: {
              orderBy: { sortOrder: "asc" },
              take: 1,
            },
            agent: {
              select: {
                id: true,
                name: true,
                email: true,
                agentProfile: {
                  select: { phone: true },
                },
              },
            },
          },
        },
      },
    });

    return items.map((item) => {
      // A listing that is (or went back to) a draft must not expose its details to the customer.
      const listing = item.listing.status === "DRAFT" ? null : item.listing;
      const isAvailable = listing && listing.status === "ACTIVE";

      const numPrice = listing?.price ? Number(listing.price) : null;
      const numSqFt = listing?.areaSqFt ?? null;
      const pricePerSqFt =
        numPrice && numSqFt && numSqFt > 0
          ? Math.round(numPrice / numSqFt)
          : null;

      return {
        id: item.id,
        listingId: item.listingId,
        createdAt: item.createdAt.toISOString(),
        name: listing?.title || "Property unavailable",
        slug: listing?.slug || "",
        type: listing?.propertyType
          ? PROPERTY_TYPE_LABELS[listing.propertyType] || listing.propertyType
          : listing?.propertyCategory
            ? CATEGORY_LABELS[listing.propertyCategory] || listing.propertyCategory
            : "Property",
        price: numPrice,
        currency: listing?.currency || "INR",
        priceDisplay: listing?.priceDisplay || null,
        priceOnRequest: listing?.priceOnRequest || false,
        formattedPrice: listing
          ? formatListingPrice(
              listing.price,
              listing.currency,
              listing.priceDisplay,
              listing.priceOnRequest
            )
          : "Price unavailable",
        beds: listing?.bedrooms ?? null,
        baths: listing?.bathrooms ?? null,
        sqFt: numSqFt,
        pricePerSqFt,
        facing: listing?.facing
          ? FACING_LABELS[listing.facing] || String(listing.facing)
          : null,
        furnishing: listing?.furnishing
          ? FURNISHING_LABELS[listing.furnishing] || String(listing.furnishing)
          : null,
        availability: listing?.availability
          ? AVAILABILITY_LABELS[listing.availability] || String(listing.availability)
          : null,
        parking: listing?.parkingSpots ?? null,
        reraId: listing?.reraId || null,
        projectUnits: listing?.projectUnits ?? null,
        projectArea: listing?.projectArea != null ? Number(listing.projectArea) : null,
        possessionStarts: listing?.possessionStarts || null,
        notes: item.notes || null,
        location: listing
          ? [listing.addressLine, listing.city, listing.state]
              .filter(Boolean)
              .join(", ")
          : "Location unavailable",
        city: listing?.city || "",
        coverImage:
          listing?.images?.[0]?.url || "/images/property-placeholder.jpg",
        status: isAvailable ? ("Available" as const) : ("Unavailable" as const),
        rawStatus: listing?.status || "DRAFT",
        agent: listing?.agent
          ? {
              id: listing.agent.id,
              name: listing.agent.name,
              email: listing.agent.email,
              phone: listing.agent.agentProfile?.phone || null,
            }
          : null,
      };
    });
  } catch (error) {
    console.error("getShortlistForCustomer error:", error);
    return [];
  }
}

