import { describe, it, expect } from "vitest";
import { buildWhatsAppPitch, buildListingShareUrl, type PitchListingData } from "../pitch";

describe("WhatsApp Pitch Builder", () => {
  const baseListing: PitchListingData = {
    id: 1,
    slug: "my-home-avali-xopxk8",
    title: "My Home Avali",
    propertyType: "APARTMENT",
    bedrooms: 3,
    areaSqFt: 2294,
    facing: "EAST",
    price: 20600000,
    priceDisplay: "2.06 Cr",
    currency: "INR",
    projectUnits: 450,
    projectArea: 12.5,
    reraId: "P02400006789",
    addressLine: "Tellapur",
    city: "Hyderabad",
    latitude: 17.4612,
    longitude: 78.2934,
  };

  const agent = {
    name: "Farhan Agent",
    phone: "+91 98765 43210",
  };

  it("builds a full pitch with all fields present", () => {
    const pitch = buildWhatsAppPitch({
      listing: baseListing,
      agent,
      baseUrl: "https://rebx.app",
    });

    expect(pitch).toContain("🏠 *My Home Avali | 3 BHK Apartment*");
    expect(pitch).toContain("📍 Tellapur, Hyderabad");
    expect(pitch).toContain("📐 2,294 sq.ft | East Facing");
    expect(pitch).toContain("💰 ₹ 2.06 Cr");
    expect(pitch).toContain("🏗 450 units | 12.5 acres");
    expect(pitch).toContain("✅ RERA: P02400006789");
    expect(pitch).toContain("🗺 Location: https://www.google.com/maps/search/?api=1&query=");
    expect(pitch).toContain("👉 Full details & photos: https://rebx.app/listings/my-home-avali-xopxk8?utm_source=whatsapp&utm_medium=agent_share");
    expect(pitch).toContain("📞 Farhan Agent: +91 98765 43210");

    // Verify listing URL appears BEFORE map URL so WhatsApp preview card displays the listing, not google.com
    const listingUrlIndex = pitch.indexOf("👉 Full details & photos:");
    const mapUrlIndex = pitch.indexOf("🗺 Location:");
    expect(listingUrlIndex).toBeLessThan(mapUrlIndex);
  });

  it("skips missing fields cleanly", () => {
    const minimalListing: PitchListingData = {
      id: 2,
      slug: "villa-in-mokila",
      title: "Luxury Villa",
      price: null,
      priceOnRequest: true,
      city: "Hyderabad",
    };

    const pitch = buildWhatsAppPitch({
      listing: minimalListing,
      agent: { name: "Agent" }, // No phone
      baseUrl: "https://rebx.app",
    });

    expect(pitch).toContain("🏠 *Luxury Villa*");
    expect(pitch).toContain("📍 Hyderabad");
    expect(pitch).toContain("💰 Price on request");
    // Should NOT contain missing fields
    expect(pitch).not.toContain("📐");
    expect(pitch).not.toContain("🏗");
    expect(pitch).not.toContain("✅ RERA");
    expect(pitch).not.toContain("📞");
  });

  it("handles price range and custom priceDisplay properly", () => {
    const rangeListing: PitchListingData = {
      id: 3,
      slug: "som-boulevard",
      title: "Som Boulevard",
      price: 53900000,
      priceDisplay: "5.39 Cr - 8.17 Cr",
      city: "Hyderabad",
    };

    const pitch = buildWhatsAppPitch({
      listing: rangeListing,
      baseUrl: "https://rebx.app",
    });

    expect(pitch).toContain("💰 ₹ 5.39 Cr - 8.17 Cr");
  });

  it("respects toggle options to turn off sections", () => {
    const pitch = buildWhatsAppPitch({
      listing: baseListing,
      agent,
      baseUrl: "https://rebx.app",
      toggles: {
        price: false,
        phone: false,
        mapLink: false,
      },
    });

    expect(pitch).not.toContain("💰");
    expect(pitch).not.toContain("📞");
    expect(pitch).not.toContain("🗺 Location");
    expect(pitch).toContain("📐 2,294 sq.ft | East Facing");
  });

  it("builds tracked share URL with UTM parameters", () => {
    const url = buildListingShareUrl("https://rebx.app", "my-listing-slug");
    expect(url).toBe("https://rebx.app/listings/my-listing-slug?utm_source=whatsapp&utm_medium=agent_share");
  });

  it("truncates lowest priority lines if text exceeds 1500 chars", () => {
    const longTitle = "A".repeat(1400);
    const longListing: PitchListingData = {
      ...baseListing,
      title: longTitle,
    };

    const pitch = buildWhatsAppPitch({
      listing: longListing,
      agent,
      baseUrl: "https://rebx.app",
    });

    expect(pitch.length).toBeLessThanOrEqual(1500);
  });
});

