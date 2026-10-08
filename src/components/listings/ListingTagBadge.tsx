import { LISTING_TAG_LABELS, type ListingTag } from "@/lib/tags";

const BADGE_STYLES: Record<ListingTag, string> = {
  new: "bg-emerald-600 text-white",
  featured: "bg-amber-600 text-white",
  most_viewed: "bg-blue-600 text-white",
  few_units_left: "bg-rose-600 text-white",
  exclusive: "bg-indigo-600 text-white",
};

interface ListingTagBadgeProps {
  tag: string | null | undefined;
  className?: string;
}

export function ListingTagBadge({ tag, className = "" }: ListingTagBadgeProps) {
  if (!tag || !(tag in LISTING_TAG_LABELS)) return null;

  const validTag = tag as ListingTag;
  const label = LISTING_TAG_LABELS[validTag];
  const colorStyle = BADGE_STYLES[validTag] || "bg-neutral-800 text-white";

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide shadow-xs backdrop-blur-sm ${colorStyle} ${className}`}
    >
      {label}
    </span>
  );
}
