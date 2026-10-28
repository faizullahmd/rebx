"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  SITE_VISIT_TIME_SLOTS,
  type SiteVisitTimeSlot,
} from "@/lib/validation/site-visit";
import { rescheduleSiteVisit } from "@/lib/actions/site-visits";

interface RescheduleVisitModalProps {
  siteVisitId: number;
  customerName?: string;
  agentName?: string;
  propertyTitle: string;
  currentDateFormatted: string;
  currentTimeSlot: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  viewerRole?: "AGENT" | "CUSTOMER";
}

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function RescheduleVisitModal({
  siteVisitId,
  customerName,
  agentName,
  propertyTitle,
  currentDateFormatted,
  currentTimeSlot,
  isOpen,
  onClose,
  onSuccess,
  viewerRole = "AGENT",
}: RescheduleVisitModalProps) {
  const [newDate, setNewDate] = useState("");
  const [newTimeSlot, setNewTimeSlot] = useState<SiteVisitTimeSlot>(SITE_VISIT_TIME_SLOTS[1]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dateInputRef = useRef<HTMLInputElement>(null);
  const minDate = getTodayString();

  useEffect(() => {
    if (isOpen) {
      setNewDate("");
      setNewTimeSlot(SITE_VISIT_TIME_SLOTS[1]);
      setReason("");
      setError(null);
      setTimeout(() => dateInputRef.current?.focus(), 50);
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

    if (!newDate) {
      setError("Please select a new visit date.");
      return;
    }

    startTransition(async () => {
      const res = await rescheduleSiteVisit(siteVisitId, {
        date: newDate,
        timeSlot: newTimeSlot,
        reason: reason.trim() || undefined,
      });

      if (!res.success) {
        setError(res.message || "Failed to reschedule site visit.");
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
      aria-labelledby="reschedule-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-xl border border-gray-100 my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 id="reschedule-modal-title" className="text-base sm:text-lg font-bold text-gray-900">
              Reschedule Site Visit
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {viewerRole === "CUSTOMER"
                ? "Choose a new preferred date and time slot for your site visit."
                : "Propose a new date and time slot for this visit."}
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

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 text-xs sm:text-sm">
          {/* Current appointment info */}
          <div className="rounded-xl bg-gray-50 border border-gray-200/80 p-3.5 text-xs space-y-1">
            <p className="font-semibold text-gray-900 truncate">{propertyTitle}</p>
            {viewerRole === "CUSTOMER" ? (
              agentName ? (
                <p className="text-gray-600">
                  Agent: <span className="font-medium text-gray-800">{agentName}</span>
                </p>
              ) : null
            ) : customerName ? (
              <p className="text-gray-600">
                Customer: <span className="font-medium text-gray-800">{customerName}</span>
              </p>
            ) : null}
            <div className="pt-1 mt-1 border-t border-gray-200/60 flex items-center gap-2 text-amber-800">
              <span>Current appointment:</span>
              <span className="font-semibold">
                {currentDateFormatted} · {currentTimeSlot}
              </span>
            </div>
          </div>

          {/* New Date */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rescheduleDateInput" className="font-semibold text-gray-800 text-xs">
              New Visit Date <span className="text-red-500">*</span>
            </label>
            <input
              ref={dateInputRef}
              id="rescheduleDateInput"
              type="date"
              min={minDate}
              value={newDate}
              onChange={(e) => {
                setNewDate(e.target.value);
                setError(null);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs sm:text-sm font-medium text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 cursor-pointer"
              required
            />
          </div>

          {/* New Time Slot */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rescheduleTimeSlotSelect" className="font-semibold text-gray-800 text-xs">
              New Time Slot <span className="text-red-500">*</span>
            </label>
            <select
              id="rescheduleTimeSlotSelect"
              value={newTimeSlot}
              onChange={(e) => {
                setNewTimeSlot(e.target.value as SiteVisitTimeSlot);
                setError(null);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs sm:text-sm font-medium text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 cursor-pointer bg-white"
              required
            >
              {SITE_VISIT_TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </div>

          {/* Reschedule Reason */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="rescheduleReasonInput" className="font-semibold text-gray-800 text-xs">
              Reason / Note for Customer (Optional)
            </label>
            <textarea
              id="rescheduleReasonInput"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Host is unavailable at original time; proposing a slot 1 hour later"
              className="w-full rounded-lg border border-gray-300 p-2.5 text-xs text-gray-900 focus:border-gray-900 focus:outline-none"
              maxLength={500}
            />
            <span className="text-[10px] text-gray-400">
              The client will receive this proposal with Accept and Decline actions. The original appointment is preserved until the client accepts.
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !newDate}
              className="min-h-[44px] rounded-lg bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              {isPending
                ? viewerRole === "CUSTOMER"
                  ? "Rescheduling..."
                  : "Submitting Proposal..."
                : viewerRole === "CUSTOMER"
                  ? "Reschedule Site Visit"
                  : "Submit Reschedule Proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
