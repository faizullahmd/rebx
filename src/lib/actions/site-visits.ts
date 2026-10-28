"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { requireDealParticipant } from "@/lib/actions/deals";
import {
  BookSiteVisitSchema,
  CancelSiteVisitSchema,
  RescheduleSiteVisitSchema,
  type BookSiteVisitInput,
  type CancelSiteVisitInput,
  type RescheduleSiteVisitInput,
} from "@/lib/validation/site-visit";
import {
  encodeRescheduleProposalMessage,
  parseRescheduleProposal,
  getActiveRescheduleProposal,
  setRescheduleProposalInNotes,
  resolveRescheduleProposalInNotes,
  isDateStrictlyInPast,
  type RescheduleProposal,
} from "@/lib/site-visit-proposal";
import { getGoogleMapsDirectionsUrl, formatDisplayAddress } from "@/lib/maps";
import {
  sendSiteVisitRequestEmail,
  sendSiteVisitConfirmedAgentEmail,
  sendSiteVisitRescheduledAgentEmail,
  sendSiteVisitCancelledAgentEmail,
} from "@/lib/email";
import { processSiteVisitReminders } from "@/lib/site-visit-reminders";

export type SiteVisitActionResult = {
  success: boolean;
  message: string;
  siteVisit?: {
    id: number;
    date: string;
    timeSlot: string;
    visitType: string;
    status: string;
  };
};

function revalidateSiteVisitPaths(dealId: number) {
  revalidatePath("/agent/dashboard/site-visits");
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/agent/dashboard/deals");
  revalidatePath("/agent/dashboard");
  revalidatePath(`/customer/dashboard/chat/${dealId}`);
  revalidatePath(`/customer/dashboard/deals/${dealId}`);
  revalidatePath("/customer/dashboard");
}

/**
 * Step 1: Customer Site Visit Booking Server Action.
 * Validates input, prevents past dates, conflicts, and duplicates,
 * records the SiteVisit in the database with PENDING status,
 * transitions deal stage to VIEWING_SCHEDULED, and logs to the conversation thread.
 */
