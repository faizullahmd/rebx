"use client";

import { useActionState } from "react";
import type { Booking } from "@prisma/client";
import { updateBooking } from "@/lib/actions/bookings";
import type { BookingFormState } from "@/lib/validation/booking";

type ClientBooking = Omit<Booking, "saleAmount"> & { saleAmount: number };

const statusLabels: Record<Booking["status"], string> = {
  PENDING_CONFIRMATION: "Pending developer confirmation",
  CONFIRMED: "Confirmed",
};

function toDateInputValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function BookingPanel({ booking }: { booking: ClientBooking }) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    updateBooking.bind(null, booking.id),
    undefined
  );

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Booking</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            booking.status === "CONFIRMED"
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {statusLabels[booking.status]}
        </span>
      </div>

      {state?.message && <p className="text-xs text-gray-600">{state.message}</p>}

      <form action={formAction} className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="bookingNumber" className="text-xs text-gray-500">
            Booking number
          </label>
          <input
            id="bookingNumber"
            name="bookingNumber"
            defaultValue={booking.bookingNumber ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="unitNumber" className="text-xs text-gray-500">
            Unit number
          </label>
          <input
            id="unitNumber"
            name="unitNumber"
            defaultValue={booking.unitNumber ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="saleAmount" className="text-xs text-gray-500">
            Sale amount
          </label>
          <input
            id="saleAmount"
            name="saleAmount"
            type="number"
            defaultValue={String(booking.saleAmount)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          {state?.errors?.saleAmount && (
            <p className="text-xs text-red-600">{state.errors.saleAmount[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bookingDate" className="text-xs text-gray-500">
            Booking date
          </label>
          <input
            id="bookingDate"
            name="bookingDate"
            type="date"
            defaultValue={toDateInputValue(booking.bookingDate)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          {state?.errors?.bookingDate && (
            <p className="text-xs text-red-600">{state.errors.bookingDate[0]}</p>
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor="notes" className="text-xs text-gray-500">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={booking.notes ?? ""}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="col-span-2 w-fit rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save booking details"}
        </button>
      </form>
    </div>
  );
}
