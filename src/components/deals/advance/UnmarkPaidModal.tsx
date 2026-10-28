"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { unmarkAdvancePaid } from "@/lib/actions/advances";

interface UnmarkPaidModalProps {
  dealId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function UnmarkPaidModal({ dealId, isOpen, onClose }: UnmarkPaidModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setError(null);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError("Please provide a reason of at least 5 characters.");
      return;
    }
    if (reason.trim().length > 500) {
      setError("Reason cannot exceed 500 characters.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await unmarkAdvancePaid(dealId, { reason: reason.trim() });
      if (!res.success) {
        setError(res.message || "Failed to update advance.");
      } else {
        onClose();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unmark-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-xl border border-gray-100">
        <h3 id="unmark-modal-title" className="text-base font-bold text-gray-900">
          Mark Advance as Unpaid
        </h3>
        <p className="mt-1.5 text-xs text-gray-600 leading-relaxed">
          This will revert the advance status back to <strong>Pending</strong> and clear the payment date.
          The customer will receive an email notifying them that the payment status was updated.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <label htmlFor="unmarkReasonInput" className="block text-xs font-semibold text-gray-700 mb-1">
              Reason for un-marking (Required, min 5 chars):
            </label>
            <textarea
              ref={textareaRef}
              id="unmarkReasonInput"
              rows={3}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Check bounced, transfer cancelled, or entered in error"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-xs focus:border-gray-900 focus:outline-none"
              required
            />
            <span className="text-[10px] text-gray-400 block text-right mt-0.5">
              {reason.length}/500 chars (kept for internal audit history only)
            </span>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || reason.trim().length < 5}
              className="min-h-[44px] rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition cursor-pointer shadow-xs"
            >
              {isPending ? "Updating..." : "Revert to Pending"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
