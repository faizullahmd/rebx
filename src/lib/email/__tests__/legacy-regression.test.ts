// Regression: after making emails editable, the payloads handed to Resend must be IDENTICAL
// to what the original hardcoded src/lib/email.ts sent. The fixtures were captured from the
// original implementation before it was refactored.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { outbox } from "@/test/helpers";
import { prisma } from "@/lib/prisma";
import { invalidateTemplateCache } from "@/lib/email/cache";

vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

const golden: { label: string; payload: Record<string, unknown> }[] = JSON.parse(
  readFileSync(path.join(__dirname, "../__fixtures__/legacy-email-payloads.json"), "utf8")
);

async function runAll() {
  const m = await import("@/lib/email");
  const calls: Record<string, () => Promise<unknown>> = {
    password_reset: () => m.sendPasswordResetEmail("user@example.com", "https://rebx.app/reset-password/abc123"),
    developer_request_notification: () =>
      m.sendDeveloperRequestNotification(["admin1@example.com", "admin2@example.com"], {
        companyName: "Acme <Builders> & Co", contactName: "Jo \"JJ\" O'Neil", listingTitle: "Lakeside Family Home",
        requestedByName: "Alex Agent", reviewUrl: "https://rebx.app/admin/dashboard/developer-requests",
      }),
    developer_welcome: () => m.sendDeveloperWelcomeEmail("dev@example.com", "Northgate Developments", "https://rebx.app/reset-password/tok456"),
    welcome: () => m.sendWelcomeEmail("new@example.com", "Casey <Customer>"),
    new_lead_full: () =>
      m.sendNewLeadNotification("agent@example.com", {
        listingTitle: "Downtown 2BR Condo", contactName: "Taylor Prospect", contactEmail: "taylor@example.com",
        contactPhone: "555-0101", message: "Is this still available? <b>Please</b> reply & call.", dealUrl: "https://rebx.app/agent/dashboard/deals/7",
      }),
    new_lead_no_phone_no_message: () =>
      m.sendNewLeadNotification("agent@example.com", {
        listingTitle: "Downtown 2BR Condo", contactName: "Taylor Prospect", contactEmail: "taylor@example.com",
        contactPhone: null, message: null, dealUrl: "https://rebx.app/agent/dashboard/deals/7",
      }),
    new_lead_phone_only: () =>
      m.sendNewLeadNotification("agent@example.com", {
        listingTitle: "Downtown 2BR Condo", contactName: "Taylor Prospect", contactEmail: "taylor@example.com",
        contactPhone: "555-0101", message: "", dealUrl: "https://rebx.app/agent/dashboard/deals/7",
      }),
    inquiry_confirmation: () => m.sendInquiryConfirmation("guest@example.com", { listingTitle: "Lakeside Family Home", agentName: "Alex Agent" }),
    booking_confirmation_needed: () =>
      m.sendBookingConfirmationNeededEmail("dev@example.com", { listingTitle: "Northgate Tower 12B", agentName: "Alex Agent", saleAmount: 1234567.5, bookingUrl: "https://rebx.app/developer/dashboard/bookings" }),
    booking_confirmed: () =>
      m.sendBookingConfirmedEmail("agent@example.com", { listingTitle: "Northgate Tower 12B", developerCompanyName: "Northgate Developments", bookingUrl: "https://rebx.app/agent/dashboard/deals/9" }),
    commission_paid_out: () =>
      m.sendCommissionPaidOutEmail("agent@example.com", { listingTitle: "Northgate Tower 12B", amount: 15360, source: "DEVELOPER", dealUrl: "https://rebx.app/agent/dashboard/deals/9" }),
  };
  return calls;
}

describe("legacy email output is unchanged", () => {
  beforeAll(async () => {
    await prisma.emailTemplate.deleteMany();
  });
  beforeEach(() => {
    outbox.length = 0;
    invalidateTemplateCache();
  });

  it("covers every captured fixture", async () => {
    const calls = await runAll();
    expect(Object.keys(calls).sort()).toEqual(golden.map((g) => g.label).sort());
  });

  for (const { label, payload } of golden) {
    it(`built-in fallback (no database rows) sends the same payload: ${label}`, async () => {
      const calls = await runAll();
      await calls[label]();
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toEqual(payload);
    });
  }
});
