"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatListingPrice } from "@/lib/price";
import {
  sendBookingAdvancePaidEmail,
  sendBookingAdvanceUnmarkedEmail,
} from "@/lib/email";
import {
  SaveAdvanceSchema,
  UnmarkAdvanceSchema,
  MarkAdvancePaidSchema,
  type SaveAdvanceInput,
  type UnmarkAdvanceInput,
} from "@/lib/validation/advance";

function revalidateAdvancePaths(dealId: number) {
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/agent/dashboard/deals");
  revalidatePath(`/customer/dashboard/deals/${dealId}`);
  revalidatePath("/customer/dashboard/deals");
  revalidatePath(`/customer/dashboard/chat/${dealId}`);
  revalidatePath("/customer/dashboard");
}

/**
 * Verifies that the current user is an AGENT (or ADMIN) who owns this deal,
 * and that the deal has an accepted offer.
 */
async function verifyAgentDealOwnership(dealId: number) {
  const user = await requireUser();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          price: true,
          currency: true,
          developerId: true,
          agentId: true,
        },
      },
      booking: {
        include: {
          advance: true,
        },
      },
      messages: {
        where: { type: "OFFER", offerStatus: "ACCEPTED" },
        take: 1,
      },
      customer: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const isOwner = user.role === "ADMIN" || deal.agentId === user.id || deal.listing.agentId === user.id;
  if (!isOwner) {
    throw new Error("You are not authorized to modify advance bookings for this deal.");
  }

  // Must have an accepted offer or be under contract / closed won
  const hasAcceptedOffer =
    deal.stage === "UNDER_CONTRACT" ||
    deal.stage === "CLOSED_WON" ||
    deal.messages.length > 0;

  if (!hasAcceptedOffer) {
    throw new Error("Advance booking is only available after an offer has been accepted.");
  }

  return { user, deal };
}

/**
 * Creates or updates an advance booking for a deal.
 * If Booking does not exist yet, creates it following the existing booking creation pattern.
 */
