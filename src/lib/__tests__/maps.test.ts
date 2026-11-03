import { describe, it, expect } from "vitest";
import {
  hasValidCoordinates,
  formatDisplayAddress,
  getGoogleMapsEmbedUrl,
  getGoogleMapsSearchUrl,
  getGoogleMapsDirectionsUrl,
  parseLocationInput,
  isGoogleMapsShortLink,
  extractGoogleMapsShortLink,
} from "../maps";

describe("Google Maps Embed and Search URL Helpers", () => {
  it("detects valid coordinates properly", () => {
    expect(hasValidCoordinates({ latitude: 19.076, longitude: 72.8777 })).toBe(true);
    expect(hasValidCoordinates({ latitude: 0, longitude: 0 })).toBe(false);
    expect(hasValidCoordinates({ latitude: null, longitude: 72.8777 })).toBe(false);
    expect(hasValidCoordinates({ latitude: 19.076, longitude: null })).toBe(false);
    expect(hasValidCoordinates(null)).toBe(false);
    expect(hasValidCoordinates({ latitude: 120, longitude: 50 })).toBe(false); // Lat > 90
    expect(hasValidCoordinates({ latitude: 50, longitude: 200 })).toBe(false); // Lng > 180
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

  it("builds embed URL with coordinates when available", () => {
    const embedUrl = getGoogleMapsEmbedUrl({
      latitude: 17.385,
      longitude: 78.4867,
    });
    expect(embedUrl).toBe("https://maps.google.com/maps?q=17.385,78.4867&z=16&output=embed");
  });

  it("builds embed URL with address and coordinates to show place card centered on pin", () => {
    const embedUrl = getGoogleMapsEmbedUrl({
      latitude: 17.385,
      longitude: 78.4867,
      addressLine: "Charminar",
      city: "Hyderabad",
    });
    expect(embedUrl).toBe(
      "https://maps.google.com/maps?q=Charminar%2C%20Hyderabad&ll=17.385,78.4867&z=16&output=embed"
    );
  });

  it("includes property title in embed URL query to pin named landmarks/projects accurately", () => {
    const embedUrl = getGoogleMapsEmbedUrl({
      title: "My Home Avali",
      latitude: 17.4612,
      longitude: 78.2934,
      addressLine: "Tellapur",
      city: "Hyderabad",
    });
    expect(embedUrl).toBe(
      "https://maps.google.com/maps?q=My%20Home%20Avali%2C%20Tellapur%2C%20Hyderabad&ll=17.4612,78.2934&z=16&output=embed"
    );
  });

  it("falls back to encoded full address in embed URL when coordinates are missing", () => {
    const embedUrl = getGoogleMapsEmbedUrl({
      addressLine: "Banjara Hills Road No 12",
      city: "Hyderabad",
      state: "Telangana",
      postalCode: "500034",
      country: "India",
    });
    expect(embedUrl).toBe(
      "https://maps.google.com/maps?q=Banjara%20Hills%20Road%20No%2012%2C%20Hyderabad%2C%20Telangana%2C%20500034%2C%20India&z=15&output=embed"
    );
  });

  it("returns null for embed URL when neither coordinates nor address exist", () => {
    expect(getGoogleMapsEmbedUrl(null)).toBeNull();
    expect(getGoogleMapsEmbedUrl({})).toBeNull();
    expect(getGoogleMapsEmbedUrl({ addressLine: "   " })).toBeNull();
  });

  it("prefers property name and address for directions and search links", () => {
    const loc = {
      title: "Amity Villas",
      latitude: 19.076,
      longitude: 72.8777,
      addressLine: "Worli Sea Face",
      city: "Mumbai",
    };

    const searchUrl = getGoogleMapsSearchUrl(loc);
    expect(searchUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Amity%20Villas%2C%20Worli%20Sea%20Face%2C%20Mumbai"
    );

    const dirUrl = getGoogleMapsDirectionsUrl(loc);
    expect(dirUrl).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Amity%20Villas%2C%20Worli%20Sea%20Face%2C%20Mumbai"
    );
  });

  it("uses exact coordinates when no title or address is present", () => {
    const loc = {
      latitude: 19.076,
      longitude: 72.8777,
    };

    const searchUrl = getGoogleMapsSearchUrl(loc);
    expect(searchUrl).toBe("https://www.google.com/maps/search/?api=1&query=19.076,72.8777");

    const dirUrl = getGoogleMapsDirectionsUrl(loc);
    expect(dirUrl).toBe("https://www.google.com/maps/dir/?api=1&destination=19.076,72.8777");
  });

  it("falls back to encoded address for directions and search links", () => {
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
});

describe("parseLocationInput", () => {
  it("parses plain coordinates with comma or spaces", () => {
    expect(parseLocationInput("17.3850, 78.4867")).toEqual({
      latitude: 17.385,
      longitude: 78.4867,
    });
    expect(parseLocationInput("17.3850 78.4867")).toEqual({
      latitude: 17.385,
      longitude: 78.4867,
    });
    expect(parseLocationInput("(17.3850, 78.4867)")).toEqual({
      latitude: 17.385,
      longitude: 78.4867,
    });
    expect(parseLocationInput(" -33.8688 , 151.2093 ")).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(parseLocationInput("+28.6139, +77.2090")).toEqual({
      latitude: 28.6139,
      longitude: 77.209,
    });
  });

  it("extracts coordinates from exact place pin (!3d<lat>!4d<lng>)", () => {
    const url =
      "https://www.google.com/maps/place/Hitech+City/@17.4474,78.3762,15z/data=!4m6!3m5!1s0x3bcb93dc8c5d69df:0x19688eee5e541327!8m2!3d17.4435!4d78.3772!16z";
    expect(parseLocationInput(url)).toEqual({
      latitude: 17.4435,
      longitude: 78.3772,
    });
  });

  it("prioritizes exact pin (!3d!4d) over map center (@lat,lng)", () => {
    const url = "https://www.google.com/maps/place/Center/@10.0,20.0,14z/data=!3m1!1e3!8m2!3d12.3456!4d78.9101";
    expect(parseLocationInput(url)).toEqual({
      latitude: 12.3456,
      longitude: 78.9101,
    });
  });

  it("extracts coordinates from map center (@<lat>,<lng>,<zoom>z) when pin is absent", () => {
    const url = "https://www.google.com/maps/@17.447412,78.376245,16z";
    expect(parseLocationInput(url)).toEqual({
      latitude: 17.447412,
      longitude: 78.376245,
    });
  });

  it("extracts coordinates from query parameter (?q= or query= or ll=)", () => {
    expect(parseLocationInput("https://maps.google.com/?q=17.3850,78.4867")).toEqual({
      latitude: 17.385,
      longitude: 78.4867,
    });
    expect(
      parseLocationInput("https://www.google.com/maps/search/?api=1&query=12.9716,77.5946")
    ).toEqual({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    expect(parseLocationInput("https://maps.google.com/maps?ll=22.5726,88.3639")).toEqual({
      latitude: 22.5726,
      longitude: 88.3639,
    });
  });

  it("detects and extracts Google Maps short links even when repeated or surrounded", () => {
    expect(isGoogleMapsShortLink("https://maps.app.goo.gl/ABC123xyz")).toBe(true);
    expect(isGoogleMapsShortLink("https://goo.gl/maps/DEF456")).toBe(true);
    expect(isGoogleMapsShortLink("https://google.com")).toBe(false);
    expect(isGoogleMapsShortLink("17.3850, 78.4867")).toBe(false);

    // Duplicated or repeated paste
    const repeated = "https://maps.app.goo.gl/2dDdG7w9D8VcEKXd6https://maps.app.goo.gl/2dDdG7w9D8VcEKXd6";
    expect(extractGoogleMapsShortLink(repeated)).toBe("https://maps.app.goo.gl/2dDdG7w9D8VcEKXd6");

    // Text surrounding link
    const surrounded = "Check out this place: https://maps.app.goo.gl/2dDdG7w9D8VcEKXd6 on Google Maps";
    expect(extractGoogleMapsShortLink(surrounded)).toBe("https://maps.app.goo.gl/2dDdG7w9D8VcEKXd6");
  });

  it("rejects invalid coordinate values and out-of-bounds numbers", () => {
    expect(parseLocationInput("0, 0")).toEqual({
      error: "Coordinates (0, 0) are not allowed.",
    });
    expect(parseLocationInput("95.0, 78.4867")).toEqual({
      error: "Latitude must be between -90 and 90.",
    });
    expect(parseLocationInput("17.3850, 195.0")).toEqual({
      error: "Longitude must be between -180 and 180.",
    });
    expect(parseLocationInput("random garbage text")).toEqual({
      error:
        "We couldn't read this link. Paste a Google Maps link or coordinates (latitude, longitude).",
    });
  });
});