export async function bookSiteVisit(
  dealId: number,
  rawData: BookSiteVisitInput
): Promise<SiteVisitActionResult> {
  try {
    // 1. Authenticate customer and verify deal participation
    const { user, deal, participantRole } = await requireDealParticipant(dealId);

    if (participantRole !== "CUSTOMER") {
      return {
        success: false,
        message: "Only customers can book a site visit.",
      };
    }

    // 2. Validate input
    const parsed = BookSiteVisitSchema.safeParse(rawData);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        success: false,
        message: issue?.message || "Invalid booking details.",
      };
    }

    const { date, timeSlot, visitType, notes } = parsed.data;

    // Parse date ensuring clean YYYY-MM-DD
    const dateObj = new Date(date);
    if (Number.isNaN(dateObj.getTime())) {
      return {
        success: false,
        message: "Invalid date provided.",
      };
    }

    // Normalised date for MySQL DATE column
    const normalizedDate = new Date(
      Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())
    );

    // 3. Prevent conflicting / duplicate appointments
    // a) Check if customer already has a pending or confirmed site visit on this date & timeSlot for this deal
    const existingCustomerVisit = await prisma.siteVisit.findFirst({
      where: {
        dealId,
        date: normalizedDate,
        timeSlot,
        status: { in: ["PENDING", "CONFIRMED"] },
      },
    });

    if (existingCustomerVisit) {
      return {
        success: false,
        message:
          "You already have a site visit booked for this property at this date and time slot.",
      };
    }

    // b) Check if the listing agent already has a confirmed appointment at this slot on the same date
    const agentConflict = await prisma.siteVisit.findFirst({
      where: {
        agentId: deal.agentId,
        date: normalizedDate,
        timeSlot,
        status: "CONFIRMED",
      },
    });

    if (agentConflict) {
      return {
        success: false,
        message:
          "This time slot is already confirmed with the agent. Please choose a different slot.",
      };
    }

    // 4. Format visit type label for notifications & messages
    const visitTypeLabel = visitType === "VIRTUAL" ? "Virtual Tour" : "In-Person Visit";
    const formattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(dateObj);

    // 5. Database transaction
    const [siteVisit] = await prisma.$transaction(async (tx) => {
      // Create SiteVisit record
      const sv = await tx.siteVisit.create({
        data: {
          dealId,
          listingId: deal.listingId,
          customerId: user.id,
          agentId: deal.agentId,
          date: normalizedDate,
          timeSlot,
          visitType,
          status: "PENDING",
          notes: notes && notes.trim().length > 0 ? notes.trim() : null,
        },
      });

      // Update deal stage to VIEWING_SCHEDULED if not already further along
      const currentStage = deal.stage;
      const canUpdateStage =
        currentStage === "NEW" || currentStage === "CONTACTED";

      if (canUpdateStage) {
        await tx.deal.update({
          where: { id: dealId },
          data: {
            stage: "VIEWING_SCHEDULED",
            updatedAt: new Date(),
          },
        });

        // Add stage transition event to thread
        await tx.dealMessage.create({
          data: {
            dealId,
            senderRole: "SYSTEM",
            type: "EVENT",
            text: "Stage changed to Viewing scheduled",
          },
        });
      }

      // Add conversation record showing customer requested visit
      await tx.dealMessage.create({
        data: {
          dealId,
          senderRole: "CUSTOMER",
          senderId: user.id,
          type: "MESSAGE",
          text: `Hi, I booked a ${visitTypeLabel} for ${formattedDate} at ${timeSlot}.${
            notes && notes.trim() ? `\n\nNotes: ${notes.trim()}` : ""
          }`,
          agentReadAt: null,
          customerReadAt: new Date(),
        },
      });

      return [sv];
    });

    revalidateSiteVisitPaths(dealId);

    // 6. Notify assigned listing agent about the new site visit request
    try {
      const listing = await prisma.listing.findUnique({
        where: { id: deal.listingId },
        include: {
          agent: { select: { id: true, name: true, email: true } },
        },
      });

      const agentEmail = deal.agent?.email || listing?.agent?.email;
      if (agentEmail) {
        const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        const addressString = listing ? formatDisplayAddress(listing) : "";
        const directionsUrl = listing ? getGoogleMapsDirectionsUrl(listing) : "";

        sendSiteVisitRequestEmail(agentEmail, {
          agentName: deal.agent?.name || listing?.agent?.name || "Agent",
          listingTitle: listing?.title || deal.listing.title,
          contactName: deal.contactName || user.name || "Client",
          contactEmail: deal.contactEmail || user.email || "",
          contactPhone: deal.contactPhone || null,
          visitDate: formattedDate,
          visitTime: timeSlot,
          timeSlot: timeSlot,
          visitType: visitTypeLabel,
          propertyAddress: addressString,
          directionsUrl: directionsUrl,
          message: notes && notes.trim().length > 0 ? notes.trim() : null,
          dealUrl: `${siteUrl}/agent/dashboard/deals/${dealId}`,
          listingUrl: listing ? `${siteUrl}/listings/${listing.slug}` : undefined,
        }).catch((err) => console.error("[Site Visit Request Email Error]:", err));
      }
    } catch (emailErr) {
      console.error("[Site Visit Request Email Dispatch Error]:", emailErr);
    }

    return {
      success: true,
      message: `Your ${visitTypeLabel.toLowerCase()} has been booked for ${formattedDate} at ${timeSlot}.`,
      siteVisit: {
        id: siteVisit.id,
        date: date,
        timeSlot: siteVisit.timeSlot,
        visitType: siteVisit.visitType,
        status: siteVisit.status,
      },
    };
  } catch (error) {
    console.error("Error booking site visit:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while booking the site visit.",
    };
  }
}

/**
 * Step 2: Agent Action — Confirm Visit.
 * Validates agent permissions, rechecks booking status and conflicts,
 * updates status to CONFIRMED, and logs to the conversation thread.
 */
