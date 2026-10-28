import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { outbox } from "@/test/helpers";
import {
  bookSiteVisit,
  confirmSiteVisit,
  cancelSiteVisit,
  rescheduleSiteVisit,
  completeSiteVisit,
  acceptRescheduleProposal,
  declineRescheduleProposal,
} from "@/lib/actions/site-visits";
import { processSiteVisitReminders, verifyCronAuthHeaders } from "@/lib/site-visit-reminders";
import {
  hasValidCoordinates,
  formatDisplayAddress,
  getGoogleMapsSearchUrl,
  getGoogleMapsDirectionsUrl,
} from "@/lib/maps";

// Mock email transport
vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

// Mock @/auth to avoid next-auth pulling next/server in node environment
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signOut: vi.fn(),
}));

// Mock Next.js headers
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })),
}));

// Mock Next.js cache revalidation
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock current active user for server actions
let mockActor: { id: number; role: "CUSTOMER" | "AGENT" | "ADMIN"; email: string; name: string } | null = null;

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => {
    if (!mockActor) {
      throw new Error("Unauthorized");
    }
    return mockActor;
  }),
  requireRole: vi.fn(async (role: string) => {
    if (!mockActor || mockActor.role !== role) {
      throw new Error("Unauthorized role");
    }
    return mockActor;
  }),
}));

const AGENT_USER = { id: 920001, role: "AGENT" as const, email: "agent92@example.com", name: "Agent Test" };
const CUSTOMER_1 = { id: 920002, role: "CUSTOMER" as const, email: "cust1@example.com", name: "Customer One" };
const CUSTOMER_2 = { id: 920003, role: "CUSTOMER" as const, email: "cust2@example.com", name: "Customer Two" };

const LISTING_ID = 920010;
const DEAL_1_ID = 920020;
const DEAL_2_ID = 920021;

