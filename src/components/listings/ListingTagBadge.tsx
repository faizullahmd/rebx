import {
  LISTING_TAG_LABELS,
  LEGACY_TAG_COLOR_MAP,
  getTagBadgeClass,
  type ListingTag,
} from "@/lib/tags";

export interface TagDisplayInput {
  name: string;
  color: string;
}

interface ListingTagBadgeProps {
  tag: string | TagDisplayInput | null | undefined;
  className?: string;
  mode?: "solid" | "soft";
}

export function ListingTagBadge({ tag, className = "", mode = "solid" }: ListingTagBadgeProps) {
  if (!tag) return null;

  let label = "";
  let colorKey = "gray";

  if (typeof tag === "object") {
    label = tag.name;
    colorKey = tag.color;
  } else if (typeof tag === "string") {
    const lower = tag.toLowerCase().trim();
    if (lower in LISTING_TAG_LABELS) {
      label = LISTING_TAG_LABELS[lower as ListingTag];
      colorKey = LEGACY_TAG_COLOR_MAP[lower] || "gray";
    } else {
      label = tag;
      colorKey = "gray";
    }
  }

  if (!label) return null;

  const colorStyle = getTagBadgeClass(colorKey, mode);

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide shadow-2xs backdrop-blur-sm border ${colorStyle} ${className}`}
    >
      {label}
    </span>
  );
}