export async function confirmSiteVisit(siteVisitId: number): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch site visit
    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      include: {
        deal: true,
        listing: true,
        agent: true,
        customer: true,
      },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    // 2. Strict authorization: must be the assigned agent or admin
    if (user.role !== "ADMIN" && siteVisit.agentId !== user.id) {
      return {
        success: false,
        message: "You are not authorized to manage this site visit.",
      };
    }

    // 3. Re-check status: must be PENDING
    if (siteVisit.status === "CONFIRMED") {
      return { success: false, message: "This site visit is already confirmed." };
    }
    if (siteVisit.status === "CANCELLED") {
      return {
        success: false,
        message: "Cannot confirm a visit that has been cancelled.",
      };
    }
    if (siteVisit.status === "COMPLETED") {
      return {
        success: false,
        message: "This site visit has already been completed.",
      };
    }

    // 4. Check for conflicting confirmed appointments for this agent at the same slot
    const agentConflict = await prisma.siteVisit.findFirst({
      where: {
        agentId: user.id,
        date: siteVisit.date,
        timeSlot: siteVisit.timeSlot,
        status: "CONFIRMED",
        id: { not: siteVisitId },
      },
    });

    if (agentConflict) {
      return {
        success: false,
        message:
          "You already have another confirmed appointment at this date and time slot. Please reschedule before confirming.",
      };
    }

    const formattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(new Date(siteVisit.date));
    const visitTypeLabel =
      siteVisit.visitType === "VIRTUAL" ? "Virtual Tour" : "In-Person Visit";

    // 5. Update transaction
    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          status: "CONFIRMED",
          updatedAt: new Date(),
        },
      });

      // Post update in deal conversation thread
      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "AGENT",
          senderId: user.id,
          type: "EVENT",
          text: `Site visit confirmed by agent for ${formattedDate} (${siteVisit.timeSlot}) - ${visitTypeLabel}.`,
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    // Send confirmation email to agent using new email template
    if (siteVisit.agent?.email) {
      const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const addressString = formatDisplayAddress(siteVisit.listing);
      const directionsUrl = getGoogleMapsDirectionsUrl(siteVisit.listing);

      sendSiteVisitConfirmedAgentEmail(siteVisit.agent.email, {
        agentName: siteVisit.agent.name || "Agent",
        clientName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        contactName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        clientEmail: siteVisit.deal.contactEmail || siteVisit.customer?.email,
        clientPhone: siteVisit.deal.contactPhone || null,
        listingTitle: siteVisit.listing.title,
        propertyAddress: addressString,
        visitDate: formattedDate,
        timeSlot: siteVisit.timeSlot,
        visitTime: siteVisit.timeSlot,
        visitType: visitTypeLabel,
        dealUrl: `${siteUrl}/agent/dashboard/deals/${siteVisit.dealId}`,
        directionsUrl,
      }).catch((err) => console.error("[Site Visit Confirmation Email Error]:", err));
    }

    // Automatically evaluate reminder windows so near-term appointments (e.g. today in 1-2 hours) get reminded immediately
    processSiteVisitReminders().catch((err) =>
      console.error("[Post-Confirmation Reminder Check Error]:", err)
    );

    return {
      success: true,
      message: `Site visit for ${formattedDate} (${siteVisit.timeSlot}) confirmed successfully.`,
      siteVisit: {
        id: siteVisit.id,
        date: siteVisit.date.toISOString(),
        timeSlot: siteVisit.timeSlot,
        visitType: siteVisit.visitType,
        status: "CONFIRMED",
      },
    };
  } catch (error) {
    console.error("Error confirming site visit:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while confirming the site visit.",
    };
  }
}

/**
 * Step 2: Agent Action — Cancel Visit.
 * Validates agent permissions, checks eligibility, updates status to CANCELLED,
 * records cancellation reason in notes, and posts event to conversation thread.
 */
export async function cancelSiteVisit(
  siteVisitId: number,
  rawData?: CancelSiteVisitInput
): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch site visit
    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      include: {
        deal: true,
        listing: true,
        agent: true,
        customer: true,
      },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    // 2. Strict authorization: must be the assigned agent or admin
    if (user.role !== "ADMIN" && siteVisit.agentId !== user.id) {
      return {
        success: false,
        message: "You are not authorized to cancel this site visit.",
      };
    }

    // 3. Status checks: cannot cancel already CANCELLED or COMPLETED visits
    if (siteVisit.status === "CANCELLED") {
      return { success: false, message: "This site visit is already cancelled." };
    }
    if (siteVisit.status === "COMPLETED") {
      return {
        success: false,
        message: "Cannot cancel a completed site visit.",
      };
    }

    // 4. Validate input
    const parsed = CancelSiteVisitSchema.safeParse(rawData || {});
    const reason = parsed.success && parsed.data.reason ? parsed.data.reason.trim() : "";

    const formattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(new Date(siteVisit.date));

    // Append cancellation entry to notes
    const cancelNoteEntry = `[Cancelled by agent on ${new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date())}]${reason ? ` Reason: ${reason}` : ""}`;

    const updatedNotes = siteVisit.notes
      ? `${siteVisit.notes}\n${cancelNoteEntry}`
      : cancelNoteEntry;

    // 5. Update transaction
    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          status: "CANCELLED",
          notes: updatedNotes,
          updatedAt: new Date(),
        },
      });

      // Post update in deal conversation thread
      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "AGENT",
          senderId: user.id,
          type: "EVENT",
          text: `Site visit for ${formattedDate} (${siteVisit.timeSlot}) was cancelled by agent.${
            reason ? ` Reason: ${reason}` : ""
          }`,
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    if (siteVisit.agent?.email) {
      const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const addressString = formatDisplayAddress(siteVisit.listing);
      sendSiteVisitCancelledAgentEmail(siteVisit.agent.email, {
        agentName: siteVisit.agent.name || "Agent",
        clientName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        contactName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        listingTitle: siteVisit.listing.title,
        propertyAddress: addressString,
        visitDate: formattedDate,
        timeSlot: siteVisit.timeSlot,
        visitTime: siteVisit.timeSlot,
        updatedBy: user.role === "CUSTOMER" ? (siteVisit.deal.contactName || "Client") : (siteVisit.agent.name || "Agent"),
        showingReason: reason || undefined,
        dealUrl: `${siteUrl}/agent/dashboard/deals/${siteVisit.dealId}`,
      }).catch((err) => console.error("[Site Visit Cancel Email Error]:", err));
    }

    return {
      success: true,
      message: "Site visit has been cancelled.",
      siteVisit: {
        id: siteVisit.id,
        date: siteVisit.date.toISOString(),
        timeSlot: siteVisit.timeSlot,
        visitType: siteVisit.visitType,
        status: "CANCELLED",
      },
    };
  } catch (error) {
    console.error("Error cancelling site visit:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while cancelling the site visit.",
    };
  }
}

