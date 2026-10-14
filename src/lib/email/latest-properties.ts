import "server-only";
import { prisma } from "@/lib/prisma";
import { formatListingPrice } from "@/lib/price";
import { latestListingsBlockHtml, propertyCardsHtml, type PropertyCard } from "@/lib/email/blocks";

const CANONICAL_SITE = "https://rebx.app";

/**
 * The site address to link to. Emails other than Welcome are not handed one, so it is taken from
 * any link they already carry (which follows the host the app is running on), else the live site.
 */
export function siteBaseFrom(values: Record<string, unknown>): string {
  for (const value of Object.values(values)) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) continue;
    try {
      return new URL(value).origin;
    } catch {
      /* try the next value */
    }
  }
  return CANONICAL_SITE;
}

const PLACEHOLDER_IMAGE_PATH = "/images/property-placeholder.jpg";

async function loadLatestCards(siteUrl: string, limit: number): Promise<PropertyCard[]> {
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

  return listings.map((l) => {
    const image = l.images[0]?.url;
    return {
      title: l.title,
      location: [l.city, l.state].filter(Boolean).join(", "),
      price: formatListingPrice(l.price, l.currency, l.priceDisplay, l.priceOnRequest),
      url: `${siteUrl}/listings/${encodeURIComponent(l.slug)}`,
      imageUrl: image && /^https:\/\//i.test(image) ? image : `${siteUrl}${PLACEHOLDER_IMAGE_PATH}`,
    };
  });
}

/**
 * Cards for the newest ACTIVE listings ({{latestProperties}}). Never throws: if the lookup
 * fails the email is simply sent without the block.
 */
export async function getLatestPropertiesHtml(siteUrl: string, limit = 3): Promise<string> {
  try {
    return propertyCardsHtml(await loadLatestCards(siteUrl, limit));
  } catch (error) {
    console.error("Could not load latest properties for email:", error);
    return "";
  }
}

/**
 * The full {{latestListings}} section: heading, newest ACTIVE listings and a Browse button.
 * Empty when there are no listings or the lookup fails; never throws.
 */
export async function getLatestListingsBlockHtml(siteUrl: string, limit = 3): Promise<string> {
  try {
    return latestListingsBlockHtml(await loadLatestCards(siteUrl, limit), `${siteUrl}/listings`);
  } catch (error) {
    console.error("Could not load latest listings block for email:", error);
    return "";
  }
}
