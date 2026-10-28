"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { cancelSiteVisit } from "@/lib/actions/site-visits";

interface CancelVisitModalProps {
  siteVisitId: number;
  customerName: string;
  propertyTitle: string;
  visitDateFormatted: string;
  timeSlot: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CancelVisitModal({
  siteVisitId,
  customerName,
  propertyTitle,
  visitDateFormatted,
  timeSlot,
  isOpen,
  onClose,
  onSuccess,
}: CancelVisitModalProps) {
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
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await cancelSiteVisit(siteVisitId, {
        reason: reason.trim() || undefined,
      });

      if (!res.success) {
        setError(res.message || "Failed to cancel site visit.");
      } else {
        onSuccess();
        onClose();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-xl border border-gray-100">
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 id="cancel-modal-title" className="text-base font-bold text-gray-900">
              Cancel Site Visit
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Notify customer that this visit cannot take place.
            </p>
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

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 text-xs sm:text-sm">
          {/* Appointment details preview */}
          <div className="rounded-xl bg-gray-50 border border-gray-200/80 p-3 text-xs space-y-1">
            <p className="font-semibold text-gray-900 truncate">{propertyTitle}</p>
            <p className="text-gray-600">
              Customer: <span className="font-medium text-gray-800">{customerName}</span>
            </p>
            <p className="text-gray-600">
              Date &amp; Time: <span className="font-medium text-gray-800">{visitDateFormatted} · {timeSlot}</span>
            </p>
          </div>

          <div>
            <label htmlFor="cancelReasonInput" className="block text-xs font-semibold text-gray-700 mb-1">
              Cancellation Reason (Optional)
            </label>
            <textarea
              ref={textareaRef}
              id="cancelReasonInput"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Property under scheduled maintenance, or agent unavailable due to personal conflict"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-xs text-gray-900 focus:border-gray-900 focus:outline-none"
              maxLength={500}
            />
            <span className="text-[10px] text-gray-400 block text-right mt-0.5">
              {reason.length}/500 chars (will be visible to the customer)
            </span>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              disabled={isPending}
              onClick={onClose}
              className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
            >
              Keep Visit
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="min-h-[44px] rounded-lg bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              {isPending ? "Cancelling..." : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