/**
 * Step 2: Agent Action — Reschedule Visit.
 * Allows agents to reschedule eligible pending or confirmed appointments.
 * Preserves the booking record, validates slot availability, sets status to PENDING
 * (to avoid misleading confirmed status), and logs to conversation thread.
 */
export async function rescheduleSiteVisit(
  siteVisitId: number,
  rawData: RescheduleSiteVisitInput
): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch site visit
    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      include: {
        deal: true,
        listing: true,
        agent: true,
        customer: true,
      },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    // 2. Strict authorization: must be the assigned agent, customer, or admin
    const isAgent = user.role === "ADMIN" || siteVisit.agentId === user.id;
    const isCustomer = siteVisit.customerId === user.id;
    if (!isAgent && !isCustomer) {
      return {
        success: false,
        message: "You are not authorized to reschedule this site visit.",
      };
    }

    // 3. Status checks: cannot reschedule CANCELLED or COMPLETED visits
    if (siteVisit.status === "CANCELLED") {
      return {
        success: false,
        message: "Cannot reschedule a cancelled site visit. Please book a new one.",
      };
    }
    if (siteVisit.status === "COMPLETED") {
      return {
        success: false,
        message: "Cannot reschedule a completed site visit.",
      };
    }

    // 4. Validate input
    const parsed = RescheduleSiteVisitSchema.safeParse(rawData);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        success: false,
        message: issue?.message || "Invalid reschedule details.",
      };
    }

    const { date, timeSlot, reason } = parsed.data;

    // Parse date ensuring clean YYYY-MM-DD
    const dateObj = new Date(date);
    if (Number.isNaN(dateObj.getTime())) {
      return { success: false, message: "Invalid date provided." };
    }

    const normalizedNewDate = new Date(
      Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate())
    );

    // 5. Conflict checks
    // a) Check if agent has another confirmed appointment at the new slot
    const agentConflict = await prisma.siteVisit.findFirst({
      where: {
        agentId: siteVisit.agentId,
        date: normalizedNewDate,
        timeSlot,
        status: "CONFIRMED",
        id: { not: siteVisitId },
      },
    });

    if (agentConflict) {
      return {
        success: false,
        message: isCustomer
          ? "The agent already has another confirmed appointment at this date and time slot. Please choose another slot."
          : "You already have another confirmed appointment at the requested date and time slot.",
      };
    }

    // b) Check if customer already has a pending/confirmed visit on this slot for this deal
    const customerConflict = await prisma.siteVisit.findFirst({
      where: {
        dealId: siteVisit.dealId,
        date: normalizedNewDate,
        timeSlot,
        status: { in: ["PENDING", "CONFIRMED"] },
        id: { not: siteVisitId },
      },
    });

    if (customerConflict) {
      return {
        success: false,
        message:
          "There is already an active site visit booked for this property at this date and time.",
      };
    }

    const oldFormattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(new Date(siteVisit.date));

    const newFormattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(dateObj);

    // If customer is rescheduling:
    if (isCustomer) {
      const rescheduleNoteEntry = `[Rescheduled by customer from ${oldFormattedDate} (${siteVisit.timeSlot}) to ${newFormattedDate} (${timeSlot})]${
        reason && reason.trim() ? ` Reason: ${reason.trim()}` : ""
      }`;

      const updatedNotes = siteVisit.notes
        ? `${siteVisit.notes}\n${rescheduleNoteEntry}`
        : rescheduleNoteEntry;

      await prisma.$transaction(async (tx) => {
        await tx.siteVisit.update({
          where: { id: siteVisitId },
          data: {
            date: normalizedNewDate,
            timeSlot,
            status: "PENDING",
            notes: updatedNotes,
            updatedAt: new Date(),
            reminded24hAt: null,
            reminded1hAt: null,
          },
        });

        await tx.dealMessage.create({
          data: {
            dealId: siteVisit.dealId,
            senderRole: "CUSTOMER",
            senderId: user.id,
            type: "EVENT",
            text: `Customer requested to reschedule the site visit to ${newFormattedDate} (${timeSlot}). Awaiting agent confirmation.${
              reason && reason.trim() ? ` Reason: ${reason.trim()}` : ""
            }`,
          },
        });
      });

      revalidateSiteVisitPaths(siteVisit.dealId);

      if (siteVisit.agent?.email) {
        const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        const addressString = formatDisplayAddress(siteVisit.listing);
        const directionsUrl = getGoogleMapsDirectionsUrl(siteVisit.listing);
        sendSiteVisitRescheduledAgentEmail(siteVisit.agent.email, {
          agentName: siteVisit.agent.name || "Agent",
          clientName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
          contactName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
          listingTitle: siteVisit.listing.title,
          propertyAddress: addressString,
          directionsUrl,
          visitDate: newFormattedDate,
          timeSlot,
          visitTime: timeSlot,
          updatedBy: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
          showingReason: reason && reason.trim() ? reason.trim() : undefined,
          dealUrl: `${siteUrl}/agent/dashboard/deals/${siteVisit.dealId}`,
        }).catch((err) => console.error("[Site Visit Reschedule Email Error]:", err));
      }

      return {
        success: true,
        message: `Site visit rescheduled to ${newFormattedDate} (${timeSlot}). Confirmation by agent is pending.`,
        siteVisit: {
          id: siteVisit.id,
          date: normalizedNewDate.toISOString(),
          timeSlot,
          visitType: siteVisit.visitType,
          status: "PENDING",
        },
      };
    }

    // If the appointment is already CONFIRMED (by agent):
    // Create a pending reschedule proposal and preserve the original confirmed appointment!
    if (siteVisit.status === "CONFIRMED") {
      const activeProposal = getActiveRescheduleProposal(siteVisit.notes);
      if (activeProposal && activeProposal.status === "PENDING") {
        return {
          success: false,
          message:
            "A reschedule proposal is already pending customer response. Please wait for the client to accept or decline.",
        };
      }

      const proposal: RescheduleProposal = {
        siteVisitId: siteVisit.id,
        proposedDate: date,
        proposedTimeSlot: timeSlot,
        originalDate: siteVisit.date.toISOString().split("T")[0],
        originalTimeSlot: siteVisit.timeSlot,
        reason: reason && reason.trim() ? reason.trim() : undefined,
        status: "PENDING",
        proposedAt: new Date().toISOString(),
      };

      const updatedNotes = setRescheduleProposalInNotes(siteVisit.notes, proposal);
      const encodedMsg = encodeRescheduleProposalMessage(
        proposal,
        `Agent proposed rescheduling the site visit from ${oldFormattedDate} (${siteVisit.timeSlot}) to ${newFormattedDate} (${timeSlot}).${
          reason && reason.trim() ? ` Reason: ${reason.trim()}` : ""
        } The original confirmed appointment is preserved until accepted.`
      );

      await prisma.$transaction(async (tx) => {
        await tx.siteVisit.update({
          where: { id: siteVisitId },
          data: {
            notes: updatedNotes,
            updatedAt: new Date(),
            // Preserves date, timeSlot, and status="CONFIRMED"
          },
        });

        await tx.dealMessage.create({
          data: {
            dealId: siteVisit.dealId,
            senderRole: "AGENT",
            senderId: user.id,
            type: "EVENT",
            text: encodedMsg,
          },
        });
      });

      revalidateSiteVisitPaths(siteVisit.dealId);

      return {
        success: true,
        message: `Reschedule request sent to client for ${newFormattedDate} (${timeSlot}). Original appointment is preserved until approved.`,
        siteVisit: {
          id: siteVisit.id,
          date: siteVisit.date.toISOString(),
          timeSlot: siteVisit.timeSlot,
          visitType: siteVisit.visitType,
          status: siteVisit.status,
        },
      };
    }

    // Otherwise, for PENDING appointments:
    const rescheduleNoteEntry = `[Rescheduled by agent from ${oldFormattedDate} (${siteVisit.timeSlot}) to ${newFormattedDate} (${timeSlot})]${
      reason && reason.trim() ? ` Reason: ${reason.trim()}` : ""
    }`;

    const updatedNotes = siteVisit.notes
      ? `${siteVisit.notes}\n${rescheduleNoteEntry}`
      : rescheduleNoteEntry;

    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          date: normalizedNewDate,
          timeSlot,
          status: "PENDING",
          notes: updatedNotes,
          updatedAt: new Date(),
        },
      });

      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "AGENT",
          senderId: user.id,
          type: "EVENT",
          text: `Site visit updated by agent to ${newFormattedDate} (${timeSlot}). Status is Pending.${
            reason && reason.trim() ? ` Reason: ${reason.trim()}` : ""
          }`,
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    return {
      success: true,
      message: `Site visit successfully rescheduled to ${newFormattedDate} (${timeSlot}).`,
      siteVisit: {
        id: siteVisit.id,
        date: date,
        timeSlot: timeSlot,
        visitType: siteVisit.visitType,
        status: "PENDING",
      },
    };
  } catch (error) {
    console.error("Error rescheduling site visit:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while rescheduling the site visit.",
    };
  }
}

