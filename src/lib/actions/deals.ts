"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/session";
import { forgetInquirer, readInquirySession, rememberInquiry } from "@/lib/inquiry-session";
import {
  sendNewLeadNotification,
  sendInquiryConfirmation,
  sendBookingConfirmationNeededEmail,
  sendLeadOptedOutEmail,
  sendSiteVisitRequestEmail,
  sendShowingStatusEmail,
  sendShowingConfirmedEmail,
  sendShowingRescheduledEmail,
  sendShowingCancelledEmail,
  sendDealNewMessageEmail,
  sendDealNewOfferEmail,
  sendDealCounterOfferEmail,
  sendDealOfferAcceptedEmail,
  sendDealOfferRejectedEmail,
  sendDealOfferExpiredEmail,
} from "@/lib/email";
import { formatListingPrice } from "@/lib/price";
import {
  SendMessageSchema,
  SendOfferSchema,
  CounterOfferSchema,
  PrivateNoteSchema,
  computeExpiryDate,
  checkRateLimit,
  type ExpiryOption,
} from "@/lib/validation/deal-message";
import {
  CustomerInquirySchema,
  InquiryFormSchema,
  ManualDealSchema,
  UpdateDealSchema,
  DEAL_STAGE_LABELS,
  type InquiryFormState,
  type UpdateDealState,
} from "@/lib/validation/deal";
import type { DealStage } from "@prisma/client";

function revalidateDealPaths(listingSlug?: string, dealId?: number) {
  revalidatePath("/agent/dashboard/deals");
  revalidatePath("/agent/dashboard");
  revalidatePath("/customer/dashboard");
  revalidatePath("/customer/dashboard/deals");
  revalidatePath("/admin/dashboard/deals");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
  if (listingSlug) revalidatePath(`/listings/${listingSlug}`);
  if (dealId) {
    revalidatePath(`/agent/dashboard/deals/${dealId}`);
    revalidatePath(`/customer/dashboard/deals/${dealId}`);
    revalidatePath(`/customer/dashboard/chat/${dealId}`);
  }
}

function formValues(formData: FormData): Record<string, string> {
  return Object.fromEntries([...formData].filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

type ListingForInquiry = NonNullable<Awaited<ReturnType<typeof findInquirableListing>>>;

async function findInquirableListing(listingId: number) {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { agent: { select: { name: true, email: true } } },
  });
  return listing && listing.status === "ACTIVE" ? listing : null;
}

/** Creates the lead and sends both emails. Shared by the full form and the one-click button. */
async function recordInquiry(
  listing: ListingForInquiry,
  contact: { name: string; email: string; phone: string | null; message: string | null; customerId?: number }
) {
  let customerId = contact.customerId;
  if (!customerId) {
    const existingCustomer = await prisma.user.findFirst({
      where: { email: contact.email, role: "CUSTOMER" },
      select: { id: true },
    });
    if (existingCustomer) {
      customerId = existingCustomer.id;
    }
  }

  const deal = await prisma.deal.create({
    data: {
      listingId: listing.id,
      agentId: listing.agentId,
      ...(customerId ? { customerId } : {}),
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      message: contact.message,
    },
  });

  // Automatically insert the initial customer inquiry message as Message #1 in the conversation thread
  const initialText =
    contact.message?.trim() ||
    "Hi, I am interested in this property and would like to connect with the listing agent.";

  await prisma.dealMessage.create({
    data: {
      dealId: deal.id,
      senderRole: "CUSTOMER",
      senderId: customerId ?? null,
      type: "MESSAGE",
      text: initialText,
      agentReadAt: null,
      customerReadAt: new Date(),
    },
  });

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${deal.id}`;

  await sendNewLeadNotification(listing.agent.email, {
    listingTitle: listing.title,
    contactName: contact.name,
    contactEmail: contact.email,
    contactPhone: contact.phone,
    message: contact.message,
    dealUrl,
  });

  await sendInquiryConfirmation(contact.email, {
    listingTitle: listing.title,
    agentName: listing.agent.name,
  });

  // If the inquiry specifically requests a visit or viewing, also send the site visit alert
  if (
    contact.message &&
    (contact.message.toLowerCase().includes("visit") || contact.message.toLowerCase().includes("viewing")) &&
    listing.agent.email
  ) {
    await sendSiteVisitRequestEmail(listing.agent.email, {
      agentName: listing.agent.name,
      listingTitle: listing.title,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      message: contact.message,
      dealUrl,
      listingUrl: `${protocol}://${host}/listings/${listing.slug}`,
    });
  }

  revalidateDealPaths(listing.slug);
}