// Helper to generate upcoming valid date (YYYY-MM-DD)
function getFutureDateString(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("Site Visit Complete Lifecycle, Reminders & Google Maps Verification", () => {
  beforeAll(async () => {
    // Clean up any stale records from test range
    await prisma.dealMessage.deleteMany({ where: { dealId: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.siteVisit.deleteMany({ where: { dealId: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.deal.deleteMany({ where: { id: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.listing.deleteMany({ where: { id: LISTING_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [AGENT_USER.id, CUSTOMER_1.id, CUSTOMER_2.id] } } });

    // Seed test users
    for (const u of [AGENT_USER, CUSTOMER_1, CUSTOMER_2]) {
      await prisma.user.create({
        data: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          passwordHash: "x",
        },
      });
    }

    // Seed test listing
    await prisma.listing.create({
      data: {
        id: LISTING_ID,
        title: "Sea Breeze Penthouse",
        slug: "sea-breeze-penthouse-920010",
        description: "Beautiful penthouse with ocean views",
        addressLine: "50 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        country: "India",
        postalCode: "400020",
        latitude: 18.943,
        longitude: 72.823,
        agentId: AGENT_USER.id,
      },
    });

    // Seed test deals
    await prisma.deal.create({
      data: {
        id: DEAL_1_ID,
        listingId: LISTING_ID,
        agentId: AGENT_USER.id,
        customerId: CUSTOMER_1.id,
        contactName: CUSTOMER_1.name,
        contactEmail: CUSTOMER_1.email,
        stage: "NEW",
      },
    });

    await prisma.deal.create({
      data: {
        id: DEAL_2_ID,
        listingId: LISTING_ID,
        agentId: AGENT_USER.id,
        customerId: CUSTOMER_2.id,
        contactName: CUSTOMER_2.name,
        contactEmail: CUSTOMER_2.email,
        stage: "NEW",
      },
    });
  });

  afterAll(async () => {
    await prisma.dealMessage.deleteMany({ where: { dealId: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.siteVisit.deleteMany({ where: { dealId: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.deal.deleteMany({ where: { id: { in: [DEAL_1_ID, DEAL_2_ID] } } });
    await prisma.listing.deleteMany({ where: { id: LISTING_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [AGENT_USER.id, CUSTOMER_1.id, CUSTOMER_2.id] } } });
  });

  beforeEach(() => {
    outbox.length = 0;
    mockActor = null;
  });

  // ==========================================
  // SCENARIO 1: Booking & Authorization
  // ==========================================
  describe("Scenario 1: Customer Booking & Ownership Authorization", () => {
    it("rejects booking when user is unauthenticated", async () => {
      mockActor = null;
      const res = await bookSiteVisit(DEAL_1_ID, {
        date: getFutureDateString(3),
        timeSlot: "10:00 AM - 11:00 AM",
        visitType: "IN_PERSON",
      });
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/Unauthorized/i);
    });

    it("rejects booking when Customer 2 attempts to book on Customer 1's deal", async () => {
      mockActor = CUSTOMER_2; // Wrong customer
      const res = await bookSiteVisit(DEAL_1_ID, {
        date: getFutureDateString(3),
        timeSlot: "10:00 AM - 11:00 AM",
        visitType: "IN_PERSON",
      });
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/not authorized|unauthorized/i);
    });

    it("allows authorized customer to book a valid upcoming visit", async () => {
      mockActor = CUSTOMER_1;
      const visitDate = getFutureDateString(3);
      const res = await bookSiteVisit(DEAL_1_ID, {
        date: visitDate,
        timeSlot: "10:00 AM - 11:00 AM",
        visitType: "IN_PERSON",
        notes: "Looking forward to inspecting the balcony view.",
      });

      expect(res.success).toBe(true);
      expect(res.siteVisit).toBeDefined();
      expect(res.siteVisit?.status).toBe("PENDING");

      // Verify DB record
      const dbVisit = await prisma.siteVisit.findFirst({
        where: { dealId: DEAL_1_ID, status: "PENDING" },
      });
      expect(dbVisit).not.toBeNull();
      expect(dbVisit?.timeSlot).toBe("10:00 AM - 11:00 AM");
      expect(dbVisit?.visitType).toBe("IN_PERSON");
      expect(dbVisit?.notes).toContain("Looking forward to inspecting the balcony view.");

      // Verify deal stage updated to VIEWING_SCHEDULED
      const deal = await prisma.deal.findUnique({ where: { id: DEAL_1_ID } });
      expect(deal?.stage).toBe("VIEWING_SCHEDULED");

      // Verify conversation thread message created
      const msg = await prisma.dealMessage.findFirst({
        where: { dealId: DEAL_1_ID, senderRole: "CUSTOMER" },
        orderBy: { id: "desc" },
      });
      expect(msg?.text).toContain("I booked a In-Person Visit");
    });

    it("rejects booking when an active appointment already exists on that date & slot", async () => {
      mockActor = CUSTOMER_1;
      const res = await bookSiteVisit(DEAL_1_ID, {
        date: getFutureDateString(3),
        timeSlot: "10:00 AM - 11:00 AM",
        visitType: "IN_PERSON",
      });
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/already have a site visit booked/i);
    });
  });

  // ==========================================
  // SCENARIO 2: Agent Confirmation & Conflict Prevention
  // ==========================================
  describe("Scenario 2: Agent Confirmation & Appointment Conflict Prevention", () => {
    it("rejects confirmation if unauthorized customer tries to confirm", async () => {
      mockActor = CUSTOMER_1;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID, status: "PENDING" } });
      expect(visit).not.toBeNull();

      const res = await confirmSiteVisit(visit!.id);
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/authorized/i);
    });

    it("allows assigned agent to confirm the pending appointment", async () => {
      mockActor = AGENT_USER;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID, status: "PENDING" } });
      const res = await confirmSiteVisit(visit!.id);

      expect(res.success).toBe(true);
      const updated = await prisma.siteVisit.findUnique({ where: { id: visit!.id } });
      expect(updated?.status).toBe("CONFIRMED");

      // Verify confirmation event message in deal thread
      const msg = await prisma.dealMessage.findFirst({
        where: { dealId: DEAL_1_ID, type: "EVENT", text: { contains: "confirmed" } },
        orderBy: { id: "desc" },
      });
      expect(msg).not.toBeNull();
    });

    it("prevents conflicting confirmed appointments for the same agent at the same time slot", async () => {
      // Create a pending appointment on Deal 2 with the exact same date and time slot
      const existing = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID, status: "CONFIRMED" } });
      expect(existing).not.toBeNull();

      const conflictingVisit = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_2_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_2.id,
          date: existing!.date,
          timeSlot: existing!.timeSlot,
          visitType: "IN_PERSON",
          status: "PENDING",
        },
      });

      mockActor = AGENT_USER;
      const res = await confirmSiteVisit(conflictingVisit.id);
      expect(res.success).toBe(false);
      expect(res.message).toMatch(/conflict|already have another confirmed appointment/i);

      // Conflicting visit remains PENDING
      const check = await prisma.siteVisit.findUnique({ where: { id: conflictingVisit.id } });
      expect(check?.status).toBe("PENDING");

      // Cleanup conflicting visit
      await prisma.siteVisit.delete({ where: { id: conflictingVisit.id } });
    });
  });

  // ==========================================
  // SCENARIO 3: Rescheduling Proposals, Acceptance & Decline
  // ==========================================
  describe("Scenario 3: Rescheduling Workflow (Pending Proposal, Accept, Decline)", () => {
    it("preserves original appointment and CONFIRMED status when agent proposes reschedule", async () => {
      mockActor = AGENT_USER;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID, status: "CONFIRMED" } });
      expect(visit).not.toBeNull();

      const originalDate = visit!.date;
      const originalSlot = visit!.timeSlot;
      const proposedDate = getFutureDateString(6);
      const proposedSlot = "03:00 PM - 04:00 PM";

      const res = await rescheduleSiteVisit(visit!.id, {
        date: proposedDate,
        timeSlot: proposedSlot,
        reason: "Need to adjust for property renovation inspection.",
      });

      expect(res.success).toBe(true);

      const refreshed = await prisma.siteVisit.findUnique({ where: { id: visit!.id } });
      // Status must STILL be CONFIRMED until customer accepts
      expect(refreshed?.status).toBe("CONFIRMED");
      // Original appointment date and time MUST remain unchanged
      expect(refreshed?.date.toISOString()).toBe(originalDate.toISOString());
      expect(refreshed?.timeSlot).toBe(originalSlot);
      // Proposal stored in notes
      expect(refreshed?.notes).toContain("[SITE_VISIT_RESCHEDULE_PROPOSAL]");
      expect(refreshed?.notes).toContain('"status":"PENDING"');
      expect(refreshed?.notes).toContain(proposedSlot);
    });

    it("rejects unauthorized customer from accepting the reschedule proposal", async () => {
      mockActor = CUSTOMER_2; // Wrong customer
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID } });
      const res = await acceptRescheduleProposal(visit!.id);

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/not authorized|unauthorized/i);
    });

    it("accepts reschedule proposal: updates appointment, keeps CONFIRMED, and resets reminder timestamps", async () => {
      mockActor = CUSTOMER_1; // Legitimate customer
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID } });

      // Pre-set reminder timestamps to simulate they were sent for the old date
      await prisma.siteVisit.update({
        where: { id: visit!.id },
        data: { reminded24hAt: new Date(), reminded1hAt: new Date() },
      });

      const res = await acceptRescheduleProposal(visit!.id);
      expect(res.success).toBe(true);

      const updated = await prisma.siteVisit.findUnique({ where: { id: visit!.id } });
      expect(updated?.status).toBe("CONFIRMED");
      expect(updated?.timeSlot).toBe("03:00 PM - 04:00 PM");
      expect(updated?.notes).toContain('"status":"ACCEPTED"');
      // Critical check: reminder timestamps MUST be reset to null for new appointment
      expect(updated?.reminded24hAt).toBeNull();
      expect(updated?.reminded1hAt).toBeNull();
    });

    it("safely rejects duplicate accept on an already accepted proposal", async () => {
      mockActor = CUSTOMER_1;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID } });
      const res = await acceptRescheduleProposal(visit!.id);

      expect(res.success).toBe(false);
      expect(res.message).toMatch(/already been responded to|no active reschedule proposal/i);
    });

    it("declines a reschedule proposal: keeps original future appointment", async () => {
      mockActor = AGENT_USER;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID } });

      // Propose another reschedule
      await rescheduleSiteVisit(visit!.id, {
        date: getFutureDateString(8),
        timeSlot: "05:00 PM - 06:00 PM",
        reason: "Client conflict test",
      });

      mockActor = CUSTOMER_1;
      const res = await declineRescheduleProposal(visit!.id);
      expect(res.success).toBe(true);

      const declined = await prisma.siteVisit.findUnique({ where: { id: visit!.id } });
      // Remains confirmed with existing valid date/slot
      expect(declined?.status).toBe("CONFIRMED");
      expect(declined?.notes).toContain('"status":"DECLINED"');
    });

    it("cancels appointment if customer declines when original appointment has already expired in the past", async () => {
      mockActor = AGENT_USER;
      const visit = await prisma.siteVisit.findFirst({ where: { dealId: DEAL_1_ID } });

      // Simulate original appointment was 2 days ago
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 2);

      await prisma.siteVisit.update({
        where: { id: visit!.id },
        data: { date: pastDate },
      });

      // Propose reschedule
      await rescheduleSiteVisit(visit!.id, {
        date: getFutureDateString(5),
        timeSlot: "11:00 AM - 12:00 PM",
        reason: "Rescheduling missed appointment",
      });

      mockActor = CUSTOMER_1;
      const res = await declineRescheduleProposal(visit!.id);
      expect(res.success).toBe(true);

      const refreshed = await prisma.siteVisit.findUnique({ where: { id: visit!.id } });
      // Since original date is in the past, declining cancels the appointment
      expect(refreshed?.status).toBe("CANCELLED");
      expect(refreshed?.notes).toMatch(/Original appointment date has passed/i);
    });
  });

  // ==========================================
  // SCENARIO 4: Cancellation & Completion
  // ==========================================
  describe("Scenario 4: Cancellation & Completion Lifecycles", () => {
    it("allows agent to complete an active confirmed visit", async () => {
      // Re-create a confirmed visit to test completion
      const newVisit = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: new Date(),
          timeSlot: "10:00 AM - 11:00 AM",
          visitType: "IN_PERSON",
          status: "CONFIRMED",
        },
      });

      mockActor = AGENT_USER;
      const res = await completeSiteVisit(newVisit.id);
      expect(res.success).toBe(true);

      const completed = await prisma.siteVisit.findUnique({ where: { id: newVisit.id } });
      expect(completed?.status).toBe("COMPLETED");

      // Cleanup
      await prisma.siteVisit.delete({ where: { id: newVisit.id } });
    });

    it("allows agent to cancel a visit with a stated reason", async () => {
      const visitToCancel = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: new Date(),
          timeSlot: "02:00 PM - 03:00 PM",
          visitType: "IN_PERSON",
          status: "CONFIRMED",
        },
      });

      mockActor = AGENT_USER;
      const res = await cancelSiteVisit(visitToCancel.id, {
        reason: "Owner requested delay due to painting work.",
      });

      expect(res.success).toBe(true);
      const cancelled = await prisma.siteVisit.findUnique({ where: { id: visitToCancel.id } });
      expect(cancelled?.status).toBe("CANCELLED");
      expect(cancelled?.notes).toContain("Owner requested delay due to painting work.");

      // Cleanup
      await prisma.siteVisit.delete({ where: { id: visitToCancel.id } });
    });
  });

  // ==========================================
  // SCENARIO 5: 24h & 1h Reminders & Idempotency
  // ==========================================
  describe("Scenario 5: 24h and 1h Reminders, Notification Delivery & Idempotency", () => {
    it("sends 24h reminder for confirmed visit in ~24h window and prevents duplicate on second run", async () => {
      // Setup appointment ~23.5 hours from now
      const in24Hours = new Date(Date.now() + 23.5 * 3600 * 1000);
      const hour = in24Hours.getHours();
      const period = hour >= 12 ? "PM" : "AM";
      const displayH = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const pad = (n: number) => String(n).padStart(2, "0");
      const slot24h = `${pad(displayH)}:00 ${period} - ${pad(displayH + 1)}:00 ${period}`;

      const visit24h = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: in24Hours,
          timeSlot: slot24h,
          visitType: "IN_PERSON",
          status: "CONFIRMED",
        },
      });

      // First run: should trigger 24h reminder
      const result1 = await processSiteVisitReminders();
      expect(result1.success).toBe(true);
      expect(result1.reminders24hSent).toBeGreaterThanOrEqual(1);

      // Verify DB record has reminded24hAt timestamp set
      const check1 = await prisma.siteVisit.findUnique({ where: { id: visit24h.id } });
      expect(check1?.reminded24hAt).not.toBeNull();
      expect(check1?.reminded1hAt).toBeNull(); // 1h not yet due

      // Verify in-app DealMessage event was logged
      const dealMsg = await prisma.dealMessage.findFirst({
        where: {
          dealId: DEAL_1_ID,
          senderRole: "SYSTEM",
          text: { contains: "Site Visit Reminder" },
        },
        orderBy: { id: "desc" },
      });
      expect(dealMsg).not.toBeNull();
      expect(dealMsg?.text).toContain("Sea Breeze Penthouse");

      // Verify email was captured in outbox
      expect(outbox.length).toBeGreaterThanOrEqual(1);
      const email = outbox.find((e) => e.subject.includes("is scheduled tomorrow"));
      expect(email).toBeDefined();
      expect(email?.html).toContain("Sea Breeze Penthouse");
      expect(email?.html).toContain("50 Marine Drive, Mumbai");

      // Second run: IDEMPOTENCY CHECK - MUST SEND 0 REMINDERS
      const outboxLenBefore = outbox.length;
      const result2 = await processSiteVisitReminders();
      expect(result2.success).toBe(true);
      expect(result2.reminders24hSent).toBe(0);
      expect(outbox.length).toBe(outboxLenBefore); // No extra emails sent

      // Cleanup
      await prisma.siteVisit.delete({ where: { id: visit24h.id } });
      if (dealMsg) await prisma.dealMessage.delete({ where: { id: dealMsg.id } });
    });

    it("sends 1h reminder for confirmed visit in ~1h window", async () => {
      // Setup appointment ~60 minutes from now
      const in1Hour = new Date(Date.now() + 65 * 60 * 1000);
      const hour = in1Hour.getHours();
      const period = hour >= 12 ? "PM" : "AM";
      const displayH = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      const pad = (n: number) => String(n).padStart(2, "0");
      const slot1h = `${pad(displayH)}:00 ${period} - ${pad(displayH + 1)}:00 ${period}`;

      const visit1h = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: in1Hour,
          timeSlot: slot1h,
          visitType: "IN_PERSON",
          status: "CONFIRMED",
          reminded24hAt: new Date(Date.now() - 23 * 3600 * 1000), // 24h already sent
        },
      });

      const res = await processSiteVisitReminders();
      expect(res.success).toBe(true);
      expect(res.reminders1hSent).toBeGreaterThanOrEqual(1);

      const check = await prisma.siteVisit.findUnique({ where: { id: visit1h.id } });
      expect(check?.reminded1hAt).not.toBeNull();

      // Cleanup
      await prisma.siteVisit.delete({ where: { id: visit1h.id } });
    });

    it("never sends reminders for CANCELLED, COMPLETED, or PENDING visits", async () => {
      const in24Hours = new Date(Date.now() + 23.5 * 3600 * 1000);
      const testSlot = "10:00 AM - 11:00 AM";

      const cancelled = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: in24Hours,
          timeSlot: testSlot,
          visitType: "IN_PERSON",
          status: "CANCELLED",
        },
      });

      const completed = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: in24Hours,
          timeSlot: testSlot,
          visitType: "IN_PERSON",
          status: "COMPLETED",
        },
      });

      const pending = await prisma.siteVisit.create({
        data: {
          dealId: DEAL_1_ID,
          listingId: LISTING_ID,
          agentId: AGENT_USER.id,
          customerId: CUSTOMER_1.id,
          date: in24Hours,
          timeSlot: testSlot,
          visitType: "IN_PERSON",
          status: "PENDING",
        },
      });

      const res = await processSiteVisitReminders();
      expect(res.reminders24hSent).toBe(0);
      expect(res.reminders1hSent).toBe(0);

      await prisma.siteVisit.deleteMany({
        where: { id: { in: [cancelled.id, completed.id, pending.id] } },
      });
    });
  });

  // ==========================================
  // SCENARIO 6: Protected Cron Endpoint Auth
  // ==========================================
  describe("Scenario 6: Protected Cron Endpoint Security", () => {
    it("rejects request when authorization header or secret is missing or incorrect", () => {
      const secret = "super-secret-cron-token-12345";

      // Missing all auth in production
      expect(verifyCronAuthHeaders({ configuredSecret: secret, isProduction: true })).toBe(false);

      // Wrong bearer token
      expect(
        verifyCronAuthHeaders({
          authHeader: "Bearer wrong-token",
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(false);

      // Wrong x-cron-secret
      expect(
        verifyCronAuthHeaders({
          cronHeader: "wrong-token",
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(false);

      // Wrong query param
      expect(
        verifyCronAuthHeaders({
          querySecret: "wrong-token",
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(false);
    });

    it("accepts request when valid Bearer token, header or query secret matches", () => {
      const secret = "super-secret-cron-token-12345";

      // Valid Bearer
      expect(
        verifyCronAuthHeaders({
          authHeader: `Bearer ${secret}`,
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(true);

      // Valid x-cron-secret
      expect(
        verifyCronAuthHeaders({
          cronHeader: secret,
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(true);

      // Valid query param
      expect(
        verifyCronAuthHeaders({
          querySecret: secret,
          configuredSecret: secret,
          isProduction: true,
        })
      ).toBe(true);
    });
  });

  // ==========================================
  // SCENARIO 7: Google Maps Utilities & Integrity
  // ==========================================
  describe("Scenario 7: Google Maps Links & Fallbacks", () => {
    it("generates exact coordinate directions when coordinates are valid", () => {
      const loc = { latitude: 18.943, longitude: 72.823, addressLine: "Marine Drive", city: "Mumbai" };
      expect(hasValidCoordinates(loc)).toBe(true);
      const url = getGoogleMapsDirectionsUrl(loc);
      expect(url).toBe("https://www.google.com/maps/dir/?api=1&destination=18.943%2C72.823");
    });

    it("falls back safely to encoded address when coordinates are missing", () => {
      const loc = { addressLine: "Plot 42, Civil Lines", city: "Jaipur", state: "Rajasthan" };
      expect(hasValidCoordinates(loc)).toBe(false);
      const url = getGoogleMapsDirectionsUrl(loc);
      expect(url).toBe(
        "https://www.google.com/maps/dir/?api=1&destination=Plot%2042%2C%20Civil%20Lines%2C%20Jaipur%2C%20Rajasthan"
      );
    });

    it("returns null safely without fabricating false coordinates when location is empty", () => {
      expect(getGoogleMapsDirectionsUrl(null)).toBeNull();
      expect(getGoogleMapsDirectionsUrl({})).toBeNull();
      expect(getGoogleMapsDirectionsUrl({ latitude: 0, longitude: 0 })).toBeNull();
    });
  });
});