/**
 * Step 3: Customer Action — Accept Reschedule Proposal.
 * Verifies customer ownership, rechecks agent availability conflicts,
 * updates appointment to the proposed date and slot, sets status to CONFIRMED,
 * and notifies both dashboards and the conversation thread.
 */
export async function acceptRescheduleProposal(
  siteVisitId: number,
  messageId?: number
): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch site visit
    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      include: {
        deal: true,
        listing: true,
        agent: true,
        customer: true,
      },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    // 2. Strict authorization: customer must own the deal or site visit
    const isOwner =
      siteVisit.customerId === user.id ||
      siteVisit.deal.customerId === user.id ||
      siteVisit.deal.contactEmail.toLowerCase() === user.email.toLowerCase();

    if (!isOwner && user.role !== "ADMIN") {
      return {
        success: false,
        message: "You are not authorized to respond to this site visit proposal.",
      };
    }

    // 3. Inspect active proposal
    const proposal = getActiveRescheduleProposal(siteVisit.notes);
    if (!proposal || proposal.status !== "PENDING") {
      return {
        success: false,
        message:
          "This reschedule request is no longer pending or has already been responded to.",
      };
    }

    // 4. Validate that proposed date is not in the past
    if (isDateStrictlyInPast(proposal.proposedDate)) {
      return {
        success: false,
        message:
          "The proposed reschedule date has already passed. Please coordinate via chat or request a new visit.",
      };
    }

    const proposedDateObj = new Date(proposal.proposedDate);
    const normalizedNewDate = new Date(
      Date.UTC(
        proposedDateObj.getFullYear(),
        proposedDateObj.getMonth(),
        proposedDateObj.getDate()
      )
    );

    // 5. Re-check agent conflict at the proposed slot
    const agentConflict = await prisma.siteVisit.findFirst({
      where: {
        agentId: siteVisit.agentId,
        date: normalizedNewDate,
        timeSlot: proposal.proposedTimeSlot,
        status: "CONFIRMED",
        id: { not: siteVisitId },
      },
    });

    if (agentConflict) {
      return {
        success: false,
        message:
          "The agent already has another confirmed appointment at this proposed time. Please ask the agent for an alternative slot.",
      };
    }

    const formattedNewDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(proposedDateObj);

    const updatedNotes = resolveRescheduleProposalInNotes(
      siteVisit.notes,
      "ACCEPTED"
    );

    // 6. Database transaction: update appointment and thread
    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          date: normalizedNewDate,
          timeSlot: proposal.proposedTimeSlot,
          status: "CONFIRMED",
          notes: updatedNotes,
          reminded24hAt: null, // Reset so reminders are triggered for the new confirmed date
          reminded1hAt: null,
          updatedAt: new Date(),
        },
      });

      // Update proposal message status if messageId was provided
      if (messageId) {
        const msg = await tx.dealMessage.findUnique({ where: { id: messageId } });
        if (msg) {
          const currentProp = parseRescheduleProposal(msg.text);
          if (currentProp) {
            const resolvedProp: RescheduleProposal = {
              ...currentProp,
              status: "ACCEPTED",
              respondedAt: new Date().toISOString(),
            };
            await tx.dealMessage.update({
              where: { id: messageId },
              data: {
                text: encodeRescheduleProposalMessage(
                  resolvedProp,
                  `Reschedule proposal accepted by customer for ${formattedNewDate} (${proposal.proposedTimeSlot}).`
                ),
              },
            });
          }
        }
      }

      // Add audit event in conversation thread
      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "CUSTOMER",
          senderId: user.id,
          type: "EVENT",
          text: `Site visit reschedule accepted by customer. Confirmed for ${formattedNewDate} at ${proposal.proposedTimeSlot}.`,
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    // Send confirmation email to agent for rescheduled confirmation
    if (siteVisit.agent?.email) {
      const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const addressString = formatDisplayAddress(siteVisit.listing);
      const directionsUrl = getGoogleMapsDirectionsUrl(siteVisit.listing);
      const visitTypeLabel =
        siteVisit.visitType === "VIRTUAL" ? "Virtual Tour" : "In-Person Visit";

      sendSiteVisitConfirmedAgentEmail(siteVisit.agent.email, {
        agentName: siteVisit.agent.name || "Agent",
        clientName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        contactName: siteVisit.deal.contactName || siteVisit.customer?.name || "Client",
        clientEmail: siteVisit.deal.contactEmail || siteVisit.customer?.email,
        clientPhone: siteVisit.deal.contactPhone || null,
        listingTitle: siteVisit.listing.title,
        propertyAddress: addressString,
        visitDate: formattedNewDate,
        timeSlot: proposal.proposedTimeSlot,
        visitTime: proposal.proposedTimeSlot,
        visitType: visitTypeLabel,
        dealUrl: `${siteUrl}/agent/dashboard/deals/${siteVisit.dealId}`,
        directionsUrl,
      }).catch((err) => console.error("[Site Visit Reschedule Confirmation Email Error]:", err));
    }

    // Automatically evaluate reminder windows so near-term rescheduled appointments get reminded immediately
    processSiteVisitReminders().catch((err) =>
      console.error("[Post-Reschedule-Accept Reminder Check Error]:", err)
    );

    return {
      success: true,
      message: `Reschedule accepted! Site visit confirmed for ${formattedNewDate} at ${proposal.proposedTimeSlot}.`,
      siteVisit: {
        id: siteVisit.id,
        date: proposal.proposedDate,
        timeSlot: proposal.proposedTimeSlot,
        visitType: siteVisit.visitType,
        status: "CONFIRMED",
      },
    };
  } catch (error) {
    console.error("Error accepting reschedule proposal:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while accepting the reschedule proposal.",
    };
  }
}

