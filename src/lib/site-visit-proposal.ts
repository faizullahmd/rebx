export interface RescheduleProposal {
  siteVisitId: number;
  proposedDate: string; // "YYYY-MM-DD"
  proposedTimeSlot: string; // e.g. "10:00 AM - 11:00 AM"
  originalDate: string; // "YYYY-MM-DD"
  originalTimeSlot: string;
  reason?: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  proposedAt: string; // ISO
  respondedAt?: string; // ISO
}

const PROPOSAL_TAG_START = "[SITE_VISIT_RESCHEDULE_PROPOSAL]";
const PROPOSAL_TAG_END = "[/SITE_VISIT_RESCHEDULE_PROPOSAL]";

/**
 * Encodes a RescheduleProposal into an event message text for DealMessage.
 */
export function encodeRescheduleProposalMessage(
  proposal: RescheduleProposal,
  humanReadableSummary?: string
): string {
  const json = JSON.stringify(proposal);
  const summary =
    humanReadableSummary ||
    `Agent proposed rescheduling the site visit to ${proposal.proposedDate} (${proposal.proposedTimeSlot}).`;
  return `${PROPOSAL_TAG_START}\n${json}\n${PROPOSAL_TAG_END}\n${summary}`;
}

/**
 * Extracts and parses a RescheduleProposal from DealMessage text or notes.
 */
export function parseRescheduleProposal(
  rawText: string | null | undefined
): RescheduleProposal | null {
  if (!rawText) return null;
  const startIdx = rawText.indexOf(PROPOSAL_TAG_START);
  const endIdx = rawText.indexOf(PROPOSAL_TAG_END);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return null;

  const jsonStr = rawText
    .slice(startIdx + PROPOSAL_TAG_START.length, endIdx)
    .trim();

  try {
    const parsed = JSON.parse(jsonStr) as RescheduleProposal;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.siteVisitId === "number" &&
      typeof parsed.proposedDate === "string" &&
      typeof parsed.proposedTimeSlot === "string" &&
      typeof parsed.status === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts active proposal from SiteVisit.notes if present.
 */
export function getActiveRescheduleProposal(
  notes: string | null | undefined
): RescheduleProposal | null {
  return parseRescheduleProposal(notes);
}

/**
 * Embeds or updates a RescheduleProposal block in SiteVisit.notes.
 */
export function setRescheduleProposalInNotes(
  existingNotes: string | null | undefined,
  proposal: RescheduleProposal
): string {
  const json = JSON.stringify(proposal);
  const block = `${PROPOSAL_TAG_START}\n${json}\n${PROPOSAL_TAG_END}`;

  const cleanNotes = removeProposalBlock(existingNotes);
  const historyLine = `[Reschedule proposed by agent on ${new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date())}: ${proposal.proposedDate} (${proposal.proposedTimeSlot})${
    proposal.reason ? ` - Reason: ${proposal.reason}` : ""
  }]`;

  return cleanNotes
    ? `${cleanNotes}\n${historyLine}\n${block}`
    : `${historyLine}\n${block}`;
}

/**
 * Resolves a proposal in notes (sets status to ACCEPTED or DECLINED), keeping audit trail.
 */
export function resolveRescheduleProposalInNotes(
  existingNotes: string | null | undefined,
  status: "ACCEPTED" | "DECLINED",
  respondedDate: Date = new Date()
): string {
  const current = parseRescheduleProposal(existingNotes);
  const cleanNotes = removeProposalBlock(existingNotes);

  const formattedDate = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(respondedDate);

  const resolutionLine = `[Reschedule ${status.toLowerCase()} by customer on ${formattedDate}]`;

  if (current) {
    const updatedProposal: RescheduleProposal = {
      ...current,
      status,
      respondedAt: respondedDate.toISOString(),
    };
    const block = `${PROPOSAL_TAG_START}\n${JSON.stringify(updatedProposal)}\n${PROPOSAL_TAG_END}`;
    return cleanNotes
      ? `${cleanNotes}\n${resolutionLine}\n${block}`
      : `${resolutionLine}\n${block}`;
  }

  return cleanNotes ? `${cleanNotes}\n${resolutionLine}` : resolutionLine;
}

/**
 * Removes the proposal block from notes, returning clean text.
 */
function removeProposalBlock(text: string | null | undefined): string {
  if (!text) return "";
  const startIdx = text.indexOf(PROPOSAL_TAG_START);
  const endIdx = text.indexOf(PROPOSAL_TAG_END);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return text.trim();

  const before = text.slice(0, startIdx).trim();
  const after = text.slice(endIdx + PROPOSAL_TAG_END.length).trim();
  return [before, after].filter(Boolean).join("\n").trim();
}

/**
 * Checks whether a date string (YYYY-MM-DD or ISO) is strictly in the past (before today).
 */
export function isDateStrictlyInPast(dateVal: string | Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return false;

  // Use local calendar year/month/date
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return target < today;
}

export interface SiteVisitBookingInfo {
  visitType: "IN_PERSON" | "VIRTUAL";
  visitTypeLabel: string;
  dateStr: string;
  timeSlot: string;
  notes?: string;
}

/**
 * Extracts and parses a customer Site Visit Booking message.
 * Pattern: "Hi, I booked a In-Person Visit for 28 Oct 2026 at 10:00 AM - 11:00 AM."
 */
export function parseSiteVisitBookingMessage(
  rawText: string | null | undefined
): SiteVisitBookingInfo | null {
  if (!rawText) return null;
  const match = rawText.match(
    /^Hi,\s*I booked an?\s+(In-Person Visit|Virtual Tour)\s+for\s+(.+?)\s+at\s+([^.\n]+)(?:\.?(?:\n\nNotes:\s*([\s\S]*))?)?$/i
  );
  if (!match) return null;
  const visitTypeLabel = match[1].trim();
  const dateStr = match[2].trim();
  const timeSlot = match[3].trim();
  const notes = match[4]?.trim() || undefined;

  return {
    visitType: visitTypeLabel.toLowerCase().includes("virtual")
      ? "VIRTUAL"
      : "IN_PERSON",
    visitTypeLabel,
    dateStr,
    timeSlot,
    notes,
  };
}

