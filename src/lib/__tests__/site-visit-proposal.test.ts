import { describe, it, expect } from "vitest";
import {
  encodeRescheduleProposalMessage,
  parseRescheduleProposal,
  getActiveRescheduleProposal,
  setRescheduleProposalInNotes,
  resolveRescheduleProposalInNotes,
  isDateStrictlyInPast,
  parseSiteVisitBookingMessage,
  type RescheduleProposal,
} from "../site-visit-proposal";

describe("Site Visit Reschedule Proposal Utilities", () => {
  const mockProposal: RescheduleProposal = {
    siteVisitId: 42,
    proposedDate: "2026-11-15",
    proposedTimeSlot: "10:00 AM - 11:00 AM",
    originalDate: "2026-11-10",
    originalTimeSlot: "02:00 PM - 03:00 PM",
    reason: "Agent conflict on original date",
    status: "PENDING",
    proposedAt: "2026-10-27T10:00:00.000Z",
  };

  it("encodes and decodes a proposal message", () => {
    const encoded = encodeRescheduleProposalMessage(mockProposal);
    expect(encoded).toContain("[SITE_VISIT_RESCHEDULE_PROPOSAL]");
    expect(encoded).toContain("[/SITE_VISIT_RESCHEDULE_PROPOSAL]");

    const decoded = parseRescheduleProposal(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded?.siteVisitId).toBe(42);
    expect(decoded?.proposedDate).toBe("2026-11-15");
    expect(decoded?.proposedTimeSlot).toBe("10:00 AM - 11:00 AM");
    expect(decoded?.originalDate).toBe("2026-11-10");
    expect(decoded?.status).toBe("PENDING");
  });

  it("returns null for non-proposal messages", () => {
    expect(parseRescheduleProposal("Regular deal message")).toBeNull();
    expect(parseRescheduleProposal(null)).toBeNull();
    expect(parseRescheduleProposal("")).toBeNull();
  });

  it("embeds proposal into notes and retrieves it", () => {
    const existingNotes = "Customer preferred morning visit.";
    const notesWithProposal = setRescheduleProposalInNotes(existingNotes, mockProposal);

    expect(notesWithProposal).toContain("Customer preferred morning visit.");
    expect(notesWithProposal).toContain("[Reschedule proposed by agent");

    const retrieved = getActiveRescheduleProposal(notesWithProposal);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.status).toBe("PENDING");
    expect(retrieved?.proposedDate).toBe("2026-11-15");
  });

  it("resolves proposal in notes to ACCEPTED", () => {
    const notesWithProposal = setRescheduleProposalInNotes("Initial notes", mockProposal);
    const resolvedNotes = resolveRescheduleProposalInNotes(notesWithProposal, "ACCEPTED");

    expect(resolvedNotes).toContain("[Reschedule accepted by customer");
    const retrieved = getActiveRescheduleProposal(resolvedNotes);
    expect(retrieved?.status).toBe("ACCEPTED");
  });

  it("resolves proposal in notes to DECLINED", () => {
    const notesWithProposal = setRescheduleProposalInNotes("Initial notes", mockProposal);
    const resolvedNotes = resolveRescheduleProposalInNotes(notesWithProposal, "DECLINED");

    expect(resolvedNotes).toContain("[Reschedule declined by customer");
    const retrieved = getActiveRescheduleProposal(resolvedNotes);
    expect(retrieved?.status).toBe("DECLINED");
  });

  it("correctly identifies past and future dates", () => {
    const past = new Date();
    past.setDate(past.getDate() - 3);
    expect(isDateStrictlyInPast(past)).toBe(true);

    const future = new Date();
    future.setDate(future.getDate() + 3);
    expect(isDateStrictlyInPast(future)).toBe(false);

    const today = new Date();
    expect(isDateStrictlyInPast(today)).toBe(false);
  });

  describe("parseSiteVisitBookingMessage", () => {
    it("parses an In-Person Visit booking message without notes", () => {
      const text = "Hi, I booked a In-Person Visit for 28 Oct 2026 at 10:00 AM - 11:00 AM.";
      const res = parseSiteVisitBookingMessage(text);
      expect(res).not.toBeNull();
      expect(res?.visitType).toBe("IN_PERSON");
      expect(res?.visitTypeLabel).toBe("In-Person Visit");
      expect(res?.dateStr).toBe("28 Oct 2026");
      expect(res?.timeSlot).toBe("10:00 AM - 11:00 AM");
      expect(res?.notes).toBeUndefined();
    });

    it("parses an In-Person Visit booking message with 'an' and notes", () => {
      const text =
        "Hi, I booked an In-Person Visit for 15 Nov 2026 at 02:00 PM - 03:00 PM.\n\nNotes: Please call 10 mins before arrival.";
      const res = parseSiteVisitBookingMessage(text);
      expect(res).not.toBeNull();
      expect(res?.visitType).toBe("IN_PERSON");
      expect(res?.dateStr).toBe("15 Nov 2026");
      expect(res?.timeSlot).toBe("02:00 PM - 03:00 PM");
      expect(res?.notes).toBe("Please call 10 mins before arrival.");
    });

    it("parses a Virtual Tour booking message", () => {
      const text = "Hi, I booked a Virtual Tour for 30 Oct 2026 at 11:00 AM - 12:00 PM.";
      const res = parseSiteVisitBookingMessage(text);
      expect(res).not.toBeNull();
      expect(res?.visitType).toBe("VIRTUAL");
      expect(res?.visitTypeLabel).toBe("Virtual Tour");
      expect(res?.dateStr).toBe("30 Oct 2026");
      expect(res?.timeSlot).toBe("11:00 AM - 12:00 PM");
    });

    it("returns null for non-booking messages", () => {
      expect(parseSiteVisitBookingMessage("Hello, when can I see the property?")).toBeNull();
      expect(parseSiteVisitBookingMessage("Stage changed to Viewing scheduled")).toBeNull();
      expect(parseSiteVisitBookingMessage(null)).toBeNull();
      expect(parseSiteVisitBookingMessage("")).toBeNull();
    });
  });
});