/**
 * Step 3: Customer Action — Decline Reschedule Proposal.
 * Records the declined proposal in audit history.
 * Preserves the original confirmed appointment if still valid;
 * if original appointment has expired, marks as cancelled so users are not falsely shown a confirmed booking.
 */
export async function declineRescheduleProposal(
  siteVisitId: number,
  messageId?: number,
  declineReason?: string
): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    // 1. Fetch site visit
    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
      include: {
        deal: true,
        listing: { select: { title: true } },
      },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    // 2. Strict authorization
    const isOwner =
      siteVisit.customerId === user.id ||
      siteVisit.deal.customerId === user.id ||
      siteVisit.deal.contactEmail.toLowerCase() === user.email.toLowerCase();

    if (!isOwner && user.role !== "ADMIN") {
      return {
        success: false,
        message: "You are not authorized to respond to this site visit proposal.",
      };
    }

    // 3. Inspect active proposal
    const proposal = getActiveRescheduleProposal(siteVisit.notes);
    if (!proposal || proposal.status !== "PENDING") {
      return {
        success: false,
        message:
          "This reschedule request is no longer pending or has already been responded to.",
      };
    }

    // 4. Check if the original confirmed appointment is still valid (not in past)
    const isOriginalValid = !isDateStrictlyInPast(siteVisit.date);
    const origFormattedDate = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(new Date(siteVisit.date));

    let updatedNotes = resolveRescheduleProposalInNotes(
      siteVisit.notes,
      "DECLINED"
    );

    if (declineReason && declineReason.trim()) {
      updatedNotes += `\n[Customer decline note: ${declineReason.trim()}]`;
    }

    let nextStatus = siteVisit.status;
    let eventText = "";

    if (isOriginalValid) {
      // Original appointment is still valid and in the future: preserve CONFIRMED status
      eventText = `Customer declined the reschedule proposal.${
        declineReason && declineReason.trim()
          ? ` Reason: ${declineReason.trim()}.`
          : ""
      } The original confirmed appointment on ${origFormattedDate} (${siteVisit.timeSlot}) remains active.`;
    } else {
      // Original appointment date has passed: cannot remain falsely confirmed
      nextStatus = "CANCELLED";
      updatedNotes += "\n[Original appointment date has passed; new booking required]";
      eventText = `Customer declined the reschedule proposal.${
        declineReason && declineReason.trim()
          ? ` Reason: ${declineReason.trim()}.`
          : ""
      } Since the original appointment date (${origFormattedDate}) has already passed, a new booking is required.`;
    }

    // 5. Database transaction
    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          status: nextStatus,
          notes: updatedNotes,
          updatedAt: new Date(),
        },
      });

      // Update proposal message status if messageId was provided
      if (messageId) {
        const msg = await tx.dealMessage.findUnique({ where: { id: messageId } });
        if (msg) {
          const currentProp = parseRescheduleProposal(msg.text);
          if (currentProp) {
            const resolvedProp: RescheduleProposal = {
              ...currentProp,
              status: "DECLINED",
              respondedAt: new Date().toISOString(),
            };
            await tx.dealMessage.update({
              where: { id: messageId },
              data: {
                text: encodeRescheduleProposalMessage(
                  resolvedProp,
                  `Reschedule proposal declined by customer.${
                    isOriginalValid
                      ? ` Original appointment on ${origFormattedDate} (${siteVisit.timeSlot}) kept.`
                      : " Original date has passed; new booking required."
                  }`
                ),
              },
            });
          }
        }
      }

      // Add audit event in conversation thread
      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "CUSTOMER",
          senderId: user.id,
          type: "EVENT",
          text: eventText,
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    return {
      success: true,
      message: isOriginalValid
        ? `Reschedule proposal declined. Your original appointment on ${origFormattedDate} (${siteVisit.timeSlot}) remains confirmed.`
        : "Reschedule proposal declined. Since the original appointment date has passed, please book a new visit.",
      siteVisit: {
        id: siteVisit.id,
        date: siteVisit.date.toISOString(),
        timeSlot: siteVisit.timeSlot,
        visitType: siteVisit.visitType,
        status: nextStatus,
      },
    };
  } catch (error) {
    console.error("Error declining reschedule proposal:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while declining the reschedule proposal.",
    };
  }
}