export async function saveBookingAdvance(
  dealId: number,
  input: SaveAdvanceInput
) {
  const { user, deal } = await verifyAgentDealOwnership(dealId);

  const parsed = SaveAdvanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid input.",
    };
  }

  const { amount, markAsPaid, paidAt, notes, editReason } = parsed.data;

  // Determine current effective sale amount
  let booking = deal.booking;
  let saleAmount = booking?.saleAmount != null ? Number(booking.saleAmount) : null;

  if (saleAmount == null || saleAmount <= 0) {
    if (deal.offerAmount != null && Number(deal.offerAmount) > 0) {
      saleAmount = Number(deal.offerAmount);
    } else if (deal.listing.price != null && Number(deal.listing.price) > 0) {
      saleAmount = Number(deal.listing.price);
    }
  }

  if (!saleAmount || saleAmount <= 0) {
    return {
      success: false,
      message: "A sale amount is required before recording an advance booking.",
    };
  }

  if (amount <= 0) {
    return { success: false, message: "Advance amount must be greater than 0." };
  }

  if (amount > saleAmount) {
    return {
      success: false,
      message: "Advance amount cannot exceed the total agreed sale amount.",
    };
  }

  // Calculate percent used (e.g. 10.00)
  const percentUsed = Math.round((amount / saleAmount) * 100 * 100) / 100;
  const currency =
    !deal.listing.currency || deal.listing.currency === "USD" ? "INR" : deal.listing.currency;

  // Validate payment date if marked as paid
  let resolvedPaidAt: Date | null = null;
  if (markAsPaid) {
    resolvedPaidAt = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(resolvedPaidAt.getTime())) {
      return { success: false, message: "Invalid payment date." };
    }
    // Prevent future dates
    const now = new Date();
    if (resolvedPaidAt > now) {
      return { success: false, message: "Payment date cannot be in the future." };
    }
  }

  const existingAdvance = booking?.advance;

  // If already paid and amount changed, editReason is required
  if (
    existingAdvance &&
    existingAdvance.status === "PAID" &&
    Number(existingAdvance.amount) !== amount &&
    (!editReason || editReason.trim().length < 5)
  ) {
    return {
      success: false,
      message: "A reason of at least 5 characters is required when editing a paid advance amount.",
    };
  }

  let becamePaidNow = false;

  await prisma.$transaction(async (tx) => {
    // Follow existing booking creation pattern if Booking record doesn't exist yet
    if (!booking) {
      const isDeveloperDeal = deal.listing.developerId !== null;
      booking = await tx.booking.create({
        data: {
          dealId: deal.id,
          saleAmount,
          status: isDeveloperDeal ? "PENDING_CONFIRMATION" : "CONFIRMED",
          ...(isDeveloperDeal ? {} : { confirmedAt: new Date() }),
        },
        include: {
          advance: true,
        },
      });

      // System event for booking details added if newly created
      await tx.dealMessage.create({
        data: {
          dealId: deal.id,
          senderRole: "SYSTEM",
          type: "EVENT",
          text: "Booking details added",
        },
      });
    }

    if (!existingAdvance) {
      // Create new BookingAdvance
      const created = await tx.bookingAdvance.create({
        data: {
          bookingId: booking.id,
          dealId: deal.id,
          amount,
          percentUsed,
          currency,
          status: markAsPaid ? "PAID" : "PENDING",
          paidAt: resolvedPaidAt,
          notes: notes || null,
          markedPaidBy: markAsPaid ? user.id : null,
        },
      });

      await tx.bookingAdvanceHistory.create({
        data: {
          advanceId: created.id,
          action: "CREATED",
          oldValue: null,
          newValue: JSON.stringify({
            amount,
            percentUsed,
            status: markAsPaid ? "PAID" : "PENDING",
            paidAt: resolvedPaidAt?.toISOString() || null,
          }),
          reason: null,
          actorId: user.id,
        },
      });

      if (markAsPaid) {
        becamePaidNow = true;
        // System event message
        const formattedAmount = formatListingPrice(amount, currency);
        await tx.dealMessage.create({
          data: {
            dealId: deal.id,
            senderRole: "SYSTEM",
            type: "EVENT",
            text: `Advance of ${formattedAmount} marked as paid`,
          },
        });
      }
    } else {
      // Updating existing BookingAdvance
      const isStatusChangingToPaid = !existingAdvance.paidAt && markAsPaid;
      const isAmountChanging = Number(existingAdvance.amount) !== amount;

      const updated = await tx.bookingAdvance.update({
        where: { id: existingAdvance.id },
        data: {
          amount,
          percentUsed,
          currency,
          status: markAsPaid ? "PAID" : "PENDING",
          paidAt: markAsPaid ? (resolvedPaidAt ?? existingAdvance.paidAt ?? new Date()) : null,
          notes: notes || null,
          markedPaidBy: markAsPaid ? (existingAdvance.markedPaidBy ?? user.id) : null,
        },
      });

      if (isAmountChanging) {
        await tx.bookingAdvanceHistory.create({
          data: {
            advanceId: updated.id,
            action: "AMOUNT_EDITED",
            oldValue: JSON.stringify({ amount: Number(existingAdvance.amount) }),
            newValue: JSON.stringify({ amount }),
            reason: editReason || null,
            actorId: user.id,
          },
        });
      }

      if (isStatusChangingToPaid) {
        becamePaidNow = true;
        await tx.bookingAdvanceHistory.create({
          data: {
            advanceId: updated.id,
            action: "MARKED_PAID",
            oldValue: JSON.stringify({ status: "PENDING" }),
            newValue: JSON.stringify({
              status: "PAID",
              paidAt: resolvedPaidAt?.toISOString(),
            }),
            reason: null,
            actorId: user.id,
          },
        });

        // System event message
        const formattedAmount = formatListingPrice(amount, currency);
        await tx.dealMessage.create({
          data: {
            dealId: deal.id,
            senderRole: "SYSTEM",
            type: "EVENT",
            text: `Advance of ${formattedAmount} marked as paid`,
          },
        });
      }
    }
  });

  // Send notification email in safe try/catch if became paid now
  if (becamePaidNow) {
    try {
      const recipientEmail = deal.customer?.email || deal.contactEmail;
      const customerName = deal.customer?.name || deal.contactName || "Client";
      if (recipientEmail) {
        const host = (await headers()).get("host") ?? "localhost:3000";
        const protocol = host.startsWith("localhost") ? "http" : "https";
        const dealLink = `${protocol}://${host}/customer/dashboard/deals/${deal.id}`;
        const remaining = Math.max(0, saleAmount - amount);

        await sendBookingAdvancePaidEmail(recipientEmail, {
          customer_name: customerName,
          listing_title: deal.listing.title,
          amount: formatListingPrice(amount, currency),
          paid_date: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
            resolvedPaidAt || new Date()
          ),
          balance_remaining: formatListingPrice(remaining, currency),
          deal_link: dealLink,
        });
      }
    } catch (err) {
      console.error("Failed to send booking advance paid email:", err);
    }
  }

  revalidateAdvancePaths(deal.id);
  return { success: true };
}

/**
 * Marks an existing pending advance as paid.
 */
