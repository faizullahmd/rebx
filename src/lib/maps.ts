export interface PropertyLocation {
  latitude?: number | null;
  longitude?: number | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  title?: string | null;
}

/**
 * Checks whether valid coordinates exist (non-null, numeric, within bounds, and not 0,0).
 */
export function hasValidCoordinates(loc?: PropertyLocation | null): boolean {
  if (!loc) return false;
  const { latitude, longitude } = loc;
  if (latitude == null || longitude == null) return false;
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false;
  // Standard valid lat [-90, 90] and lng [-180, 180]
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  // Reject dummy 0,0 coordinates
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Formats a clean, human-readable address line from available components.
 */
export function formatDisplayAddress(loc?: PropertyLocation | null): string {
  if (!loc) return "";
  const parts = [loc.addressLine, loc.city, loc.state, loc.postalCode, loc.country]
    .map((s) => s?.trim().replace(/,\s*$/, ""))
    .filter(Boolean);
  return parts.join(", ");
}

/**
 * Formats the query string for Google Maps search/embed:
 * Combines project title (e.g. "My Home Avali") and address to ensure Google Maps
 * pins the exact named landmark/project entity rather than a nearby grid/plus code.
 */
export function formatSearchQuery(loc?: PropertyLocation | null): string {
  if (!loc) return "";
  const address = formatDisplayAddress(loc);
  const title = loc.title?.trim();

  if (title && address) {
    if (address.toLowerCase().includes(title.toLowerCase())) {
      return address;
    }
    return `${title}, ${address}`;
  }
  return title || address;
}

/**
 * Embed URL for Google Maps iframe:
 * - Coordinates + Address/Title: https://maps.google.com/maps?q=<encoded address/title>&ll=LAT,LNG&z=16&output=embed
 *   (Centers at the exact coordinates pin AND renders the Place Info Card with "Open in Maps")
 * - Coordinates only: https://maps.google.com/maps?q=LAT,LNG&z=16&output=embed
 * - Address fallback: https://maps.google.com/maps?q=<URL-encoded address>&z=15&output=embed
 * - Returns null if neither coordinates nor address are present.
 */
export function getGoogleMapsEmbedUrl(loc?: PropertyLocation | null): string | null {
  if (!loc) return null;
  const queryText = formatSearchQuery(loc);
  const hasCoords = hasValidCoordinates(loc);

  if (hasCoords && queryText) {
    return `https://maps.google.com/maps?q=${encodeURIComponent(queryText)}&ll=${loc.latitude},${loc.longitude}&z=16&output=embed`;
  }
  if (hasCoords) {
    return `https://maps.google.com/maps?q=${loc.latitude},${loc.longitude}&z=16&output=embed`;
  }
  if (queryText) {
    return `https://maps.google.com/maps?q=${encodeURIComponent(queryText)}&z=15&output=embed`;
  }
  return null;
}

/**
 * "View on Google Maps" URL:
 * Prefers the property name and address so Google Maps opens with the full place title
 * and card, falling back to coordinates if no address/title exists.
 */
export function getGoogleMapsSearchUrl(loc?: PropertyLocation | null): string | null {
  if (!loc) return null;
  const queryText = formatSearchQuery(loc);
  if (queryText) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText)}`;
  }
  if (hasValidCoordinates(loc)) {
    return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`;
  }
  return null;
}

/**
 * Google Maps Directions URL:
 * Prefers the property name and address so Google Maps opens with the full place title
 * and directions card (matching the in-embed directions button), falling back to coordinates if no address/title exists.
 */
export function getGoogleMapsDirectionsUrl(loc?: PropertyLocation | null): string | null {
  if (!loc) return null;
  const queryText = formatSearchQuery(loc);
  if (queryText) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(queryText)}`;
  }
  if (hasValidCoordinates(loc)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${loc.latitude},${loc.longitude}`;
  }
  return null;
}

/**
 * Validates coordinate pair ranges and disallows (0, 0).
 */
function validateCoordinates(
  lat: number,
  lng: number
): { latitude: number; longitude: number } | { error: string } {
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return { error: "Invalid coordinate numbers." };
  }
  if (lat === 0 && lng === 0) {
    return { error: "Coordinates (0, 0) are not allowed." };
  }
  if (lat < -90 || lat > 90) {
    return { error: "Latitude must be between -90 and 90." };
  }
  if (lng < -180 || lng > 180) {
    return { error: "Longitude must be between -180 and 180." };
  }
  return { latitude: lat, longitude: lng };
}

/**
 * Checks whether an input string contains a Google Maps short link (maps.app.goo.gl or goo.gl/maps).
 */
