"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { sendBookingConfirmedEmail } from "@/lib/email";
import {
  BookingFormSchema,
  type BookingFormState,
} from "@/lib/validation/booking";

function revalidateBookingPaths(dealId: string) {
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/agent/dashboard/deals");
  revalidatePath("/developer/dashboard");
  revalidatePath("/developer/dashboard/bookings");
  revalidatePath("/admin/dashboard/bookings");
}

export async function updateBooking(
  bookingId: string,
  _prevState: BookingFormState,
  formData: FormData
): Promise<BookingFormState> {
  const user = await requireUser();

  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { deal: true },
  });
  if (!existing) {
    return { message: "Booking not found." };
  }
  if (user.role !== "ADMIN" && existing.deal.agentId !== user.id) {
    return { message: "You are not allowed to edit this booking." };
  }

  const validatedFields = BookingFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { bookingNumber, unitNumber, saleAmount, bookingDate, notes } = validatedFields.data;

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      bookingNumber: bookingNumber || null,
      unitNumber: unitNumber || null,
      saleAmount,
      bookingDate,
      notes: notes || null,
    },
  });

  revalidateBookingPaths(existing.dealId);
  return { message: "Booking updated." };
}

export async function confirmBooking(bookingId: string) {
  const user = await requireUser();

  const existing = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      deal: {
        include: {
          agent: { select: { email: true } },
          listing: {
            select: {
              title: true,
              developerId: true,
              developer: {
                select: { name: true, developerProfile: { select: { companyName: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!existing) return;

  const isLinkedDeveloper =
    user.role === "DEVELOPER" && existing.deal.listing.developerId === user.id;
  if (user.role !== "ADMIN" && !isLinkedDeveloper) {
    throw new Error("You are not allowed to confirm this booking.");
  }

  if (existing.status !== "CONFIRMED") {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const bookingUrl = `${protocol}://${host}/agent/dashboard/deals/${existing.dealId}`;

    const developerCompanyName =
      existing.deal.listing.developer?.developerProfile?.companyName ??
      existing.deal.listing.developer?.name ??
      "The developer";

    await sendBookingConfirmedEmail(existing.deal.agent.email, {
      listingTitle: existing.deal.listing.title,
      developerCompanyName,
      bookingUrl,
    });
  }

  revalidateBookingPaths(existing.dealId);
}
