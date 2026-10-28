"use client";

import { useState } from "react";
import { AdvanceModal } from "./AdvanceModal";
import { UnmarkPaidModal } from "./UnmarkPaidModal";

interface AdvanceBookingCardProps {
  dealId: number;
  saleAmount: number | null;
  currency: string;
  advance: {
    id: number;
    amount: number;
    percentUsed: number;
    currency: string;
    status: "PENDING" | "PAID";
    paidAt: Date | string | null;
    notes: string | null;
    markedPaidBy: number | null;
  } | null;
}

function formatRupeeAmount(num: number | null | undefined): string {
  if (num == null || isNaN(num) || num <= 0) return "₹0";
  return `₹${Math.round(num).toLocaleString("en-IN")}`;
}

export function AdvanceBookingCard({
  dealId,
  saleAmount,
  currency,
  advance,
}: AdvanceBookingCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [modalInitialMarkAsPaid, setModalInitialMarkAsPaid] = useState(false);
  const [showUnmarkModal, setShowUnmarkModal] = useState(false);

  const effectiveCurrency =
    !currency || currency === "USD" || advance?.currency === "USD"
      ? "INR"
      : advance?.currency || currency || "INR";
  const hasSaleAmount = saleAmount != null && saleAmount > 0;
  const suggested10Percent = hasSaleAmount ? Math.round(saleAmount * 0.1) : 0;
  const numericSaleAmount = saleAmount || 0;
  const advanceAmount = advance ? Number(advance.amount) : 0;
  const balanceRemaining = Math.max(0, numericSaleAmount - advanceAmount);

  // Check if sale price changed since advance was recorded
  const salePriceChanged = Boolean(
    advance &&
      hasSaleAmount &&
      advance.percentUsed > 0 &&
      Math.abs(numericSaleAmount * (Number(advance.percentUsed) / 100) - advanceAmount) > 5
  );

  const formattedPaidDate = advance?.paidAt
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(advance.paidAt))
    : null;

  return (
    <>
      <div
        className={`max-w-2xl w-full rounded-lg border p-4 transition ${
          !advance
            ? "border-gray-200 bg-gray-50 text-gray-900"
            : advance.status === "PENDING"
              ? "border-amber-200 bg-amber-50/70 text-gray-900"
              : "border-emerald-200 bg-emerald-50/70 text-gray-900"
        }`}
      >
        {/* STATE A: NOT RECORDED */}
        {!advance && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap min-w-0">
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-200 text-gray-700 text-xs font-bold shrink-0 select-none"
                  aria-hidden="true"
                >
                  ₹
                </span>
                <span className="text-sm font-bold text-gray-900">Advance booking</span>
                {/* Tooltip */}
                <div className="group relative inline-flex items-center">
                  <button
                    type="button"
                    tabIndex={0}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-600 hover:bg-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-400 cursor-help"
                    aria-label="Info: Payments are made directly to the agent or developer. REBX does not collect payments."
                  >
                    i
                  </button>
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block group-focus-within:block z-50 w-64 rounded-md bg-gray-900 p-2 text-[11px] font-normal text-white shadow-lg leading-snug text-center"
                  >
                    Payments are made directly to the agent or developer. REBX does not collect payments.
                  </div>
                </div>
              </div>

              {hasSaleAmount ? (
                <div className="text-xs text-gray-600 sm:ml-1 break-words">
                  Suggested{" "}
                  <strong className="text-gray-900 font-semibold">
                    {formatRupeeAmount(suggested10Percent)}
                  </strong>{" "}
                  · 10% of {formatRupeeAmount(numericSaleAmount)}
                </div>
              ) : (
                <span className="text-xs text-amber-700 sm:ml-1 font-medium">
                  Add the sale amount to calculate the advance.
                </span>
              )}
            </div>

            <div className="w-full sm:w-auto shrink-0 pt-1 sm:pt-0">
              <button
                type="button"
                disabled={!hasSaleAmount}
                onClick={() => {
                  setModalInitialMarkAsPaid(false);
                  setShowEditModal(true);
                }}
                aria-label="Record advance booking"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shrink-0 shadow-xs flex items-center justify-center"
              >
                Record advance
              </button>
            </div>
          </div>
        )}

        {/* STATE B: PENDING */}
        {advance && advance.status === "PENDING" && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-900">Advance booking</span>
                <span className="rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-xs font-semibold">
                  Pending
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-700">
                <span className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                  {formatRupeeAmount(advanceAmount)}
                </span>
                <span className="text-gray-600 font-medium">
                  {Number(advance.percentUsed)}% of {formatRupeeAmount(numericSaleAmount)}
                </span>
                <span className="text-amber-300 hidden sm:inline" aria-hidden="true">
                  |
                </span>
                <span className="text-gray-600">
                  Balance after advance{" "}
                  <strong className="text-gray-900 font-semibold">
                    {formatRupeeAmount(balanceRemaining)}
                  </strong>
                </span>
              </div>

              {salePriceChanged && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-900 font-medium">
                  <span aria-hidden="true">⚠️</span>
                  <span>Sale price changed since this advance was recorded.</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2.5 shrink-0 pt-1 sm:pt-0">
              <button
                type="button"
                onClick={() => {
                  setModalInitialMarkAsPaid(true);
                  setShowEditModal(true);
                }}
                aria-label="Mark advance as paid"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800 transition cursor-pointer shadow-xs flex items-center justify-center"
              >
                Mark as paid
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalInitialMarkAsPaid(false);
                  setShowEditModal(true);
                }}
                aria-label="Edit advance booking"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] rounded-lg sm:border sm:border-gray-300 sm:bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition cursor-pointer flex items-center justify-center"
              >
                Edit
              </button>
            </div>
          </div>
        )}

        {/* STATE C: PAID */}
        {advance && advance.status === "PAID" && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0 select-none"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className="text-sm font-bold text-gray-900">Advance booking</span>
                <span className="rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 text-xs font-semibold">
                  Paid
                </span>
              </div>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-700">
                <span className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">
                  {formatRupeeAmount(advanceAmount)}
                </span>
                {formattedPaidDate && (
                  <span className="text-gray-600 font-medium">Paid on {formattedPaidDate}</span>
                )}
                <span className="text-emerald-300 hidden sm:inline" aria-hidden="true">
                  |
                </span>
                <span className="text-gray-600">
                  Balance remaining{" "}
                  <strong className="text-gray-900 font-semibold">
                    {formatRupeeAmount(balanceRemaining)}
                  </strong>
                </span>
              </div>

              {salePriceChanged && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-900 font-medium">
                  <span aria-hidden="true">⚠️</span>
                  <span>Sale price changed since this advance was recorded.</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 shrink-0 pt-1 sm:pt-0">
              <button
                type="button"
                onClick={() => {
                  setModalInitialMarkAsPaid(false);
                  setShowEditModal(true);
                }}
                aria-label="Edit advance booking"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition cursor-pointer flex items-center justify-center"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowUnmarkModal(true)}
                aria-label="Mark advance as unpaid"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-0 text-xs font-medium text-gray-500 hover:text-amber-800 hover:underline transition cursor-pointer py-1 flex items-center justify-center"
              >
                Mark as unpaid
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Popups */}
      {hasSaleAmount && (
        <AdvanceModal
          dealId={dealId}
          saleAmount={numericSaleAmount}
          currency={effectiveCurrency}
          existingAdvance={advance}
          isOpen={showEditModal}
          initialMarkAsPaid={modalInitialMarkAsPaid}
          onClose={() => {
            setShowEditModal(false);
            setModalInitialMarkAsPaid(false);
          }}
        />
      )}

      {advance && (
        <UnmarkPaidModal
          dealId={dealId}
          isOpen={showUnmarkModal}
          onClose={() => setShowUnmarkModal(false)}
        />
      )}
    </>
  );
}