export function isGoogleMapsShortLink(input: string): boolean {
  if (!input || typeof input !== "string") return false;
  return (
    /maps\.app\.goo\.gl\/[a-zA-Z0-9_-]+/i.test(input) ||
    /goo\.gl\/maps\/[a-zA-Z0-9_-]+/i.test(input)
  );
}

/**
 * Extracts a single clean Google Maps short link from user input (handles concatenated or surrounded text).
 */
export function extractGoogleMapsShortLink(input: string): string | null {
  if (!input || typeof input !== "string") return null;

  const matchWithProto =
    input.match(/(https?:\/\/maps\.app\.goo\.gl\/[a-zA-Z0-9_-]+?)(?=(?:https?:\/\/|[/?#\s]|$))/i) ||
    input.match(/(https?:\/\/goo\.gl\/maps\/[a-zA-Z0-9_-]+?)(?=(?:https?:\/\/|[/?#\s]|$))/i);
  if (matchWithProto) {
    return matchWithProto[1];
  }

  const matchWithoutProto =
    input.match(/(maps\.app\.goo\.gl\/[a-zA-Z0-9_-]+?)(?=(?:https?:\/\/|[/?#\s]|$))/i) ||
    input.match(/(goo\.gl\/maps\/[a-zA-Z0-9_-]+?)(?=(?:https?:\/\/|[/?#\s]|$))/i);
  if (matchWithoutProto) {
    return `https://${matchWithoutProto[1]}`;
  }

  return null;
}

/**
 * Extracts coordinates from agent input:
 * 1. Plain coordinates: "17.3850, 78.4867" (comma or space separated, optional parenthesis)
 * 2. Full Google Maps URLs, in priority order:
 *    - "!3d<lat>!4d<lng>" (exact place pin)
 *    - "@<lat>,<lng>,<zoom>z" (map center)
 *    - "?q=<lat>,<lng>" or "query=<lat>,<lng>" or "ll=<lat>,<lng>"
 *
 * Short links (maps.app.goo.gl, goo.gl) must be followed by server resolution first.
 */
export function parseLocationInput(
  input: string
): { latitude: number; longitude: number } | { error: string } {
  if (!input || typeof input !== "string" || !input.trim()) {
    return { error: "Please enter a location." };
  }

  let text = input.trim().replace(/^["'`]|["'`]$/g, "").trim();

  // 1. Check for plain coordinates first if input starts with a number or +/-
  const plainCoordsRegex = /^\s*\(?\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*\)?\s*$/;
  const plainMatch = text.match(plainCoordsRegex);
  if (plainMatch) {
    const lat = parseFloat(plainMatch[1]);
    const lng = parseFloat(plainMatch[2]);
    return validateCoordinates(lat, lng);
  }

  // If it's a short link, indicate it needs server resolution
  if (isGoogleMapsShortLink(text)) {
    return { error: "Short links must be resolved on the server." };
  }

  // Attempt URL decoding in case query or data parameters are encoded
  let decodedText = text;
  try {
    decodedText = decodeURIComponent(text);
  } catch {
    // Keep raw text if decoding fails
  }

  // Priority b.1: Exact place pin "!3d<lat>!4d<lng>"
  const pinMatch = decodedText.match(/!3d([+-]?\d+(?:\.\d+)?)[^!]*!4d([+-]?\d+(?:\.\d+)?)/);
  if (pinMatch) {
    const lat = parseFloat(pinMatch[1]);
    const lng = parseFloat(pinMatch[2]);
    return validateCoordinates(lat, lng);
  }

  // Priority b.2: Map center "@<lat>,<lng>"
  const centerMatch = decodedText.match(/@([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/);
  if (centerMatch) {
    const lat = parseFloat(centerMatch[1]);
    const lng = parseFloat(centerMatch[2]);
    return validateCoordinates(lat, lng);
  }

  // Priority b.3: ?q=<lat>,<lng> or query=<lat>,<lng> or ll=<lat>,<lng>
  const queryMatch = decodedText.match(
    /[?&](?:q|query|ll)=([+-]?\d+(?:\.\d+)?)(?:%2C|,|\+|\s)+([+-]?\d+(?:\.\d+)?)/i
  );
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    return validateCoordinates(lat, lng);
  }

  // Check if text contains standalone coordinates surrounded by other words
  const looseCoordsMatch = decodedText.match(
    /(?:^|\s|\(|\[)([+-]?\d{1,2}(?:\.\d+)?)[,\s]+([+-]?(?:1[0-7]\d|\d{1,2})(?:\.\d+)?)(?:$|\s|\)|\])/
  );
  if (looseCoordsMatch) {
    const lat = parseFloat(looseCoordsMatch[1]);
    const lng = parseFloat(looseCoordsMatch[2]);
    return validateCoordinates(lat, lng);
  }

  return {
    error: "We couldn't read this link. Paste a Google Maps link or coordinates (latitude, longitude).",
  };
}
