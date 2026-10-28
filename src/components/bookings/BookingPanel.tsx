"use client";

import { useActionState } from "react";
import type { Booking } from "@prisma/client";
import { saveBookingForDeal } from "@/lib/actions/bookings";
import type { BookingFormState } from "@/lib/validation/booking";

type ClientBooking = Omit<Booking, "saleAmount"> & { saleAmount: number };

interface BookingPanelProps {
  dealId: number;
  booking: ClientBooking | null;
  defaultSaleAmount?: number | null;
}

const statusLabels: Record<Booking["status"], string> = {
  PENDING_CONFIRMATION: "Pending developer confirmation",
  CONFIRMED: "Confirmed",
};

function toDateInputValue(date: Date) {
  return new Date(date).toISOString().slice(0, 10);
}

export function BookingPanel({ dealId, booking, defaultSaleAmount }: BookingPanelProps) {
  const [state, formAction, pending] = useActionState<BookingFormState, FormData>(
    saveBookingForDeal.bind(null, dealId),
    undefined
  );

  const initialSaleAmount = booking != null
    ? String(booking.saleAmount)
    : defaultSaleAmount != null && defaultSaleAmount > 0
      ? String(defaultSaleAmount)
      : "";

  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border border-gray-200 p-4 bg-white">
      <div className="flex items-center justify-between">
        <h2 className="text-base sm:text-lg font-bold text-gray-900">Booking Details</h2>
        {booking ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              booking.status === "CONFIRMED"
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {statusLabels[booking.status]}
          </span>
        ) : (
          <span className="rounded-full bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-medium">
            New Booking
          </span>
        )}
      </div>

      {state?.message && (
        <p className={`text-xs ${state.errors ? "text-red-600" : "text-green-700 font-medium"}`}>
          {state.message}
        </p>
      )}

      <form action={formAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="bookingNumber" className="text-xs font-medium text-gray-600">
            Booking number
          </label>
          <input
            id="bookingNumber"
            name="bookingNumber"
            defaultValue={booking?.bookingNumber ?? ""}
            placeholder="e.g. BK-2026-001"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="unitNumber" className="text-xs font-medium text-gray-600">
            Unit / Flat number
          </label>
          <input
            id="unitNumber"
            name="unitNumber"
            defaultValue={booking?.unitNumber ?? ""}
            placeholder="e.g. 402, Villa 12"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="saleAmount" className="text-xs font-medium text-gray-600">
            Sale amount (agreed price)
          </label>
          <input
            id="saleAmount"
            name="saleAmount"
            type="number"
            step="any"
            defaultValue={initialSaleAmount}
            placeholder="e.g. 8500000"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none font-semibold"
            required
          />
          {initialSaleAmount && Number(initialSaleAmount) > 0 && (
            <p className="text-[11px] text-gray-500 font-medium">
              Formatted: ₹{Math.round(Number(initialSaleAmount)).toLocaleString("en-IN")}
            </p>
          )}
          {state?.errors?.saleAmount && (
            <p className="text-xs text-red-600">{state.errors.saleAmount[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="bookingDate" className="text-xs font-medium text-gray-600">
            Booking date
          </label>
          <input
            id="bookingDate"
            name="bookingDate"
            type="date"
            defaultValue={booking ? toDateInputValue(booking.bookingDate) : new Date().toISOString().slice(0, 10)}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none"
            required
          />
          {state?.errors?.bookingDate && (
            <p className="text-xs text-red-600">{state.errors.bookingDate[0]}</p>
          )}
        </div>
        <div className="col-span-1 sm:col-span-2 flex flex-col gap-1">
          <label htmlFor="notes" className="text-xs font-medium text-gray-600">
            Booking Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={booking?.notes ?? ""}
            placeholder="Additional formal booking terms or conditions..."
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="col-span-1 sm:col-span-2 min-h-[44px] w-fit rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer shadow-xs"
        >
          {pending ? "Saving…" : booking ? "Save booking details" : "Create booking details"}
        </button>
      </form>
    </div>
  );
}