/**
 * Step 2: Agent Action — Mark Visit Completed.
 * For confirmed visits whose inspection has taken place.
 */
export async function completeSiteVisit(siteVisitId: number): Promise<SiteVisitActionResult> {
  try {
    const user = await requireUser();

    const siteVisit = await prisma.siteVisit.findUnique({
      where: { id: siteVisitId },
    });

    if (!siteVisit) {
      return { success: false, message: "Site visit not found." };
    }

    if (user.role !== "ADMIN" && siteVisit.agentId !== user.id) {
      return {
        success: false,
        message: "You are not authorized to complete this site visit.",
      };
    }

    if (siteVisit.status !== "CONFIRMED") {
      return {
        success: false,
        message: "Only confirmed site visits can be marked as completed.",
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.siteVisit.update({
        where: { id: siteVisitId },
        data: {
          status: "COMPLETED",
          updatedAt: new Date(),
        },
      });

      await tx.dealMessage.create({
        data: {
          dealId: siteVisit.dealId,
          senderRole: "AGENT",
          senderId: user.id,
          type: "EVENT",
          text: "Site visit marked as completed.",
        },
      });
    });

    revalidateSiteVisitPaths(siteVisit.dealId);

    return {
      success: true,
      message: "Site visit marked as completed.",
      siteVisit: {
        id: siteVisit.id,
        date: siteVisit.date.toISOString(),
        timeSlot: siteVisit.timeSlot,
        visitType: siteVisit.visitType,
        status: "COMPLETED",
      },
    };
  } catch (error) {
    console.error("Error completing site visit:", error);
    return {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred while completing the site visit.",
    };
  }
}

