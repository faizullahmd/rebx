export const TAG_COLOR_KEYS = [
  "purple",
  "blue",
  "amber",
  "emerald",
  "indigo",
  "rose",
  "pink",
  "teal",
  "cyan",
  "gray",
] as const;

export type TagColorKey = (typeof TAG_COLOR_KEYS)[number];

export interface TagColorMeta {
  key: TagColorKey;
  label: string;
  swatchClass: string;
  softBadgeClass: string;
  solidBadgeClass: string;
}

export const TAG_COLORS: Record<TagColorKey, TagColorMeta> = {
  purple: {
    key: "purple",
    label: "Purple",
    swatchClass: "bg-purple-600",
    softBadgeClass: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100",
    solidBadgeClass: "bg-purple-600 text-white",
  },
  blue: {
    key: "blue",
    label: "Blue",
    swatchClass: "bg-blue-600",
    softBadgeClass: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100",
    solidBadgeClass: "bg-blue-600 text-white",
  },
  amber: {
    key: "amber",
    label: "Amber",
    swatchClass: "bg-amber-600",
    softBadgeClass: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    solidBadgeClass: "bg-amber-600 text-white",
  },
  emerald: {
    key: "emerald",
    label: "Green",
    swatchClass: "bg-emerald-600",
    softBadgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
    solidBadgeClass: "bg-emerald-600 text-white",
  },
  indigo: {
    key: "indigo",
    label: "Indigo",
    swatchClass: "bg-indigo-600",
    softBadgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100",
    solidBadgeClass: "bg-indigo-600 text-white",
  },
  rose: {
    key: "rose",
    label: "Red",
    swatchClass: "bg-rose-600",
    softBadgeClass: "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
    solidBadgeClass: "bg-rose-600 text-white",
  },
  pink: {
    key: "pink",
    label: "Pink",
    swatchClass: "bg-pink-600",
    softBadgeClass: "bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100",
    solidBadgeClass: "bg-pink-600 text-white",
  },
  teal: {
    key: "teal",
    label: "Teal",
    swatchClass: "bg-teal-600",
    softBadgeClass: "bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100",
    solidBadgeClass: "bg-teal-600 text-white",
  },
  cyan: {
    key: "cyan",
    label: "Cyan",
    swatchClass: "bg-cyan-600",
    softBadgeClass: "bg-cyan-50 text-cyan-700 border-cyan-200 hover:bg-cyan-100",
    solidBadgeClass: "bg-cyan-600 text-white",
  },
  gray: {
    key: "gray",
    label: "Gray",
    swatchClass: "bg-gray-600",
    softBadgeClass: "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200",
    solidBadgeClass: "bg-gray-700 text-white",
  },
};

export function isValidTagColor(color: unknown): color is TagColorKey {
  return typeof color === "string" && (TAG_COLOR_KEYS as readonly string[]).includes(color.toLowerCase());
}

export function getTagColorMeta(color?: string | null): TagColorMeta {
  if (!color) return TAG_COLORS.gray;
  const key = color.toLowerCase() as TagColorKey;
  return TAG_COLORS[key] || TAG_COLORS.gray;
}

export function getTagBadgeClass(color?: string | null, mode: "solid" | "soft" = "solid"): string {
  const meta = getTagColorMeta(color);
  return mode === "soft" ? meta.softBadgeClass : meta.solidBadgeClass;
}

export interface TagItem {
  id: number;
  name: string;
  color: string;
  isDefault: boolean;
  createdBy?: number | null;
  createdAt?: Date | string;
}

// ---------------------------------------------------------------------------
// Backward-compatibility support for legacy tag values (new, featured, etc.)
// ---------------------------------------------------------------------------
export const LISTING_TAG_OPTIONS = [
  { value: "new", label: "New", color: "emerald" },
  { value: "featured", label: "Featured", color: "purple" },
  { value: "most_viewed", label: "Most Viewed", color: "blue" },
  { value: "few_units_left", label: "Few Units Left", color: "amber" },
  { value: "exclusive", label: "Exclusive", color: "indigo" },
] as const;

export type ListingTag = (typeof LISTING_TAG_OPTIONS)[number]["value"];

export const LISTING_TAG_LABELS: Record<ListingTag, string> = {
  new: "New",
  featured: "Featured",
  most_viewed: "Most Viewed",
  few_units_left: "Few Units Left",
  exclusive: "Exclusive",
};

export const LEGACY_TAG_COLOR_MAP: Record<string, TagColorKey> = {
  new: "emerald",
  featured: "purple",
  most_viewed: "blue",
  few_units_left: "amber",
  exclusive: "indigo",
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
