"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  SITE_VISIT_TIME_SLOTS,
  type SiteVisitTimeSlot,
  type SiteVisitTypeEnum,
} from "@/lib/validation/site-visit";
import { bookSiteVisit } from "@/lib/actions/site-visits";
import { getGoogleMapsDirectionsUrl } from "@/lib/maps";

interface SiteVisitModalProps {
  dealId: number;
  propertyTitle: string;
  propertyAddress?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function SiteVisitModal({
  dealId,
  propertyTitle,
  propertyAddress,
  isOpen,
  onClose,
  onSuccess,
}: SiteVisitModalProps) {
  const router = useRouter();
  const [date, setDate] = useState<string>("");
  const [timeSlot, setTimeSlot] = useState<SiteVisitTimeSlot>(SITE_VISIT_TIME_SLOTS[1]); // default 10:00 AM - 11:00 AM
  const [visitType, setVisitType] = useState<SiteVisitTypeEnum>("IN_PERSON");
  const [notes, setNotes] = useState<string>("");

  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [successDetails, setSuccessDetails] = useState<{
    date: string;
    timeSlot: string;
    visitType: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();
  const modalRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const minDate = getTodayString();

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setDate("");
      setTimeSlot(SITE_VISIT_TIME_SLOTS[1]);
      setVisitType("IN_PERSON");
      setNotes("");
      setError(null);
      setIsSuccess(false);
      setSuccessDetails(null);
      setTimeout(() => dateInputRef.current?.focus(), 50);
    }
  }, [isOpen]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!date) {
      setError("Please select a visit date.");
      return;
    }

    startTransition(async () => {
      const res = await bookSiteVisit(dealId, {
        date,
        timeSlot,
        visitType,
        notes: notes.trim() || undefined,
      });

      if (!res.success) {
        setError(res.message || "Failed to book site visit.");
      } else {
        setIsSuccess(true);
        setSuccessDetails({
          date,
          timeSlot,
          visitType: visitType === "VIRTUAL" ? "Virtual Tour" : "In-Person Visit",
        });
        if (onSuccess) onSuccess();
        router.refresh();
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="site-visit-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-xl border border-gray-100 my-8 max-h-[90vh] overflow-y-auto"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3">
          <div>
            <h2 id="site-visit-modal-title" className="text-base sm:text-lg font-bold text-gray-900">
              Book Site Visit
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Choose a date and time to inspect this property.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Success Confirmation State */}
        {isSuccess && successDetails ? (
          <div className="mt-5 flex flex-col items-center text-center py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-2xl mb-3">
              ✓
            </div>
            <h3 className="text-base font-bold text-gray-900">Site Visit Booked!</h3>
            <p className="mt-1 text-xs text-gray-600 max-w-sm">
              Your visit request has been sent to the listing agent. The appointment status is{" "}
              <strong className="text-amber-800">Pending</strong> until confirmed.
            </p>

            <div className="mt-4 w-full rounded-xl bg-gray-50 border border-gray-200/80 p-3.5 text-left text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Property:</span>
                <span className="font-semibold text-gray-900 truncate max-w-[240px]">
                  {propertyTitle}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Date:</span>
                <span className="font-semibold text-gray-900">
                  {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                    new Date(successDetails.date)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Time Slot:</span>
                <span className="font-semibold text-gray-900">{successDetails.timeSlot}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Type:</span>
                <span className="font-semibold text-gray-900">{successDetails.visitType}</span>
              </div>
              {propertyAddress && propertyAddress.trim() && (
                <div className="flex justify-between items-center pt-1 border-t border-gray-200/60">
                  <span className="text-gray-500">Address:</span>
                  <a
                    href={getGoogleMapsDirectionsUrl({ addressLine: propertyAddress }) || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 text-[11px]"
                  >
                    <span>View Map & Directions</span>
                    <span className="text-[10px]">↗</span>
                  </a>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 min-h-[44px] w-full rounded-lg bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-gray-800 transition cursor-pointer shadow-xs"
            >
              Done
            </button>
          </div>
        ) : (
          /* Form State */
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4 text-xs sm:text-sm">
            {/* Property Info Card */}
            <div className="rounded-xl bg-gray-50/80 p-3.5 border border-gray-200/80">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Property
              </span>
              <h3 className="mt-0.5 text-sm font-bold text-gray-900">{propertyTitle}</h3>
              {propertyAddress && propertyAddress.trim() && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-600">
                  <span className="flex items-center gap-1">
                    <span>📍</span>
                    <span>{propertyAddress}</span>
                  </span>
                  {getGoogleMapsDirectionsUrl({ addressLine: propertyAddress }) && (
                    <a
                      href={getGoogleMapsDirectionsUrl({ addressLine: propertyAddress })!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      <span>View Map</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Visit Type Segmented Control */}
            <div className="flex flex-col gap-1.5">
              <label className="font-semibold text-gray-800 text-xs">Visit Type</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setVisitType("IN_PERSON")}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition cursor-pointer ${
                    visitType === "IN_PERSON"
                      ? "border-gray-900 bg-gray-900 text-white shadow-xs"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>📍</span>
                  <span>In-Person Visit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisitType("VIRTUAL")}
                  className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-xs font-semibold transition cursor-pointer ${
                    visitType === "VIRTUAL"
                      ? "border-gray-900 bg-gray-900 text-white shadow-xs"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span>📹</span>
                  <span>Virtual Tour</span>
                </button>
              </div>
            </div>

            {/* Visit Date */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="visitDateInput" className="font-semibold text-gray-800 text-xs">
                Visit Date <span className="text-red-500">*</span>
              </label>
              <input
                ref={dateInputRef}
                id="visitDateInput"
                type="date"
                min={minDate}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setError(null);
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs sm:text-sm font-medium text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 cursor-pointer"
                required
              />
              <span className="text-[11px] text-gray-400">
                Visits must be scheduled for today or a future date.
              </span>
            </div>

            {/* Time Slot */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="timeSlotSelect" className="font-semibold text-gray-800 text-xs">
                Available Time Slot <span className="text-red-500">*</span>
              </label>
              <select
                id="timeSlotSelect"
                value={timeSlot}
                onChange={(e) => {
                  setTimeSlot(e.target.value as SiteVisitTimeSlot);
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

            {/* Notes (Optional) */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="visitNotesInput" className="font-semibold text-gray-800 text-xs">
                Notes for Listing Agent (Optional)
              </label>
              <textarea
                id="visitNotesInput"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Interested in seeing the clubhouse and parking spaces"
                className="w-full rounded-lg border border-gray-300 p-2.5 text-xs text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                maxLength={1000}
              />
            </div>

            {/* Error Banner */}
            {error && (
              <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                {error}
              </div>
            )}

            {/* Footer Buttons */}
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
                disabled={isPending || !date}
                className="min-h-[44px] rounded-lg bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                {isPending ? "Booking..." : "Confirm Visit"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
