export const LISTING_TAG_OPTIONS = [
  { value: "new", label: "New" },
  { value: "featured", label: "Featured" },
  { value: "most_viewed", label: "Most Viewed" },
  { value: "few_units_left", label: "Few Units Left" },
  { value: "exclusive", label: "Exclusive" },
] as const;

export type ListingTag = (typeof LISTING_TAG_OPTIONS)[number]["value"];

export const LISTING_TAG_LABELS: Record<ListingTag, string> = {
  new: "New",
  featured: "Featured",
  most_viewed: "Most Viewed",
  few_units_left: "Few Units Left",
  exclusive: "Exclusive",
};

export function isValidListingTag(value: unknown): value is ListingTag {
  return typeof value === "string" && LISTING_TAG_OPTIONS.some((t) => t.value === value);
}

export function getListingTag(tags: unknown): ListingTag | null {
  if (!tags) return null;
  let raw: unknown = null;
  if (Array.isArray(tags)) {
    raw = tags.length > 0 ? tags[0] : null;
  } else if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed) && parsed.length > 0) {
        raw = parsed[0];
      } else {
        raw = tags;
      }
    } catch {
      raw = tags;
    }
  }
  return isValidListingTag(raw) ? raw : null;
}