export async function createInquiry(
  listingId: number,
  _prevState: InquiryFormState,
  formData: FormData
): Promise<InquiryFormState> {
  const listing = await findInquirableListing(listingId);
  if (!listing) {
    return { message: "This listing is no longer accepting inquiries." };
  }

  const session = await auth();
  const isCustomer = session?.user?.role === "CUSTOMER";

  let contact: { name: string; email: string; phone: string | null; message: string | null; customerId?: number };

  if (isCustomer) {
    const validatedFields = CustomerInquirySchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
      return { errors: validatedFields.error.flatten().fieldErrors, values: formValues(formData) };
    }
    contact = {
      name: session!.user.name,
      email: session!.user.email,
      phone: validatedFields.data.contactPhone || null,
      message: validatedFields.data.message || null,
      customerId: Number(session!.user.id),
    };
  } else {
    const validatedFields = InquiryFormSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
      return { errors: validatedFields.error.flatten().fieldErrors, values: formValues(formData) };
    }
    contact = {
      name: validatedFields.data.contactName,
      email: validatedFields.data.contactEmail,
      phone: validatedFields.data.contactPhone || null,
      message: validatedFields.data.message || null,
    };
  }

  await recordInquiry(listing, contact);
  // Remember the visitor for this browser session so other properties offer a one-click button.
  await rememberInquiry(
    isCustomer ? { phone: contact.phone } : { name: contact.name, email: contact.email, phone: contact.phone },
    listingId
  );
  return { message: "Thanks! The listing agent will be in touch soon." };
}

/** One-click "I'm Interested": reuses the details the visitor already gave in this session. */
export async function expressInterest(
  listingId: number,
  _prevState: InquiryFormState
): Promise<InquiryFormState> {
  const listing = await findInquirableListing(listingId);
  if (!listing) return { message: "This listing is no longer accepting inquiries." };

  const remembered = await readInquirySession();
  if (remembered.listings.includes(listingId)) {
    return { message: "You've already shown interest in this property." };
  }

  const session = await auth();
  const isCustomer = session?.user?.role === "CUSTOMER";
  const name = isCustomer ? session!.user.name : remembered.name;
  const email = isCustomer ? session!.user.email : remembered.email;
  if (!name || !email) {
    return { message: "Please fill in the form so the agent knows how to reach you." };
  }

  await recordInquiry(listing, {
    name,
    email,
    phone: remembered.phone ?? null,
    message: null,
    ...(isCustomer ? { customerId: Number(session!.user.id) } : {}),
  });
  await rememberInquiry({}, listingId);
  return { message: "Thanks! The listing agent will be in touch soon." };
}

/** "Not you?": drops the saved contact details so the full form is shown again. */
export async function forgetSavedDetails(): Promise<void> {
  await forgetInquirer();
}

export async function createManualDeal(
  _prevState: InquiryFormState,
  formData: FormData
): Promise<InquiryFormState> {
  const agent = await requireRole("AGENT");

  const validatedFields = ManualDealSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { listingId, contactName, contactEmail, contactPhone, message } = validatedFields.data;

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing || listing.agentId !== agent.id) {
    return { message: "You can only add leads to your own listings." };
  }

  const existingCustomer = await prisma.user.findFirst({
    where: { email: contactEmail, role: "CUSTOMER" },
    select: { id: true },
  });

  const deal = await prisma.deal.create({
    data: {
      listingId,
      agentId: agent.id,
      ...(existingCustomer ? { customerId: existingCustomer.id } : {}),
      contactName,
      contactEmail,
      contactPhone: contactPhone || null,
      message: message || null,
    },
  });

  if (message?.trim()) {
    await prisma.dealMessage.create({
      data: {
        dealId: deal.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "MESSAGE",
        text: message.trim(),
        agentReadAt: new Date(),
        customerReadAt: null,
      },
    });
  }

  revalidateDealPaths(listing.slug);
  redirect(`/agent/dashboard/deals/${deal.id}`);
}

