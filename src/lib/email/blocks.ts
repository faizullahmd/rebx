// Server-built HTML blocks that templates can drop in through an "html" variable. Everything
// dynamic is escaped here, and the pipeline sanitizes the block again before it is rendered.
import { escapeHtml } from "@/lib/email/escape";

export interface PropertyCard {
  title: string;
  location: string;
  price: string;
  url: string;
  imageUrl: string;
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";

/** One property as a compact, email-safe card: photo on the left, details on the right. */
export function propertyCardHtml(card: PropertyCard) {
  const url = escapeHtml(card.url);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;border:1px solid #e4e4e7;border-radius:10px;border-collapse:separate;"><tbody><tr>` +
    `<td width="130" valign="top" style="width:130px;padding:0;"><a href="${url}" style="text-decoration:none;"><img src="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(card.title)}" width="130" style="width:130px;height:auto;display:block;border-radius:10px 0 0 10px;"></a></td>` +
    `<td valign="top" style="padding:12px 14px;${FONT}">` +
    `<a href="${url}" style="font-size:16px;line-height:22px;font-weight:bold;color:#18181b;text-decoration:none;">${escapeHtml(card.title)}</a>` +
    `<p style="margin:3px 0 0 0;font-size:13px;line-height:18px;color:#52525b;">${escapeHtml(card.location)}</p>` +
    `<p style="margin:6px 0 8px 0;font-size:15px;line-height:20px;font-weight:bold;color:#16a34a;">${escapeHtml(card.price)}</p>` +
    `<a href="${url}" style="font-size:13px;line-height:18px;font-weight:bold;color:#111827;text-decoration:underline;">View property</a>` +
    `</td></tr></tbody></table>`
  );
}

export function propertyCardsHtml(cards: PropertyCard[]) {
  return cards.map(propertyCardHtml).join("");
}

/** Static example cards used by previews and test emails (links point at example.com). */
export const SAMPLE_PROPERTY_CARDS: PropertyCard[] = [
  { title: "Lakeside Family Home", location: "Austin, TX", price: "$689,000", url: "https://example.com/sample/listings/lakeside-family-home", imageUrl: "https://rebx.app/images/property-placeholder.jpg" },
  { title: "Downtown 2BR Condo", location: "Austin, TX", price: "$425,000", url: "https://example.com/sample/listings/downtown-2br-condo", imageUrl: "https://rebx.app/images/property-placeholder.jpg" },
  { title: "Subishi Towers", location: "Tirupati, Andhra Pradesh", price: "₹ 2 Cr", url: "https://example.com/sample/listings/subishi-towers", imageUrl: "https://rebx.app/images/property-placeholder.jpg" },
];
