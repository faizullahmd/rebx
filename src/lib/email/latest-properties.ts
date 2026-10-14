import "server-only";
import { prisma } from "@/lib/prisma";
import { formatListingPrice } from "@/lib/price";
import { propertyCardsHtml, type PropertyCard } from "@/lib/email/blocks";

const PLACEHOLDER_IMAGE_PATH = "/images/property-placeholder.jpg";

/**
 * Cards for the newest ACTIVE listings, for emails that show "latest properties". It never
 * throws: if the lookup fails the email is simply sent without the block.
 */
export async function getLatestPropertiesHtml(siteUrl: string, limit = 3): Promise<string> {
  try {
    const listings = await prisma.listing.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        slug: true,
        title: true,
        city: true,
        state: true,
        price: true,
        currency: true,
        priceDisplay: true,
        priceOnRequest: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      },
    });

    const cards: PropertyCard[] = listings.map((l) => {
      const image = l.images[0]?.url;
      return {
        title: l.title,
        location: [l.city, l.state].filter(Boolean).join(", "),
        price: formatListingPrice(l.price, l.currency, l.priceDisplay, l.priceOnRequest),
        url: `${siteUrl}/listings/${encodeURIComponent(l.slug)}`,
        imageUrl: image && /^https:\/\//i.test(image) ? image : `${siteUrl}${PLACEHOLDER_IMAGE_PATH}`,
      };
    });
    return propertyCardsHtml(cards);
  } catch (error) {
    console.error("Could not load latest properties for email:", error);
    return "";
  }
}
