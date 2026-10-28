import { describe, it, expect } from "vitest";
import {
  hasValidCoordinates,
  formatDisplayAddress,
  getGoogleMapsSearchUrl,
  getGoogleMapsDirectionsUrl,
} from "../maps";

describe("Google Maps Utilities", () => {
  it("detects valid coordinates properly", () => {
    expect(hasValidCoordinates({ latitude: 19.076, longitude: 72.8777 })).toBe(true);
    expect(hasValidCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
    expect(hasValidCoordinates({ latitude: null, longitude: 72.8777 })).toBe(false);
    expect(hasValidCoordinates({ latitude: 19.076, longitude: null })).toBe(false);
    expect(hasValidCoordinates(null)).toBe(false);
    expect(hasValidCoordinates({ latitude: 120, longitude: 50 })).toBe(false); // Lat > 90
  });

  it("formats display address nicely", () => {
    expect(
      formatDisplayAddress({
        addressLine: "Flat 402, Sunshine Towers",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      })
    ).toBe("Flat 402, Sunshine Towers, Mumbai, Maharashtra, 400001, India");

    expect(
      formatDisplayAddress({
        addressLine: "Bandra West",
        city: "Mumbai",
      })
    ).toBe("Bandra West, Mumbai");
  });

  it("prefers exact coordinates when valid", () => {
    const loc = {
      latitude: 19.076,
      longitude: 72.8777,
      addressLine: "Worli Sea Face",
      city: "Mumbai",
    };

    const searchUrl = getGoogleMapsSearchUrl(loc);
    expect(searchUrl).toBe("https://www.google.com/maps/search/?api=1&query=19.076%2C72.8777");

    const dirUrl = getGoogleMapsDirectionsUrl(loc);
    expect(dirUrl).toBe("https://www.google.com/maps/dir/?api=1&destination=19.076%2C72.8777");
  });

  it("falls back to encoded address when coordinates are missing", () => {
    const loc = {
      addressLine: "Plot 14, Sector 5",
      city: "Gurugram",
      state: "Haryana",
    };

    const searchUrl = getGoogleMapsSearchUrl(loc);
    expect(searchUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Plot%2014%2C%20Sector%205%2C%20Gurugram%2C%20Haryana"
    );

    const dirUrl = getGoogleMapsDirectionsUrl(loc);
    expect(dirUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Plot%2014%2C%20Sector%205%2C%20Gurugram%2C%20Haryana"
    );
  });

  it("returns null when no location data is provided", () => {
    expect(getGoogleMapsSearchUrl(null)).toBeNull();
    expect(getGoogleMapsDirectionsUrl({})).toBeNull();
  });
});