export async function updateDeal(
  dealId: number,
  _prevState: UpdateDealState,
  formData: FormData
): Promise<UpdateDealState> {
  const user = await requireUser();

  const existing = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        include: {
          agent: { select: { id: true, name: true, email: true } },
          developer: {
            select: {
              id: true,
              name: true,
              email: true,
              developerProfile: { select: { companyName: true } },
            },
          },
        },
      },
      booking: true,
    },
  });
  if (!existing) {
    return { message: "Deal not found." };
  }
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    return { message: "You are not allowed to edit this deal." };
  }

  const validatedFields = UpdateDealSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { stage, offerAmount, notes } = validatedFields.data;
  const closingNow =
    (stage === "CLOSED_WON" || stage === "CLOSED_LOST") && existing.stage !== stage;
  const winningNow = closingNow && stage === "CLOSED_WON";
  const needsNewBooking = winningNow && !existing.booking;
  const developer = existing.listing.developer;

  const listingUpdate =
    stage === "CLOSED_WON"
      ? { status: "SOLD" as const }
      : stage === "UNDER_CONTRACT" && existing.listing.status !== "SOLD"
        ? { status: "UNDER_OFFER" as const }
        : null;

  await prisma.$transaction([
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage,
        offerAmount: offerAmount ?? null,
        notes: notes || null,
        ...(closingNow ? { closedAt: new Date() } : {}),
      },
    }),
    ...(listingUpdate
      ? [prisma.listing.update({ where: { id: existing.listingId }, data: listingUpdate })]
      : []),
    ...(needsNewBooking
      ? [
          prisma.booking.create({
            data: {
              dealId,
              saleAmount: offerAmount ?? existing.listing.price ?? 0,
              status: developer ? "PENDING_CONFIRMATION" : "CONFIRMED",
              ...(developer ? {} : { confirmedAt: new Date() }),
            },
          }),
        ]
      : []),
  ]);

  if (needsNewBooking && developer) {
    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const bookingUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;

    await sendBookingConfirmationNeededEmail(developer.email, {
      listingTitle: existing.listing.title,
      agentName: user.name,
      saleAmount: Number(offerAmount ?? existing.listing.price),
      bookingUrl,
    });
  }

  // Trigger lead opt-out email if deal is closed lost due to opting out
  if (
    closingNow &&
    stage === "CLOSED_LOST" &&
    (notes?.toLowerCase().includes("opt") || notes?.toLowerCase().includes("unsub"))
  ) {
    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;

    await sendLeadOptedOutEmail(existing.listing.agent.email, {
      agentName: existing.listing.agent.name,
      contactName: existing.contactName,
      contactEmail: existing.contactEmail,
      listingTitle: existing.listing.title,
      dealUrl,
      reason: notes || "Lead opted out.",
    });
  }

  // Trigger site-visit request email if stage changed to VIEWING_SCHEDULED
  const viewingScheduledNow = stage === "VIEWING_SCHEDULED" && existing.stage !== "VIEWING_SCHEDULED";
  if (viewingScheduledNow && existing.listing.agent?.email) {
    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;
    const listingUrl = `${protocol}://${host}/listings/${existing.listing.slug}`;

    await sendSiteVisitRequestEmail(existing.listing.agent.email, {
      agentName: existing.listing.agent.name,
      listingTitle: existing.listing.title,
      contactName: existing.contactName,
      contactEmail: existing.contactEmail,
      contactPhone: existing.contactPhone,
      message: notes || existing.message,
      dealUrl,
      listingUrl,
    });
  }

  // Trigger showing cancelled email if a scheduled viewing is moved to CLOSED_LOST
  if (
    existing.stage === "VIEWING_SCHEDULED" &&
    stage === "CLOSED_LOST" &&
    existing.listing.agent?.email
  ) {
    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;
    const listingUrl = `${protocol}://${host}/listings/${existing.listing.slug}`;

    await sendShowingCancelledEmail(existing.listing.agent.email, {
      agentName: existing.listing.agent.name,
      listingTitle: existing.listing.title,
      contactName: existing.contactName,
      updatedBy: user.role === "CUSTOMER" ? "the client" : "the seller",
      reason: notes || "Showing cancelled.",
      dealUrl,
      listingUrl,
    });
  }

  revalidateDealPaths(existing.listing.slug);
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/developer/dashboard/bookings");
  revalidatePath("/admin/dashboard/bookings");

  return { message: "Deal updated." };
}

export async function optOutLead(dealId: number, reason?: string) {
  const user = await requireUser();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        include: {
          agent: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!deal) throw new Error("Lead not found.");
  if (user.role !== "ADMIN" && deal.agentId !== user.id) {
    throw new Error("You are not allowed to update this lead.");
  }

  const optOutNote = reason
    ? `[Opted Out]: ${reason}`
    : "[Opted Out]: Lead unsubscribed from communications.";
  const updatedNotes = [deal.notes, optOutNote].filter(Boolean).join("\n");

  await prisma.deal.update({
    where: { id: dealId },
    data: {
      stage: "CLOSED_LOST",
      notes: updatedNotes,
      closedAt: new Date(),
    },
  });

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${deal.id}`;

  await sendLeadOptedOutEmail(deal.listing.agent.email, {
    agentName: deal.listing.agent.name,
    contactName: deal.contactName,
    contactEmail: deal.contactEmail,
    listingTitle: deal.listing.title,
    dealUrl,
    reason: reason || "Customer requested to opt out of further communications.",
  });

  revalidateDealPaths(deal.listing.slug);
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
}

export async function requestSiteVisit(
  listingId: number,
  data: {
    name: string;
    email: string;
    phone?: string | null;
    visitDate?: string | null;
    visitTime?: string | null;
    message?: string | null;
  }
) {
  const listing = await findInquirableListing(listingId);
  if (!listing) {
    throw new Error("This listing is no longer accepting inquiries.");
  }

  // Public entry point: apply the same contact rules as the inquiry form.
  const contact = InquiryFormSchema.pick({ contactName: true, contactEmail: true, contactPhone: true }).safeParse({
    contactName: data.name,
    contactEmail: data.email,
    contactPhone: data.phone ?? "",
  });
  if (!contact.success) {
    throw new Error(Object.values(contact.error.flatten().fieldErrors).flat()[0] ?? "Please check your contact details.");
  }

  const visitNote = [
    data.visitDate ? `Date: ${data.visitDate}` : null,
    data.visitTime ? `Time: ${data.visitTime}` : null,
    data.message ? `Notes: ${data.message}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const existingCustomer = await prisma.user.findFirst({
    where: { email: data.email, role: "CUSTOMER" },
    select: { id: true },
  });

  const deal = await prisma.deal.create({
    data: {
      listingId: listing.id,
      agentId: listing.agentId,
      stage: "VIEWING_SCHEDULED",
      ...(existingCustomer ? { customerId: existingCustomer.id } : {}),
      contactName: data.name,
      contactEmail: data.email,
      contactPhone: data.phone || null,
      message: visitNote || "Requested a site visit.",
    },
  });

  await prisma.dealMessage.create({
    data: {
      dealId: deal.id,
      senderRole: "CUSTOMER",
      senderId: existingCustomer?.id ?? null,
      type: "MESSAGE",
      text: `📅 Scheduled Site Visit: ${visitNote || "Requested a site visit."}`,
      agentReadAt: null,
      customerReadAt: new Date(),
    },
  });

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${deal.id}`;
  const listingUrl = `${protocol}://${host}/listings/${listing.slug}`;

  if (listing.agent?.email) {
    await sendSiteVisitRequestEmail(listing.agent.email, {
      agentName: listing.agent.name,
      listingTitle: listing.title,
      contactName: data.name,
      contactEmail: data.email,
      contactPhone: data.phone,
      visitDate: data.visitDate,
      visitTime: data.visitTime,
      message: data.message,
      dealUrl,
      listingUrl,
    });
  }

  revalidateDealPaths(listing.slug);
  return { success: true, dealId: deal.id };
}

