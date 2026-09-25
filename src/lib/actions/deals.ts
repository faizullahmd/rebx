"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/session";
import {
  sendNewLeadNotification,
  sendInquiryConfirmation,
  sendBookingConfirmationNeededEmail,
} from "@/lib/email";
import {
  CustomerInquirySchema,
  InquiryFormSchema,
  ManualDealSchema,
  UpdateDealSchema,
  type InquiryFormState,
  type UpdateDealState,
} from "@/lib/validation/deal";

function revalidateDealPaths(listingSlug?: string) {
  revalidatePath("/agent/dashboard/deals");
  revalidatePath("/agent/dashboard");
  revalidatePath("/customer/dashboard");
  revalidatePath("/admin/dashboard/deals");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
  if (listingSlug) revalidatePath(`/listings/${listingSlug}`);
}

export async function createInquiry(
  listingId: string,
  _prevState: InquiryFormState,
  formData: FormData
): Promise<InquiryFormState> {
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { agent: { select: { name: true, email: true } } },
  });
  if (!listing || listing.status !== "ACTIVE") {
    return { message: "This listing is no longer accepting inquiries." };
  }

  const session = await auth();
  const isCustomer = session?.user?.role === "CUSTOMER";

  let contactName: string;
  let contactEmail: string;
  let contactPhone: string | null;
  let message: string | null;
  let dealId: string;

  if (isCustomer) {
    const validatedFields = CustomerInquirySchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
      return { errors: validatedFields.error.flatten().fieldErrors };
    }

    contactName = session!.user.name;
    contactEmail = session!.user.email;
    contactPhone = validatedFields.data.contactPhone || null;
    message = validatedFields.data.message || null;

    const deal = await prisma.deal.create({
      data: {
        listingId,
        agentId: listing.agentId,
        customerId: Number(session!.user.id),
        contactName,
        contactEmail,
        contactPhone,
        message,
      },
    });
    dealId = deal.id;
  } else {
    const validatedFields = InquiryFormSchema.safeParse(Object.fromEntries(formData));
    if (!validatedFields.success) {
      return { errors: validatedFields.error.flatten().fieldErrors };
    }

    contactName = validatedFields.data.contactName;
    contactEmail = validatedFields.data.contactEmail;
    contactPhone = validatedFields.data.contactPhone || null;
    message = validatedFields.data.message || null;

    const deal = await prisma.deal.create({
      data: {
        listingId,
        agentId: listing.agentId,
        contactName,
        contactEmail,
        contactPhone,
        message,
      },
    });
    dealId = deal.id;
  }

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const dealUrl = `${protocol}://${host}/agent/dashboard/deals/${dealId}`;

  await sendNewLeadNotification(listing.agent.email, {
    listingTitle: listing.title,
    contactName,
    contactEmail,
    contactPhone,
    message,
    dealUrl,
  });

  await sendInquiryConfirmation(contactEmail, {
    listingTitle: listing.title,
    agentName: listing.agent.name,
  });

  revalidateDealPaths(listing.slug);
  return { message: "Thanks! The listing agent will be in touch soon." };
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

  const deal = await prisma.deal.create({
    data: {
      listingId,
      agentId: agent.id,
      contactName,
      contactEmail,
      contactPhone: contactPhone || null,
      message: message || null,
    },
  });

  revalidateDealPaths(listing.slug);
  redirect(`/agent/dashboard/deals/${deal.id}`);
}

export async function updateDeal(
  dealId: string,
  _prevState: UpdateDealState,
  formData: FormData
): Promise<UpdateDealState> {
  const user = await requireUser();

  const existing = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        include: {
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
              saleAmount: offerAmount ?? existing.listing.price,
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

  revalidateDealPaths(existing.listing.slug);
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/developer/dashboard/bookings");
  revalidatePath("/admin/dashboard/bookings");

  return { message: "Deal updated." };
}

export async function deleteDeal(dealId: string) {
  const user = await requireUser();

  const existing = await prisma.deal.findUnique({ where: { id: dealId }, include: { listing: true } });
  if (!existing) return;
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    throw new Error("You are not allowed to delete this deal.");
  }

  await prisma.deal.delete({ where: { id: dealId } });

  revalidateDealPaths(existing.listing.slug);
  redirect(user.role === "ADMIN" ? "/admin/dashboard/deals" : "/agent/dashboard/deals");
}
