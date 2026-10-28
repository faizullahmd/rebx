import { describe, it, expect } from "vitest";
import {
  CancelSiteVisitSchema,
  RescheduleSiteVisitSchema,
  BookSiteVisitSchema,
  TIME_SLOTS,
  SITE_VISIT_STATUSES,
  SITE_VISIT_STATUS_LABELS,
} from "../site-visit";

describe("Site Visit Validation & Schemas", () => {
  describe("SITE_VISIT_STATUSES & Labels", () => {
    it("contains all expected lifecycle statuses", () => {
      expect(SITE_VISIT_STATUSES).toEqual(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]);
    });

    it("has friendly human labels for all statuses", () => {
      expect(SITE_VISIT_STATUS_LABELS.PENDING).toBe("Pending Confirmation");
      expect(SITE_VISIT_STATUS_LABELS.CONFIRMED).toBe("Confirmed");
      expect(SITE_VISIT_STATUS_LABELS.CANCELLED).toBe("Cancelled");
      expect(SITE_VISIT_STATUS_LABELS.COMPLETED).toBe("Completed");
    });
  });

  describe("CancelSiteVisitSchema", () => {
    it("accepts a valid cancellation with reason", () => {
      const result = CancelSiteVisitSchema.safeParse({
        siteVisitId: 10,
        reason: "Client asked to postpone due to weather.",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.siteVisitId).toBe(10);
        expect(result.data.reason).toBe("Client asked to postpone due to weather.");
      }
    });

    it("accepts cancellation without reason", () => {
      const result = CancelSiteVisitSchema.safeParse({
        siteVisitId: 42,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reason).toBeUndefined();
      }
    });

    it("rejects cancellation reason exceeding 500 characters", () => {
      const longReason = "a".repeat(501);
      const result = CancelSiteVisitSchema.safeParse({
        siteVisitId: 10,
        reason: longReason,
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing or invalid siteVisitId", () => {
      const result = CancelSiteVisitSchema.safeParse({
        siteVisitId: "not-a-number",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("RescheduleSiteVisitSchema", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const validFutureDateStr = futureDate.toISOString().split("T")[0];

    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    const invalidPastDateStr = pastDate.toISOString().split("T")[0];

    it("accepts valid future date and slot", () => {
      const result = RescheduleSiteVisitSchema.safeParse({
        siteVisitId: 15,
        date: validFutureDateStr,
        timeSlot: TIME_SLOTS[0],
        notes: "Moved to morning",
      });
      expect(result.success).toBe(true);
    });

    it("rejects past dates", () => {
      const result = RescheduleSiteVisitSchema.safeParse({
        siteVisitId: 15,
        date: invalidPastDateStr,
        timeSlot: TIME_SLOTS[0],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/past/i);
      }
    });

    it("rejects invalid time slots not in TIME_SLOTS", () => {
      const result = RescheduleSiteVisitSchema.safeParse({
        siteVisitId: 15,
        date: validFutureDateStr,
        timeSlot: "23:00 - 02:00",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toMatch(/valid time slot/i);
      }
    });

    it("rejects invalid date format", () => {
      const result = RescheduleSiteVisitSchema.safeParse({
        siteVisitId: 15,
        date: "25/12/2026",
        timeSlot: TIME_SLOTS[0],
      });
      expect(result.success).toBe(false);
    });
  });
});