export async function updateShowingStatus(
  dealId: number,
  status: "Confirmed" | "Rescheduled" | "Cancelled",
  options?: {
    updatedBy?: "the client" | "the seller" | string | null;
    visitDate?: string | null;
    visitTime?: string | null;
    reason?: string | null;
  }
) {
  const user = await requireUser();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        include: {
          agent: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!deal) {
    throw new Error("Deal not found.");
  }

  const updateData: any = {};
  if (status === "Confirmed" || status === "Rescheduled") {
    updateData.stage = "VIEWING_SCHEDULED";
  } else if (status === "Cancelled") {
    updateData.stage = "CLOSED_LOST";
  }

  if (options?.reason || options?.visitDate) {
    const summary = `Showing ${status}${options.updatedBy ? ` by ${options.updatedBy}` : ""}${options.visitDate ? ` on ${options.visitDate}` : ""}${options.visitTime ? ` at ${options.visitTime}` : ""}${options.reason ? `. Note: ${options.reason}` : ""}`;
    updateData.notes = deal.notes ? `${deal.notes}\n${summary}` : summary;
  }

  await prisma.deal.update({
    where: { id: dealId },
    data: updateData,
  });

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${deal.id}`;
  const listingUrl = `${protocol}://${host}/listings/${deal.listing.slug}`;

  if (deal.listing.agent?.email) {
    await sendShowingStatusEmail(deal.listing.agent.email, {
      agentName: deal.listing.agent.name,
      listingTitle: deal.listing.title,
      contactName: deal.contactName,
      showingStatus: status,
      updatedBy: options?.updatedBy ?? (user.role === "CUSTOMER" ? "the client" : "the seller"),
      visitDate: options?.visitDate,
      visitTime: options?.visitTime,
      reason: options?.reason,
      dealUrl,
      listingUrl,
    });
  }

  revalidateDealPaths(deal.listing.slug);
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  return { success: true };
}

export async function deleteDeal(dealId: number) {
  const user = await requireUser();

  const existing = await prisma.deal.findUnique({ where: { id: dealId }, include: { listing: true } });
  if (!existing) return;
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    throw new Error("You are not allowed to delete this deal.");
  }

  await prisma.deal.delete({ where: { id: dealId } });

  revalidateDealPaths(existing.listing.slug, dealId);
  redirect(user.role === "ADMIN" ? "/admin/dashboard/deals" : "/agent/dashboard/deals");
}

/**
 * Strict server-side authorization check for deal conversation actions.
 * Never trusts the client for role or ownership.
 */
async function requireDealParticipant(dealId: number) {
  const user = await requireUser();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: { select: { agentId: true, title: true, slug: true, currency: true } },
      agent: { select: { id: true, name: true, email: true } },
      customer: { select: { id: true, name: true, email: true } },
    },
  });

  if (!deal) {
    throw new Error("Deal not found.");
  }

  let participantRole: "AGENT" | "CUSTOMER" | "ADMIN";

  if (user.role === "ADMIN") {
    participantRole = "ADMIN";
  } else if (deal.agentId === user.id || deal.listing.agentId === user.id) {
    participantRole = "AGENT";
  } else if (
    deal.customerId === user.id ||
    (user.email && deal.contactEmail.toLowerCase() === user.email.toLowerCase())
  ) {
    participantRole = "CUSTOMER";
  } else {
    throw new Error("You are not authorized to access this deal.");
  }

  return { user, deal, participantRole };
}

/**
 * Send a message in a deal conversation thread.
 */
