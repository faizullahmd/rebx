import { formatListingPrice } from "@/lib/price";
import { getGoogleMapsSearchUrl } from "@/lib/maps";
import { PROPERTY_TYPE_LABELS, FACING_LABELS } from "@/lib/property-taxonomy";
import type { FacingDirection, PropertyType } from "@prisma/client";

export interface PitchListingData {
  id: number;
  slug: string;
  title: string;
  propertyType?: PropertyType | string | null;
  bedrooms?: number | null;
  areaSqFt?: number | null;
  facing?: FacingDirection | string | null;
  price?: number | string | { toString(): string } | null;
  priceDisplay?: string | null;
  priceOnRequest?: boolean | null;
  currency?: string | null;
  projectUnits?: number | null;
  projectArea?: number | null;
  reraId?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  images?: Array<{ url: string }> | null;
}

export interface PitchAgentData {
  name?: string | null;
  phone?: string | null;
}

export interface PitchToggles {
  price?: boolean;
  area?: boolean;
  facing?: boolean;
  projectDetails?: boolean;
  rera?: boolean;
  mapLink?: boolean;
  phone?: boolean;
}

/**
 * Builds an absolute listing URL with tracked UTM parameters:
 * ?utm_source=whatsapp&utm_medium=agent_share
 */
export function buildListingShareUrl(baseUrl: string, slug: string): string {
  const cleanBase = (baseUrl || "https://rebx.app").replace(/\/+$/, "");
  const url = new URL(`${cleanBase}/listings/${encodeURIComponent(slug)}`);
  url.searchParams.set("utm_source", "whatsapp");
  url.searchParams.set("utm_medium", "agent_share");
  return url.toString();
}

/**
 * Pure helper function to generate the WhatsApp pitch text.
 * Strictly adheres to:
 * - One line per item with emojis and *bold* title
 * - Only includes fields the listing actually has
 * - Skips empty or missing lines
 * - Drops lowest-priority lines if exceeding 1500 chars
 */
