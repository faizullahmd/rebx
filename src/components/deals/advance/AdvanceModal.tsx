"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { formatListingPrice } from "@/lib/price";
import { saveBookingAdvance } from "@/lib/actions/advances";

interface AdvanceModalProps {
  dealId: number;
  saleAmount: number;
  currency: string;
  existingAdvance?: {
    id: number;
    amount: number;
    percentUsed: number;
    status: "PENDING" | "PAID";
    paidAt: Date | string | null;
    notes: string | null;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  initialMarkAsPaid?: boolean;
}

function toTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AdvanceModal({
  dealId,
  saleAmount,
  currency,
  existingAdvance,
  isOpen,
  onClose,
  initialMarkAsPaid = false,
}: AdvanceModalProps) {
  const default10Percent = Math.round(saleAmount * 0.1);

  const initialAmount = existingAdvance ? Number(existingAdvance.amount) : default10Percent;
  const [amountStr, setAmountStr] = useState<string>(String(initialAmount));
  const [markAsPaid, setMarkAsPaid] = useState<boolean>(
    Boolean(initialMarkAsPaid || existingAdvance?.status === "PAID")
  );
  const [paidAt, setPaidAt] = useState<string>(
    existingAdvance?.paidAt
      ? new Date(existingAdvance.paidAt).toISOString().slice(0, 10)
      : toTodayString()
  );
  const [notes, setNotes] = useState<string>(existingAdvance?.notes || "");
  const [editReason, setEditReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      const amt = existingAdvance ? Number(existingAdvance.amount) : default10Percent;
      setAmountStr(String(amt));
      setMarkAsPaid(Boolean(initialMarkAsPaid || existingAdvance?.status === "PAID"));
      setPaidAt(
        existingAdvance?.paidAt
          ? new Date(existingAdvance.paidAt).toISOString().slice(0, 10)
          : toTodayString()
      );
      setNotes(existingAdvance?.notes || "");
      setEditReason("");
      setError(null);
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen, existingAdvance, default10Percent, initialMarkAsPaid]);

  // Handle Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentNumericAmount = parseFloat(amountStr) || 0;
  const currentPercent =
    saleAmount > 0
      ? ((currentNumericAmount / saleAmount) * 100).toFixed(1)
      : "0.0";

  const isPaidAndAmountChanged =
    existingAdvance &&
    existingAdvance.status === "PAID" &&
    Math.abs(Number(existingAdvance.amount) - currentNumericAmount) > 0.01;

  function handleResetTo10() {
    setAmountStr(String(default10Percent));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (currentNumericAmount <= 0) {
      setError("Please enter a valid advance amount greater than 0.");
      return;
    }

    if (currentNumericAmount > saleAmount) {
      setError("Advance amount cannot exceed the total agreed sale price.");
      return;
    }

    if (isPaidAndAmountChanged && editReason.trim().length < 5) {
      setError("A reason of at least 5 characters is required when modifying a paid advance.");
      return;
    }

    startTransition(async () => {
      const res = await saveBookingAdvance(dealId, {
        amount: currentNumericAmount,
        markAsPaid,
        paidAt: markAsPaid ? paidAt : undefined,
        notes: notes.trim(),
        editReason: isPaidAndAmountChanged ? editReason.trim() : undefined,
      });

      if (!res.success) {
        setError(res.message || "Failed to save advance.");
      } else {
        onClose();
      }
    });
  }