export async function sendDealMessage(dealId: number, text: string) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  if (!checkRateLimit(user.id)) {
    return { success: false, message: "Too many messages sent. Please slow down." };
  }

  const parsed = SendMessageSchema.safeParse({ dealId, text });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message || "Invalid message." };
  }

  const roleForMsg = participantRole === "CUSTOMER" ? "CUSTOMER" : "AGENT";

  // If this is the agent's first reply on a NEW deal, automatically transition to CONTACTED
  let nextStage = deal.stage;
  const isAgentFirstReply = roleForMsg === "AGENT" && deal.stage === "NEW";
  if (isAgentFirstReply) {
    nextStage = "CONTACTED";
  }

  await prisma.$transaction([
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: roleForMsg,
        senderId: user.id,
        type: "MESSAGE",
        text: parsed.data.text,
        agentReadAt: roleForMsg === "AGENT" ? new Date() : null,
        customerReadAt: roleForMsg === "CUSTOMER" ? new Date() : null,
      },
    }),
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage: nextStage,
        updatedAt: new Date(),
      },
    }),
    ...(isAgentFirstReply
      ? [
          prisma.dealMessage.create({
            data: {
              dealId,
              senderRole: "SYSTEM",
              type: "EVENT",
              text: "Stage changed to Contacted",
            },
          }),
        ]
      : []),
  ]);

  // Asynchronous notification email in try/catch (never fails the action)
  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";

    if (roleForMsg === "AGENT") {
      const recipientEmail = deal.customer?.email || deal.contactEmail;
      const recipientName = deal.customer?.name || deal.contactName;
      if (recipientEmail) {
        await sendDealNewMessageEmail(recipientEmail, {
          recipient_name: recipientName,
          sender_name: user.name,
          listing_title: deal.listing.title,
          message_preview: parsed.data.text.slice(0, 150),
          deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
        });
      }
    } else {
      if (deal.agent?.email) {
        await sendDealNewMessageEmail(deal.agent.email, {
          recipient_name: deal.agent.name,
          sender_name: user.name || deal.contactName,
          listing_title: deal.listing.title,
          message_preview: parsed.data.text.slice(0, 150),
          deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
        });
      }
    }
  } catch (err) {
    console.error("Failed to send message email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Send an offer or counter-offer.
 * Enforces:
 * - Only one pending offer at a time (previous pending offers become COUNTERED).
 * - Automatic stage transitions:
 *   - Customer sends offer -> OFFER_MADE
 *   - Agent counters -> NEGOTIATION
 */
export async function sendDealOffer(
  dealId: number,
  amount: number,
  expiryOption: ExpiryOption = "none",
  text?: string,
  isCounter?: boolean
) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  if (!checkRateLimit(user.id)) {
    return { success: false, message: "Too many requests. Please wait a moment." };
  }

  const parsed = SendOfferSchema.safeParse({ dealId, amount, expiry: expiryOption, text });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message || "Invalid offer." };
  }

  const roleForMsg = participantRole === "CUSTOMER" ? "CUSTOMER" : "AGENT";
  const expiresAt = computeExpiryDate(parsed.data.expiry);
  const formattedAmount = formatListingPrice(parsed.data.amount, deal.listing.currency);

  // Check if there was already an offer in this deal to distinguish new offer vs counter-offer
  const previousOfferCount = await prisma.dealMessage.count({
    where: { dealId, type: "OFFER" },
  });
  const isCounterOffer = isCounter ?? previousOfferCount > 0;

  const nextStage: DealStage = roleForMsg === "CUSTOMER" ? "OFFER_MADE" : "NEGOTIATION";
  const systemEventText = isCounterOffer
    ? `Counter offer proposed: ${formattedAmount}`
    : `Offer submitted: ${formattedAmount}`;

  await prisma.$transaction([
    // Mark any existing pending offers on this deal as COUNTERED
    prisma.dealMessage.updateMany({
      where: { dealId, type: "OFFER", offerStatus: "PENDING" },
      data: { offerStatus: "COUNTERED" },
    }),
    // Create the new offer message
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: roleForMsg,
        senderId: user.id,
        type: "OFFER",
        text: parsed.data.text || (isCounterOffer ? `Countered with ${formattedAmount}` : `Offered ${formattedAmount}`),
        amount: parsed.data.amount,
        currency: deal.listing.currency || "INR",
        offerStatus: "PENDING",
        expiresAt,
        agentReadAt: roleForMsg === "AGENT" ? new Date() : null,
        customerReadAt: roleForMsg === "CUSTOMER" ? new Date() : null,
      },
    }),
    // Create system audit event
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: systemEventText,
      },
    }),
    // Update deal stage and current offerAmount
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage: nextStage,
        offerAmount: parsed.data.amount,
        updatedAt: new Date(),
      },
    }),
  ]);

  // Send notification email in safe try/catch
  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";

    const formattedExpiry = expiresAt
      ? expiresAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : null;

    if (roleForMsg === "AGENT") {
      const recipientEmail = deal.customer?.email || deal.contactEmail;
      const recipientName = deal.customer?.name || deal.contactName;
      if (recipientEmail) {
        const payload = {
          recipient_name: recipientName,
          sender_name: user.name || deal.agent?.name || "Listing Agent",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          message_preview: parsed.data.text || null,
          deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
          expires_at: formattedExpiry,
        };

        if (isCounterOffer) {
          await sendDealCounterOfferEmail(recipientEmail, payload);
        } else {
          await sendDealNewOfferEmail(recipientEmail, payload);
        }
      }
    } else {
      if (deal.agent?.email) {
        const payload = {
          recipient_name: deal.agent.name,
          sender_name: user.name || deal.customer?.name || deal.contactName || "Client",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          message_preview: parsed.data.text || null,
          deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
          expires_at: formattedExpiry,
        };

        if (isCounterOffer) {
          await sendDealCounterOfferEmail(deal.agent.email, payload);
        } else {
          await sendDealNewOfferEmail(deal.agent.email, payload);
        }
      }
    }
  } catch (err) {
    console.error("Failed to send offer/counter-offer email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Counter a specific pending offer message.
 */
export async function counterDealOffer(
  dealId: number,
  messageId: number,
  amount: number,
  expiryOption: ExpiryOption = "none",
  text?: string
) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  const existingOffer = await prisma.dealMessage.findUnique({
    where: { id: messageId },
  });

  if (!existingOffer || existingOffer.dealId !== dealId || existingOffer.type !== "OFFER") {
    return { success: false, message: "Offer not found." };
  }

  // Only the OTHER party can counter, never the sender
  if (existingOffer.senderRole === participantRole) {
    return { success: false, message: "You cannot counter your own offer." };
  }

  // Check if expired
  if (existingOffer.expiresAt && existingOffer.expiresAt < new Date()) {
    const formattedAmount = formatListingPrice(existingOffer.amount, deal.listing.currency);
    await prisma.$transaction([
      prisma.dealMessage.update({
        where: { id: messageId },
        data: { offerStatus: "EXPIRED" },
      }),
      prisma.dealMessage.create({
        data: {
          dealId,
          senderRole: "SYSTEM",
          type: "EVENT",
          text: `Offer of ${formattedAmount} expired`,
        },
      }),
    ]);

    try {
      const host = (await headers()).get("host") ?? "localhost:3000";
      const protocol = host.startsWith("localhost") ? "http" : "https";

      if (existingOffer.senderRole === "CUSTOMER") {
        const recipientEmail = deal.customer?.email || deal.contactEmail;
        const recipientName = deal.customer?.name || deal.contactName;
        if (recipientEmail) {
          await sendDealOfferExpiredEmail(recipientEmail, {
            recipient_name: recipientName,
            sender_name: recipientName,
            listing_title: deal.listing.title,
            amount: formattedAmount,
            deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
          });
        }
      } else {
        if (deal.agent?.email) {
          await sendDealOfferExpiredEmail(deal.agent.email, {
            recipient_name: deal.agent.name,
            sender_name: deal.agent.name,
            listing_title: deal.listing.title,
            amount: formattedAmount,
            deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
          });
        }
      }
    } catch (err) {
      console.error("Failed to send offer expired email:", err);
    }

    return { success: false, message: "This offer has expired and can no longer be countered." };
  }

  return sendDealOffer(dealId, amount, expiryOption, text, true);
}

/**
 * Accept a pending offer.
 * Re-validates server-side that offer is still PENDING and NOT expired.
 * Updates deal stage to UNDER_CONTRACT.
 */
export async function acceptDealOffer(dealId: number, messageId: number) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  const offer = await prisma.dealMessage.findUnique({
    where: { id: messageId },
  });

  if (!offer || offer.dealId !== dealId || offer.type !== "OFFER") {
    return { success: false, message: "Offer not found." };
  }

  // Only the OTHER party can accept
  if (offer.senderRole === participantRole) {
    return { success: false, message: "You cannot accept your own offer." };
  }

  if (offer.offerStatus !== "PENDING") {
    return { success: false, message: `Offer is already ${offer.offerStatus?.toLowerCase()}.` };
  }

  const formattedAmount = formatListingPrice(offer.amount, deal.listing.currency);

  if (offer.expiresAt && offer.expiresAt < new Date()) {
    await prisma.$transaction([
      prisma.dealMessage.update({
        where: { id: messageId },
        data: { offerStatus: "EXPIRED" },
      }),
      prisma.dealMessage.create({
        data: {
          dealId,
          senderRole: "SYSTEM",
          type: "EVENT",
          text: `Offer of ${formattedAmount} expired`,
        },
      }),
    ]);

    try {
      const host = (await headers()).get("host") ?? "localhost:3000";
      const protocol = host.startsWith("localhost") ? "http" : "https";

      if (offer.senderRole === "CUSTOMER") {
        const recipientEmail = deal.customer?.email || deal.contactEmail;
        const recipientName = deal.customer?.name || deal.contactName;
        if (recipientEmail) {
          await sendDealOfferExpiredEmail(recipientEmail, {
            recipient_name: recipientName,
            sender_name: recipientName,
            listing_title: deal.listing.title,
            amount: formattedAmount,
            deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
          });
        }
      } else {
        if (deal.agent?.email) {
          await sendDealOfferExpiredEmail(deal.agent.email, {
            recipient_name: deal.agent.name,
            sender_name: deal.agent.name,
            listing_title: deal.listing.title,
            amount: formattedAmount,
            deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
          });
        }
      }
    } catch (err) {
      console.error("Failed to send offer expired email:", err);
    }

    return { success: false, message: "This offer has expired." };
  }

  await prisma.$transaction([
    prisma.dealMessage.update({
      where: { id: messageId },
      data: { offerStatus: "ACCEPTED" },
    }),
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: `Offer accepted: ${formattedAmount}. Stage changed to Under contract`,
      },
    }),
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage: "UNDER_CONTRACT",
        offerAmount: offer.amount,
        updatedAt: new Date(),
      },
    }),
  ]);

  // Send notification email in safe try/catch
  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";

    if (participantRole === "AGENT") {
      const recipientEmail = deal.customer?.email || deal.contactEmail;
      const recipientName = deal.customer?.name || deal.contactName;
      if (recipientEmail) {
        await sendDealOfferAcceptedEmail(recipientEmail, {
          recipient_name: recipientName,
          sender_name: user.name || deal.agent?.name || "Listing Agent",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
        });
      }
    } else {
      if (deal.agent?.email) {
        await sendDealOfferAcceptedEmail(deal.agent.email, {
          recipient_name: deal.agent.name,
          sender_name: user.name || deal.customer?.name || deal.contactName || "Client",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
        });
      }
    }
  } catch (err) {
    console.error("Failed to send offer accepted email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Reject a pending offer.
 */
export async function rejectDealOffer(dealId: number, messageId: number, reason?: string) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  const offer = await prisma.dealMessage.findUnique({
    where: { id: messageId },
  });

  if (!offer || offer.dealId !== dealId || offer.type !== "OFFER") {
    return { success: false, message: "Offer not found." };
  }

  // Only the OTHER party can reject
  if (offer.senderRole === participantRole) {
    return { success: false, message: "You cannot reject your own offer." };
  }

  if (offer.offerStatus !== "PENDING") {
    return { success: false, message: `Offer is already ${offer.offerStatus?.toLowerCase()}.` };
  }

  const formattedAmount = formatListingPrice(offer.amount, deal.listing.currency);
  const rejectNote = reason ? ` (${reason})` : "";

  await prisma.$transaction([
    prisma.dealMessage.update({
      where: { id: messageId },
      data: { offerStatus: "REJECTED" },
    }),
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: `Offer of ${formattedAmount} rejected${rejectNote}`,
      },
    }),
    prisma.deal.update({
      where: { id: dealId },
      data: { updatedAt: new Date() },
    }),
  ]);

  // Send notification email in safe try/catch
  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";

    if (participantRole === "AGENT") {
      const recipientEmail = deal.customer?.email || deal.contactEmail;
      const recipientName = deal.customer?.name || deal.contactName;
      if (recipientEmail) {
        await sendDealOfferRejectedEmail(recipientEmail, {
          recipient_name: recipientName,
          sender_name: user.name || deal.agent?.name || "Listing Agent",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          message_preview: reason || null,
          deal_link: `${protocol}://${host}/customer/dashboard/deals/${deal.id}`,
        });
      }
    } else {
      if (deal.agent?.email) {
        await sendDealOfferRejectedEmail(deal.agent.email, {
          recipient_name: deal.agent.name,
          sender_name: user.name || deal.customer?.name || deal.contactName || "Client",
          listing_title: deal.listing.title,
          amount: formattedAmount,
          message_preview: reason || null,
          deal_link: `${protocol}://${host}/agent/dashboard/deals/${deal.id}`,
        });
      }
    }
  } catch (err) {
    console.error("Failed to send offer rejected email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Add a private note (AGENT ONLY).
 * Never shown or returned to customer.
 */
export async function addDealPrivateNote(dealId: number, text: string) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);

  if (participantRole !== "AGENT" && participantRole !== "ADMIN") {
    return { success: false, message: "Private notes are only available to the listing agent." };
  }

  const parsed = PrivateNoteSchema.safeParse({ dealId, text });
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message || "Invalid note." };
  }

  await prisma.dealMessage.create({
    data: {
      dealId,
      senderRole: "AGENT",
      senderId: user.id,
      type: "NOTE",
      text: parsed.data.text,
      agentReadAt: new Date(),
    },
  });

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Manual stage change override (AGENT or ADMIN).
 * Available via the "More" (...) menu.
 */