export function buildWhatsAppPitch({
  listing,
  agent,
  baseUrl,
  toggles = {},
}: {
  listing: PitchListingData;
  agent?: PitchAgentData | null;
  baseUrl: string;
  toggles?: PitchToggles;
}): string {
  const activeToggles: Required<PitchToggles> = {
    price: toggles.price ?? true,
    area: toggles.area ?? true,
    facing: toggles.facing ?? true,
    projectDetails: toggles.projectDetails ?? true,
    rera: toggles.rera ?? true,
    mapLink: toggles.mapLink ?? true,
    phone: toggles.phone ?? true,
  };

  // Line 1: 🏠 *{title} | {bedrooms} BHK {property type}*
  const typeLabel = listing.propertyType
    ? PROPERTY_TYPE_LABELS[listing.propertyType as PropertyType] || String(listing.propertyType)
    : "";
  const bedLabel = listing.bedrooms && listing.bedrooms > 0 ? `${listing.bedrooms} BHK` : "";
  const subParts = [bedLabel, typeLabel].filter(Boolean);
  const headerDetail = subParts.length > 0 ? ` | ${subParts.join(" ")}` : "";
  const titleLine = `🏠 *${listing.title.trim()}${headerDetail}*`;

  // Line 2: 📍 {locality}, {city}
  const locality = listing.addressLine?.trim().replace(/,\s*$/, "");
  const city = listing.city?.trim().replace(/,\s*$/, "");
  let locationLine: string | null = null;
  if (locality && city) {
    if (locality.toLowerCase().includes(city.toLowerCase())) {
      locationLine = `📍 ${locality}`;
    } else {
      locationLine = `📍 ${locality}, ${city}`;
    }
  } else if (locality) {
    locationLine = `📍 ${locality}`;
  } else if (city) {
    locationLine = `📍 ${city}`;
  }

  // Line 3: 📐 {area} sq.ft | {facing} Facing
  const areaParts: string[] = [];
  if (activeToggles.area && listing.areaSqFt && listing.areaSqFt > 0) {
    areaParts.push(`${listing.areaSqFt.toLocaleString("en-IN")} sq.ft`);
  }
  if (activeToggles.facing && listing.facing) {
    const facingLabel =
      FACING_LABELS[listing.facing as FacingDirection] || String(listing.facing);
    areaParts.push(`${facingLabel} Facing`);
  }
  const specLine = areaParts.length > 0 ? `📐 ${areaParts.join(" | ")}` : null;

  // Line 4: 💰 {price}
  let priceLine: string | null = null;
  if (activeToggles.price) {
    const priceText = formatListingPrice(
      listing.price,
      listing.currency || "INR",
      listing.priceDisplay,
      listing.priceOnRequest
    );
    if (priceText) {
      priceLine = `💰 ${priceText}`;
    }
  }

  // Line 5: 🏗 {project units} units | {project area} acres
  let projectLine: string | null = null;
  if (activeToggles.projectDetails) {
    const isApartmentOrVilla =
      !listing.propertyType ||
      listing.propertyType === "APARTMENT" ||
      listing.propertyType === "VILLA" ||
      listing.propertyType === "PENTHOUSE" ||
      listing.propertyType === "BUILDER_FLOOR";

    const projParts: string[] = [];
    if (isApartmentOrVilla && listing.projectUnits && listing.projectUnits > 0) {
      projParts.push(`${listing.projectUnits} units`);
    }
    if (listing.projectArea && listing.projectArea > 0) {
      projParts.push(`${listing.projectArea} acres`);
    }
    if (projParts.length > 0) {
      projectLine = `🏗 ${projParts.join(" | ")}`;
    }
  }

  // Line 6: ✅ RERA: {rera id}
  let reraLine: string | null = null;
  if (activeToggles.rera && listing.reraId && listing.reraId.trim()) {
    reraLine = `✅ RERA: ${listing.reraId.trim()}`;
  }

  // Line 7: 👉 Full details & photos: {listing url}
  // Placed FIRST before map link so WhatsApp generates the preview card for REBX!
  const listingUrl = buildListingShareUrl(baseUrl, listing.slug);
  const urlLine = `👉 Full details & photos: ${listingUrl}`;

  // Line 8: 🗺 Location: {map link}
  let mapLine: string | null = null;
  if (activeToggles.mapLink) {
    const searchUrl = getGoogleMapsSearchUrl({
      title: listing.title,
      latitude: listing.latitude,
      longitude: listing.longitude,
      addressLine: listing.addressLine,
      city: listing.city,
      state: listing.state,
      country: listing.country,
      postalCode: listing.postalCode,
    });
    if (searchUrl) {
      mapLine = `🗺 Location: ${searchUrl}`;
    }
  }

  // Line 9: 📞 {agent name}: {agent phone}
  let agentLine: string | null = null;
  if (activeToggles.phone && agent?.phone && agent.phone.trim()) {
    const name = agent.name?.trim() || "Agent";
    agentLine = `📞 ${name}: ${agent.phone.trim()}`;
  }

  // Assemble into clean readable sections with single blank line separation
  const assemblePitch = (
    proj: string | null,
    spec: string | null,
    rera: string | null,
    map: string | null
  ): string => {
    const s1 = [titleLine, locationLine].filter(Boolean);
    const s2 = [spec, priceLine, proj, rera].filter(Boolean);
    const s3 = [urlLine, map].filter(Boolean);
    const s4 = [agentLine].filter(Boolean);
    return [s1, s2, s3, s4]
      .filter((s) => s.length > 0)
      .map((s) => s.join("\n"))
      .join("\n\n");
  };

  const MAX_CHARS = 1500;
  let curProj = projectLine;
  let curSpec = specLine;
  let curRera = reraLine;
  let curMap = mapLine;

  let finalPitch = assemblePitch(curProj, curSpec, curRera, curMap);

  if (finalPitch.length > MAX_CHARS && curProj) {
    curProj = null;
    finalPitch = assemblePitch(curProj, curSpec, curRera, curMap);
  }

  if (finalPitch.length > MAX_CHARS && curSpec) {
    curSpec = null;
    finalPitch = assemblePitch(curProj, curSpec, curRera, curMap);
  }

  if (finalPitch.length > MAX_CHARS && curRera) {
    curRera = null;
    finalPitch = assemblePitch(curProj, curSpec, curRera, curMap);
  }

  if (finalPitch.length > MAX_CHARS && curMap) {
    curMap = null;
    finalPitch = assemblePitch(curProj, curSpec, curRera, curMap);
  }

  if (finalPitch.length > MAX_CHARS) {
    finalPitch = finalPitch.slice(0, MAX_CHARS - 3).trimEnd() + "...";
  }

  return finalPitch;
}
