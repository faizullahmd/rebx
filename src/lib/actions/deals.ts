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
  const deal = await prisma.deal.create({
    data: {
      listingId: listing.id,
      agentId: listing.agentId,
      ...(contact.customerId ? { customerId: contact.customerId } : {}),
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      message: contact.message,
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

  revalidateDealPaths(existing.listing.slug);
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/developer/dashboard/bookings");
  revalidatePath("/admin/dashboard/bookings");

  return { message: "Deal updated." };
}

export async function deleteDeal(dealId: number) {
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