export async function changeDealStage(dealId: number, stage: DealStage) {
  const { deal, participantRole } = await requireDealParticipant(dealId);

  if (participantRole !== "AGENT" && participantRole !== "ADMIN") {
    return { success: false, message: "Only agents can change the deal stage." };
  }

  const stageLabel = DEAL_STAGE_LABELS[stage] || stage;

  await prisma.$transaction([
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage,
        updatedAt: new Date(),
        ...(stage === "CLOSED_WON" || stage === "CLOSED_LOST" ? { closedAt: new Date() } : {}),
      },
    }),
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: `Stage changed to ${stageLabel}`,
      },
    }),
  ]);

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Mark all unread messages as read for current viewer.
 */
export async function markDealThreadRead(dealId: number) {
  const { participantRole } = await requireDealParticipant(dealId);
  const now = new Date();

  if (participantRole === "AGENT" || participantRole === "ADMIN") {
    await prisma.dealMessage.updateMany({
      where: { dealId, agentReadAt: null },
      data: { agentReadAt: now },
    });
  } else if (participantRole === "CUSTOMER") {
    await prisma.dealMessage.updateMany({
      where: { dealId, type: { not: "NOTE" }, customerReadAt: null },
      data: { customerReadAt: now },
    });
  }

  return { success: true };
}

