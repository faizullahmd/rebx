export interface PropertyLocation {
  latitude?: number | null;
  longitude?: number | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

/**
 * Checks whether valid coordinates exist (non-null, numeric, and not exactly 0,0).
 */
export function hasValidCoordinates(loc?: PropertyLocation | null): boolean {
  if (!loc) return false;
  const { latitude, longitude } = loc;
  if (latitude == null || longitude == null) return false;
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false;
  // Standard valid lat [-90, 90] and lng [-180, 180]
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  // Guard against default 0,0 dummy coordinates
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Formats a clean, human-readable address line from available components.
 */
export function formatDisplayAddress(loc?: PropertyLocation | null): string {
  if (!loc) return "";
  const parts = [loc.addressLine, loc.city, loc.state, loc.postalCode, loc.country]
    .map((s) => s?.trim())
    .filter(Boolean);
  return parts.join(", ");
}

/**
 * Generates a Google Maps destination query.
 * Prefers exact latitude,longitude if valid; otherwise formats and encodes address safely.
 */
function getDestinationQuery(loc?: PropertyLocation | null): string | null {
  if (!loc) return null;
  if (hasValidCoordinates(loc)) {
    return `${loc.latitude},${loc.longitude}`;
  }
  const address = formatDisplayAddress(loc);
  if (!address) return null;
  return address;
}

/**
 * Returns a Google Maps Search/View URL.
 * Example: https://www.google.com/maps/search/?api=1&query=...
 */
export function getGoogleMapsSearchUrl(loc?: PropertyLocation | null): string | null {
  const query = getDestinationQuery(loc);
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Returns a Google Maps Directions URL.
 * Example: https://www.google.com/maps/dir/?api=1&destination=...
 */
export function getGoogleMapsDirectionsUrl(loc?: PropertyLocation | null): string | null {
  const destination = getDestinationQuery(loc);
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
