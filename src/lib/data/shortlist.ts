import "server-only";
import { prisma } from "@/lib/prisma";
import { formatListingPrice } from "@/lib/price";
import { PROPERTY_TYPE_LABELS, CATEGORY_LABELS } from "@/lib/property-taxonomy";

export interface ShortlistItem {
  id: number;
  listingId: number;
  createdAt: string;
  name: string;
  slug: string;
  type: string;
  price: number | null;
  currency: string;
  formattedPrice: string;
  beds: number | null;
  sqFt: number | null;
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
    const db = (prisma as any).shortlist
      ? prisma
      : new (await import("@prisma/client")).PrismaClient();

    const items = await db.shortlist.findMany({
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
      const listing = item.listing;
      const isAvailable = listing && listing.status === "ACTIVE";

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
        price: listing?.price ? Number(listing.price) : null,
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
        sqFt: listing?.areaSqFt ?? null,
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