/**
 * Retrieve an existing deal or create a new one when a customer clicks "Make a Deal" on a listing.
 */
export async function getOrCreateCustomerDeal(listingId: number) {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, requireLogin: true };
  }

  const userId = Number(session.user.id);
  const userRole = session.user.role;

  if (userRole === "CUSTOMER") {
    let deal = await prisma.deal.findFirst({
      where: {
        listingId,
        OR: [
          { customerId: userId },
          ...(session.user.email ? [{ contactEmail: session.user.email }] : []),
        ],
      },
      select: { id: true, listing: { select: { slug: true } } },
    });

    if (!deal) {
      const listing = await prisma.listing.findUnique({
        where: { id: listingId },
        select: {
          id: true,
          slug: true,
          agentId: true,
          title: true,
          agent: { select: { email: true, name: true } },
        },
      });

      if (!listing) {
        return { success: false, message: "Listing not found." };
      }

      deal = await prisma.deal.create({
        data: {
          listingId: listing.id,
          agentId: listing.agentId,
          customerId: userId,
          contactName: session.user.name || "Customer",
          contactEmail: session.user.email || "",
          contactPhone: null,
          message: "Customer initiated Make a Deal.",
        },
        select: { id: true, listing: { select: { slug: true } } },
      });

      await prisma.dealMessage.create({
        data: {
          dealId: deal.id,
          senderRole: "CUSTOMER",
          senderId: userId,
          type: "MESSAGE",
          text: "Hi, I am interested in this property and would like to make a deal.",
          agentReadAt: null,
          customerReadAt: new Date(),
        },
      });

      try {
        const host = (await headers()).get("host") ?? "localhost:3000";
        const protocol = host.startsWith("localhost") ? "http" : "https";
        const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${deal.id}`;

        await sendNewLeadNotification(listing.agent.email, {
          listingTitle: listing.title,
          contactName: session.user.name || "Customer",
          contactEmail: session.user.email || "",
          contactPhone: null,
          message: "Customer initiated Make a Deal.",
          dealUrl,
        });
      } catch (err) {
        console.error("Failed to send deal notification email:", err);
      }
    }

    revalidateDealPaths(deal.listing.slug, deal.id);
    return { success: true, dealUrl: `/customer/dashboard/deals/${deal.id}` };
  } else if (userRole === "AGENT") {
    const deal = await prisma.deal.findFirst({
      where: { listingId, agentId: userId },
      select: { id: true },
    });
    if (deal) {
      return { success: true, dealUrl: `/agent/dashboard/deals/${deal.id}` };
    }
    return { success: true, dealUrl: `/agent/dashboard/deals` };
  }

  return { success: false, message: "Only customer accounts can initiate deals on listings." };
}

/**
 * Customer action to book a site visit directly from the Deal detail page.
 * Transitions stage from NEW -> CONTACTED -> VIEWING_SCHEDULED (or directly to VIEWING_SCHEDULED),
 * records the customer's request message, writes audit events, and notifies the agent via email.
 */
export async function bookCustomerSiteVisit(dealId: number) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);
  if (participantRole !== "CUSTOMER") {
    return { success: false, message: "Only customers can book a site visit." };
  }

  const wasNew = deal.stage === "NEW";

  const customerMsg = {
    dealId,
    senderRole: "CUSTOMER" as const,
    senderId: user.id,
    type: "MESSAGE" as const,
    text: "Hi, I am interested in this property and would like to schedule a site visit.",
    agentReadAt: null,
    customerReadAt: new Date(),
  };

  const systemEvents: { dealId: number; senderRole: "SYSTEM"; type: "EVENT"; text: string }[] = [];

  if (wasNew) {
    systemEvents.push({
      dealId,
      senderRole: "SYSTEM",
      type: "EVENT",
      text: "Stage changed to Contacted",
    });
  }

  systemEvents.push({
    dealId,
    senderRole: "SYSTEM",
    type: "EVENT",
    text: "Stage changed to Viewing scheduled",
  });

  await prisma.$transaction([
    prisma.dealMessage.create({ data: customerMsg }),
    ...systemEvents.map((evt) => prisma.dealMessage.create({ data: evt })),
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage: "VIEWING_SCHEDULED",
        updatedAt: new Date(),
      },
    }),
  ]);

  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;
    const listingUrl = `${protocol}://${host}/listings/${deal.listing.slug}`;

    const agentEmail = deal.agent?.email;
    const agentName = deal.agent?.name || "Agent";

    if (agentEmail) {
      await sendSiteVisitRequestEmail(agentEmail, {
        agentName,
        listingTitle: deal.listing.title,
        contactName: deal.contactName,
        contactEmail: deal.contactEmail,
        contactPhone: deal.contactPhone,
        message: "Customer requested a site visit via Deal conversation.",
        dealUrl,
        listingUrl,
      });
    }
  } catch (err) {
    console.error("Failed to send site visit notification email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}

/**
 * Customer action to mark a property deal as Not Interested.
 * Sets the stage to CLOSED_LOST, logs the decision, and alerts the agent.
 */
export async function customerNotInterested(dealId: number) {
  const { user, deal, participantRole } = await requireDealParticipant(dealId);
  if (participantRole !== "CUSTOMER") {
    return { success: false, message: "Only customers can perform this action." };
  }

  await prisma.$transaction([
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "CUSTOMER",
        senderId: user.id,
        type: "MESSAGE",
        text: "I am no longer interested in this property.",
        agentReadAt: null,
        customerReadAt: new Date(),
      },
    }),
    prisma.dealMessage.create({
      data: {
        dealId,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: "Stage changed to Closed lost",
      },
    }),
    prisma.deal.update({
      where: { id: dealId },
      data: {
        stage: "CLOSED_LOST",
        closedAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  ]);

  try {
    const host = (await headers()).get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;

    const agentEmail = deal.agent?.email;
    if (agentEmail) {
      await sendLeadOptedOutEmail(agentEmail, {
        agentName: deal.agent.name,
        contactName: deal.contactName,
        contactEmail: deal.contactEmail,
        listingTitle: deal.listing.title,
        dealUrl,
        reason: "Customer marked as Not Interested.",
      });
    }
  } catch (err) {
    console.error("Failed to send opted-out email:", err);
  }

  revalidateDealPaths(deal.listing.slug, dealId);
  return { success: true };
}



