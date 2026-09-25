import "server-only";
import { prisma } from "@/lib/prisma";

export function getBookingsForDeveloper(developerId: string) {
  return prisma.booking.findMany({
    where: { deal: { listing: { developerId } } },
    include: {
      deal: {
        include: {
          listing: { select: { title: true, slug: true } },
          agent: { select: { name: true, email: true } },
        },
      },
    },
    // MySQL sorts ENUM columns by declaration order, not alphabetically — BookingStatus
    // declares PENDING_CONFIRMATION before CONFIRMED, so asc surfaces bookings still
    // needing action first.
    orderBy: [{ status: "asc" }, { bookingDate: "desc" }],
  });
}

export function getAllBookingsAdmin() {
  return prisma.booking.findMany({
    include: {
      deal: {
        include: {
          listing: { select: { title: true, slug: true } },
          agent: { select: { name: true, email: true } },
        },
      },
    },
    orderBy: [{ status: "asc" }, { bookingDate: "desc" }],
  });
}
