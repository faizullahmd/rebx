import { describe, it, expect } from "vitest";
import {
  parseAppointmentStartDateTime,
  buildReminderEmailHtml,
} from "../site-visit-reminders";

describe("Site Visit Reminders Logic", () => {
  describe("parseAppointmentStartDateTime", () => {
    it("parses 10:00 AM slot correctly", () => {
      const date = "2026-10-28";
      const slot = "10:00 AM - 11:00 AM";
      const parsed = parseAppointmentStartDateTime(date, slot);

      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(9); // 0-indexed: 9 = October
      expect(parsed.getDate()).toBe(28);
      expect(parsed.getHours()).toBe(10);
      expect(parsed.getMinutes()).toBe(0);
    });

    it("parses afternoon PM slot correctly", () => {
      const date = "2026-11-05";
      const slot = "03:30 PM - 04:30 PM";
      const parsed = parseAppointmentStartDateTime(date, slot);

      expect(parsed.getHours()).toBe(15);
      expect(parsed.getMinutes()).toBe(30);
    });

    it("parses 12:00 PM (noon) slot correctly", () => {
      const date = "2026-11-05";
      const slot = "12:00 PM - 01:00 PM";
      const parsed = parseAppointmentStartDateTime(date, slot);

      expect(parsed.getHours()).toBe(12);
      expect(parsed.getMinutes()).toBe(0);
    });

    it("handles fallback gracefully if slot format is unusual", () => {
      const date = "2026-10-28";
      const slot = "Custom Slot";
      const parsed = parseAppointmentStartDateTime(date, slot);

      expect(parsed.getHours()).toBe(10); // default fallback
    });
  });

  describe("buildReminderEmailHtml", () => {
    it("includes property name, timing, directions and counterpart details", () => {
      const html = buildReminderEmailHtml({
        recipientName: "Rohan Sharma",
        recipientRole: "Customer",
        listingTitle: "Emerald Luxury Villa",
        addressString: "Worli Sea Face, Mumbai",
        directionsUrl: "https://www.google.com/maps/dir/?api=1&destination=Worli%20Sea%20Face",
        formattedDate: "Thu, 29 Oct 2026",
        timeSlot: "11:00 AM - 12:00 PM",
        visitType: "In-Person Visit",
        dealUrl: "https://rebx.com/customer/dashboard/chat/42",
        counterpartName: "Sarah Agent",
        counterpartRole: "Agent",
        is24h: true,
      });

      expect(html).toContain("Emerald Luxury Villa");
      expect(html).toContain("Rohan Sharma");
      expect(html).toContain("Sarah Agent");
      expect(html).toContain("Thu, 29 Oct 2026 at 11:00 AM - 12:00 PM");
      expect(html).toContain("Worli Sea Face, Mumbai");
      expect(html).toContain("https://www.google.com/maps/dir/?api=1&destination=Worli%20Sea%20Face");
      expect(html).toContain("Get Directions on Google Maps");
      expect(html).toContain("tomorrow");
    });

    it("handles 1-hour reminder phrasing correctly", () => {
      const html = buildReminderEmailHtml({
        recipientName: "Sarah Agent",
        recipientRole: "Agent",
        listingTitle: "Skyline Heights",
        addressString: "Bandra West, Mumbai",
        directionsUrl: null,
        formattedDate: "Wed, 28 Oct 2026",
        timeSlot: "02:00 PM - 03:00 PM",
        visitType: "Virtual Tour",
        dealUrl: "https://rebx.com/agent/dashboard/deals/42",
        counterpartName: "Rohan Sharma",
        counterpartRole: "Client",
        is24h: false,
      });

      expect(html).toContain("in approximately 1 hour");
      expect(html).toContain("Sarah Agent");
      expect(html).toContain("Rohan Sharma");
      expect(html).not.toContain("View Directions on Google Maps");
    });
  });
});