  const currencyCode = "INR";
  const currencySymbol = "₹";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="advance-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-gray-100 my-8 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between border-b border-gray-100 pb-4">
          <div>
            <h2 id="advance-modal-title" className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Advance booking
            </h2>
            <div className="mt-1 text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              {currentNumericAmount > 0
                ? `₹${Math.round(currentNumericAmount).toLocaleString("en-IN")}`
                : "₹0"}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                {currentPercent}% of sale price
              </span>
              {currentNumericAmount !== default10Percent && (
                <button
                  type="button"
                  onClick={handleResetTo10}
                  className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Reset to 10%
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 text-xs sm:text-sm">
          {/* Sale Price Read-Only */}
          <div className="rounded-lg bg-gray-50 p-3 border border-gray-200/80">
            <span className="block text-xs font-medium text-gray-500">Agreed Sale Price</span>
            <span className="mt-0.5 block text-base font-bold text-gray-900">
              {formatListingPrice(saleAmount, currencyCode)}
              {saleAmount >= 100000 && (
                <span className="ml-2 text-xs font-normal text-gray-500">
                  (₹{Math.round(saleAmount).toLocaleString("en-IN")})
                </span>
              )}
            </span>
          </div>

          {/* Advance Amount */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="advanceAmountInput" className="font-semibold text-gray-700">
              Advance Amount ({currencySymbol})
            </label>
            <div className="relative rounded-lg shadow-2xs">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 font-medium">
                {currencySymbol}
              </span>
              <input
                ref={firstInputRef}
                id="advanceAmountInput"
                type="number"
                step="any"
                min="1"
                max={saleAmount}
                value={amountStr}
                onChange={(e) => {
                  setAmountStr(e.target.value);
                  setError(null);
                }}
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-8 pr-3 text-sm font-semibold text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                placeholder="Amount"
                required
              />
            </div>

            {/* Hint & Live % / Reset Link */}
            <div className="flex items-center justify-between text-xs text-gray-500 pt-0.5">
              <span>
                {currentNumericAmount === default10Percent
                  ? "10% of sale price"
                  : `${currentPercent}% of sale price`}
                {currentNumericAmount > 0 && (
                  <span className="ml-1 text-gray-400">
                    ({formatListingPrice(currentNumericAmount, currencyCode)})
                  </span>
                )}
              </span>
              {currentNumericAmount !== default10Percent && (
                <button
                  type="button"
                  onClick={handleResetTo10}
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Reset to 10%
                </button>
              )}
            </div>
          </div>

          {/* If Editing a Paid Advance: Reason required */}
          {isPaidAndAmountChanged && (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <label htmlFor="editReasonInput" className="font-semibold text-amber-900">
                Reason for Amount Change (Required)
              </label>
              <p className="text-[11px] text-amber-700">
                Because this advance was previously marked as paid, modifying the amount requires an audit reason.
              </p>
              <textarea
                id="editReasonInput"
                rows={2}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Buyer submitted supplemental token deposit or adjusted agreed token"
                className="mt-1 w-full rounded-md border border-amber-300 bg-white p-2 text-xs focus:border-gray-900 focus:outline-none"
                required
              />
            </div>
          )}

          {/* Mark as Paid Checkbox */}
          <div className="pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={markAsPaid}
                onChange={(e) => setMarkAsPaid(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer"
              />
              <span className="font-semibold text-gray-800">Mark as paid</span>
            </label>
            <p className="ml-6.5 text-[11px] text-gray-400">
              Payments occur directly between parties offline. REBX does not process payments.
            </p>
          </div>

          {/* Payment Date (shown only when Mark as Paid is checked) */}
          {markAsPaid && (
            <div className="flex flex-col gap-1 ml-6.5">
              <label htmlFor="paymentDateInput" className="font-semibold text-gray-700">
                Payment Date
              </label>
              <input
                id="paymentDateInput"
                type="date"
                max={toTodayString()}
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="w-full sm:w-60 rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-gray-900 focus:outline-none cursor-pointer"
                required
              />
            </div>
          )}

          {/* Notes (Optional) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="advanceNotesInput" className="font-semibold text-gray-700">
              Notes (Optional)
            </label>
            <textarea
              id="advanceNotesInput"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid by bank wire or escrow deposit"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-xs focus:border-gray-900 focus:outline-none"
            />
          </div>

          {/* Inline Error */}
          {error && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              {error}
            </div>
          )}

          {/* Action Buttons: Cancel on the left, Save on the right */}
          <div className="mt-4 flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-gray-300 px-5 py-2 font-medium text-gray-700 hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="min-h-[44px] rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer shadow-xs"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
