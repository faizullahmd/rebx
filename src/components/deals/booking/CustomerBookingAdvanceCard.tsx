import { formatListingPrice } from "@/lib/price";

interface CustomerBookingAdvanceCardProps {
  propertyName: string;
  currency: string;
  agreedPrice: number | null;
  booking: {
    unitNumber: string | null;
    bookingNumber: string | null;
    bookingDate: Date | string;
    saleAmount: number;
    status: "PENDING_CONFIRMATION" | "CONFIRMED";
    notes?: string | null;
    advance?: {
      amount: number;
      percentUsed: number;
      currency: string;
      status: "PENDING" | "PAID";
      paidAt: Date | string | null;
    } | null;
  } | null;
}

export function CustomerBookingAdvanceCard({
  propertyName,
  currency,
  agreedPrice,
  booking,
}: CustomerBookingAdvanceCardProps) {
  const effectiveSaleAmount = booking?.saleAmount ?? agreedPrice ?? 0;
  const effectiveCurrency =
    !currency || currency === "USD" || booking?.advance?.currency === "USD"
      ? "INR"
      : booking?.advance?.currency || currency || "INR";
  const advance = booking?.advance ?? null;

  const isConfirmed = booking?.status === "CONFIRMED";
  const bookingStatusLabel = isConfirmed ? "Confirmed" : "Pending";

  const advancePaid = advance?.status === "PAID";
  const advancePending = advance?.status === "PENDING";
  const balanceRemaining = Math.max(0, effectiveSaleAmount - (advance ? Number(advance.amount) : 0));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 shadow-xs">
      <div className="flex items-center gap-2.5 pb-4 border-b border-gray-100">
        <span className="flex h-3 w-3 rounded-full bg-emerald-500" />
        <h3 className="text-base font-bold text-gray-900">Booking &amp; advance</h3>
      </div>

      {/* Booking Details Grid */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
        <div>
          <span className="block text-gray-500 font-medium">Property Name</span>
          <span className="mt-1 block text-sm font-semibold text-gray-900 truncate">
            {propertyName}
          </span>
        </div>

        <div>
          <span className="block text-gray-500 font-medium">Agreed Sale Price</span>
          <span className="mt-1 block text-sm font-bold text-gray-900">
            {formatListingPrice(effectiveSaleAmount, effectiveCurrency)}
          </span>
        </div>

        <div>
          <span className="block text-gray-500 font-medium">Booking Status</span>
          <span
            className={`mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
              isConfirmed
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {bookingStatusLabel}
          </span>
        </div>

        {booking?.unitNumber && (
          <div>
            <span className="block text-gray-500 font-medium">Unit / Flat</span>
            <span className="mt-1 block text-xs font-semibold text-gray-800">
              {booking.unitNumber}
            </span>
          </div>
        )}

        {booking?.bookingNumber && (
          <div>
            <span className="block text-gray-500 font-medium">Booking Number</span>
            <span className="mt-1 block text-xs font-semibold text-gray-800">
              {booking.bookingNumber}
            </span>
          </div>
        )}

        {booking && (
          <div>
            <span className="block text-gray-500 font-medium">Booking Date</span>
            <span className="mt-1 block text-xs font-semibold text-gray-800">
              {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                new Date(booking.bookingDate)
              )}
            </span>
          </div>
        )}
      </div>

      {/* Advance Section */}
      <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50/70 p-4">
        <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">
          Advance Payment Details
        </h4>

        {!advance ? (
          <p className="mt-2 text-xs text-gray-600">
            The agent will share advance booking details soon.
          </p>
        ) : advancePending ? (
          <div className="mt-2 flex flex-col gap-1 text-xs">
            <p className="font-semibold text-amber-900">
              Advance of {formatListingPrice(advance.amount, effectiveCurrency)} requested.
              Please pay as arranged with your agent.
            </p>
            <p className="text-[11px] text-gray-500">
              Calculated token: {Number(advance.percentUsed)}% of agreed sale price
            </p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5 text-xs">
            <p className="font-semibold text-green-900 flex items-center gap-1.5">
              <span>✅</span>
              <span>
                Advance of {formatListingPrice(advance.amount, effectiveCurrency)} received on{" "}
                {advance.paidAt
                  ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                      new Date(advance.paidAt)
                    )
                  : "record"}
                .
              </span>
            </p>
            <p className="text-gray-600">
              Advance percentage: <strong className="text-gray-800">{Number(advance.percentUsed)}%</strong>
            </p>
            <p className="text-sm font-bold text-gray-900 pt-1 border-t border-neutral-200 mt-1">
              Balance remaining:{" "}
              <span className="text-emerald-700">
                {formatListingPrice(balanceRemaining, effectiveCurrency)}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* Helper Text */}
      <p className="mt-4 text-[11px] text-gray-500 italic">
        Payments are made directly to the agent or developer as agreed. REBX does not collect payments.
      </p>
    </div>
  );
}