export async function markAdvancePaid(
  dealId: number,
  paidAtInput?: string
) {
  const { user, deal } = await verifyAgentDealOwnership(dealId);

  const booking = deal.booking;
  const advance = booking?.advance;
  if (!booking || !advance) {
    return { success: false, message: "No advance booking found to mark as paid." };
  }

  if (advance.status === "PAID") {
    return { success: false, message: "Advance is already marked as paid." };
  }

  const parsedDate = paidAtInput ? new Date(paidAtInput) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return { success: false, message: "Invalid payment date." };
  }
  if (parsedDate > new Date()) {
    return { success: false, message: "Payment date cannot be in the future." };
  }

  const currency =
    advance.currency && advance.currency !== "USD"
      ? advance.currency
      : !deal.listing.currency || deal.listing.currency === "USD"
        ? "INR"
        : deal.listing.currency;
  const amountNumber = Number(advance.amount);

  await prisma.$transaction(async (tx) => {
    await tx.bookingAdvance.update({
      where: { id: advance.id },
      data: {
        status: "PAID",
        paidAt: parsedDate,
        markedPaidBy: user.id,
      },
    });

    await tx.bookingAdvanceHistory.create({
      data: {
        advanceId: advance.id,
        action: "MARKED_PAID",
        oldValue: JSON.stringify({ status: "PENDING" }),
        newValue: JSON.stringify({
          status: "PAID",
          paidAt: parsedDate.toISOString(),
        }),
        reason: null,
        actorId: user.id,
      },
    });

    // Add thread event visible to both sides
    const formattedAmount = formatListingPrice(amountNumber, currency);
    await tx.dealMessage.create({
      data: {
        dealId: deal.id,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: `Advance of ${formattedAmount} marked as paid`,
      },
    });
  });

  // Send email to customer
  try {
    const recipientEmail = deal.customer?.email || deal.contactEmail;
    const customerName = deal.customer?.name || deal.contactName || "Client";
    if (recipientEmail) {
      const host = (await headers()).get("host") ?? "localhost:3000";
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const dealLink = `${protocol}://${host}/customer/dashboard/deals/${deal.id}`;
      const saleAmount = Number(booking.saleAmount);
      const remaining = Math.max(0, saleAmount - amountNumber);

      await sendBookingAdvancePaidEmail(recipientEmail, {
        customer_name: customerName,
        listing_title: deal.listing.title,
        amount: formatListingPrice(amountNumber, currency),
        paid_date: new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(parsedDate),
        balance_remaining: formatListingPrice(remaining, currency),
        deal_link: dealLink,
      });
    }
  } catch (err) {
    console.error("Failed to send booking advance paid email:", err);
  }

  revalidateAdvancePaths(deal.id);
  return { success: true };
}

/**
 * Un-marks a paid advance back to pending.
 * Requires a reason (5-500 characters).
 * Clears paidAt, sets status pending, writes history, emails customer (without revealing reason).
 * Does NOT write a thread event.
 */
export async function unmarkAdvancePaid(
  dealId: number,
  input: UnmarkAdvanceInput
) {
  const { user, deal } = await verifyAgentDealOwnership(dealId);

  const parsed = UnmarkAdvanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message || "Invalid reason.",
    };
  }

  const { reason } = parsed.data;

  const booking = deal.booking;
  const advance = booking?.advance;
  if (!booking || !advance) {
    return { success: false, message: "No advance booking found." };
  }

  if (advance.status !== "PAID") {
    return { success: false, message: "Advance is not marked as paid." };
  }

  const currency =
    advance.currency && advance.currency !== "USD"
      ? advance.currency
      : !deal.listing.currency || deal.listing.currency === "USD"
        ? "INR"
        : deal.listing.currency;
  const amountNumber = Number(advance.amount);

  await prisma.$transaction(async (tx) => {
    await tx.bookingAdvance.update({
      where: { id: advance.id },
      data: {
        status: "PENDING",
        paidAt: null,
      },
    });

    await tx.bookingAdvanceHistory.create({
      data: {
        advanceId: advance.id,
        action: "UNMARKED_PAID",
        oldValue: JSON.stringify({
          status: "PAID",
          paidAt: advance.paidAt?.toISOString() || null,
        }),
        newValue: JSON.stringify({ status: "PENDING", paidAt: null }),
        reason,
        actorId: user.id,
      },
    });
  });

  // Email customer without revealing reason
  try {
    const recipientEmail = deal.customer?.email || deal.contactEmail;
    const customerName = deal.customer?.name || deal.contactName || "Client";
    if (recipientEmail) {
      const host = (await headers()).get("host") ?? "localhost:3000";
      const protocol = host.startsWith("localhost") ? "http" : "https";
      const dealLink = `${protocol}://${host}/customer/dashboard/deals/${deal.id}`;

      await sendBookingAdvanceUnmarkedEmail(recipientEmail, {
        customer_name: customerName,
        listing_title: deal.listing.title,
        amount: formatListingPrice(amountNumber, currency),
        deal_link: dealLink,
      });
    }
  } catch (err) {
    console.error("Failed to send booking advance unmarked email:", err);
  }

  revalidateAdvancePaths(deal.id);
  return { success: true };
}
