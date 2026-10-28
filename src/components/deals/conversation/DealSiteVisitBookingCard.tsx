"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DealMessageType, DealMessageSenderRole } from "@prisma/client";
import { confirmSiteVisit } from "@/lib/actions/site-visits";
import { RescheduleVisitModal } from "@/components/agent/site-visits/RescheduleVisitModal";
import { CancelVisitModal } from "@/components/agent/site-visits/CancelVisitModal";
import { getGoogleMapsDirectionsUrl } from "@/lib/maps";
import type { SiteVisitBookingInfo } from "@/lib/site-visit-proposal";
import type { SerializedDealSiteVisit } from "@/lib/data/site-visits";

interface DealSiteVisitBookingCardProps {
  dealId: number;
  message: {
    id: number;
    senderRole: DealMessageSenderRole;
    type: DealMessageType;
    text: string;
    createdAt: Date | string;
    sender?: { name: string; role: string } | null;
  };
  booking: SiteVisitBookingInfo;
  siteVisit: SerializedDealSiteVisit | null;
  viewerRole: "AGENT" | "CUSTOMER";
  dealAgentName?: string;
  dealCustomerName?: string;
  propertyTitle?: string;
}

export function DealSiteVisitBookingCard({
  dealId,
  message,
  booking,
  siteVisit,
  viewerRole,
  dealAgentName = "Agent",
  dealCustomerName = "Client",
  propertyTitle = "Property",
}: DealSiteVisitBookingCardProps) {
  const router = useRouter();
  const [isPendingConfirm, startConfirmTransition] = useTransition();
  const [currentStatus, setCurrentStatus] = useState<string>(
    siteVisit?.status || "PENDING"
  );
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  const isAgent = viewerRole === "AGENT";
  const isCustomer = viewerRole === "CUSTOMER";
  const isMine =
    (isAgent && message.senderRole === "AGENT") ||
    (isCustomer && message.senderRole === "CUSTOMER");

  // Format date consistent with other deal message bubbles
  const dateObj = new Date(message.createdAt);
  const day = dateObj.getDate();
  const suffix =
    day === 1 || day === 21 || day === 31
      ? "st"
      : day === 2 || day === 22
        ? "nd"
        : day === 3 || day === 23
          ? "rd"
          : "th";

  const dateStr = `${day}${suffix}, ${dateObj.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  })} ${dateObj.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })}`;

  const senderTitle = isMine
    ? isCustomer
      ? "Me (Buyer)"
      : "Me (Agent)"
    : message.senderRole === "AGENT"
      ? `Agent (${dealAgentName})`
      : `Buyer (${dealCustomerName})`;

  // Google Maps directions url for in-person visits
  const directionsUrl =
    siteVisit?.listing ? getGoogleMapsDirectionsUrl(siteVisit.listing) : null;

  // Format visit date for display and modals
  const formattedVisitDate = siteVisit?.date
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(siteVisit.date))
    : booking.dateStr;

  const currentVisitTimeSlot = siteVisit?.timeSlot || booking.timeSlot;

  // Check if this visit was rescheduled from the initial booking message text
  const isRescheduled = Boolean(
    siteVisit &&
      (formattedVisitDate.replace(/-/g, " ") !== booking.dateStr.replace(/-/g, " ") ||
        siteVisit.timeSlot !== booking.timeSlot)
  );

  function handleConfirm() {
    if (!siteVisit) return;
    setFeedback(null);
    startConfirmTransition(async () => {
      const res = await confirmSiteVisit(siteVisit.id);
      if (res.success) {
        setCurrentStatus("CONFIRMED");
        setFeedback({
          type: "success",
          message: res.message || "Site visit confirmed successfully.",
        });
        router.refresh();
      } else {
        setFeedback({
          type: "error",
          message: res.message || "Failed to confirm site visit.",
        });
      }
    });
  }

  return (
    <div
      className={`my-2.5 rounded-xl border border-gray-200 bg-white p-4 shadow-2xs transition-shadow ${
        isMine ? "border-l-4 border-l-gray-900" : ""
      }`}
    >
      {/* Header: matches message bubble style */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs sm:text-sm font-semibold text-gray-900">
          {senderTitle}
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{dateStr}</span>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Message Text */}
      <div className="mt-2 text-xs sm:text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
        {message.text}
      </div>

      {/* Interactive Site Visit Action & Status Box */}
      <div className="mt-3.5 rounded-xl border border-gray-200/90 bg-gray-50/80 p-3.5 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Status & Details */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              {currentStatus === "PENDING" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>Pending Confirmation</span>
                </span>
              )}
              {currentStatus === "CONFIRMED" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                  <span className="font-bold">✓</span>
                  <span>Confirmed</span>
                </span>
              )}
              {currentStatus === "CANCELLED" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                  <span>✕</span>
                  <span>Cancelled</span>
                </span>
              )}
              {currentStatus === "COMPLETED" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
                  <span>✓</span>
                  <span>Completed</span>
                </span>
              )}

              <span className="text-xs font-medium text-gray-600">
                {booking.visitType === "VIRTUAL" ? "📹 Virtual Tour" : "📍 In-Person Visit"}
              </span>
            </div>

            <p className="text-xs text-gray-500 flex items-center flex-wrap gap-1.5">
              <span>
                Scheduled for{" "}
                <span className="font-semibold text-gray-800">
                  {siteVisit ? formattedVisitDate : booking.dateStr}
                </span>{" "}
                at{" "}
                <span className="font-semibold text-gray-800">
                  {currentVisitTimeSlot}
                </span>
              </span>
              {isRescheduled && (
                <span className="inline-flex items-center text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                  Updated from {booking.dateStr} ({booking.timeSlot})
                </span>
              )}
            </p>
          </div>

          {/* Action Buttons for Agent */}
          {isAgent && siteVisit && (
            <div className="flex items-center flex-wrap gap-2 pt-1 sm:pt-0">
              {currentStatus === "PENDING" && (
                <>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={isPendingConfirm}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 transition cursor-pointer"
                  >
                    {isPendingConfirm ? (
                      <>
                        <svg
                          className="h-3.5 w-3.5 animate-spin text-white"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v8z"
                          />
                        </svg>
                        <span>Confirming...</span>
                      </>
                    ) : (
                      <>
                        <span>✓</span>
                        <span>Confirm Visit</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCancelModal(true)}
                    disabled={isPendingConfirm}
                    className="text-xs font-medium text-gray-500 hover:text-red-600 px-2 py-1.5 transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </>
              )}

              {currentStatus === "CONFIRMED" && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowRescheduleModal(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 shadow-2xs hover:bg-gray-50 active:bg-gray-100 transition cursor-pointer"
                  >
                    <span>🔄</span>
                    <span>Reschedule</span>
                  </button>

                  {booking.visitType === "IN_PERSON" && directionsUrl && (
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs sm:text-sm font-medium text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                    >
                      <span>🗺️</span>
                      <span>Directions ↗</span>
                    </a>
                  )}
                </>
              )}
            </div>
          )}

          {/* Action Links for Customer */}
          {isCustomer && (
            <div className="flex items-center gap-2 pt-1 sm:pt-0">
              {currentStatus === "CONFIRMED" &&
                booking.visitType === "IN_PERSON" &&
                directionsUrl && (
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs sm:text-sm font-medium text-blue-700 hover:bg-blue-100 transition cursor-pointer"
                  >
                    <span>🗺️</span>
                    <span>Directions ↗</span>
                  </a>
                )}
            </div>
          )}
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            className={`mt-3 flex items-center justify-between rounded-lg p-2.5 text-xs font-medium border ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-gray-400 hover:text-gray-600 text-xs ml-2"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {siteVisit && showRescheduleModal && (
        <RescheduleVisitModal
          siteVisitId={siteVisit.id}
          customerName={dealCustomerName || siteVisit.customer?.name || "Client"}
          propertyTitle={propertyTitle || siteVisit.listing?.title || "Property"}
          currentDateFormatted={formattedVisitDate}
          currentTimeSlot={siteVisit.timeSlot}
          isOpen={showRescheduleModal}
          onClose={() => setShowRescheduleModal(false)}
          onSuccess={() => {
            setShowRescheduleModal(false);
            setFeedback({
              type: "success",
              message:
                currentStatus === "CONFIRMED"
                  ? "Reschedule proposal sent to client."
                  : "Site visit rescheduled successfully.",
            });
            router.refresh();
          }}
        />
      )}

      {/* Cancel Modal */}
      {siteVisit && showCancelModal && (
        <CancelVisitModal
          siteVisitId={siteVisit.id}
          customerName={dealCustomerName || siteVisit.customer?.name || "Client"}
          propertyTitle={propertyTitle || siteVisit.listing?.title || "Property"}
          visitDateFormatted={formattedVisitDate}
          timeSlot={siteVisit.timeSlot}
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          onSuccess={() => {
            setShowCancelModal(false);
            setCurrentStatus("CANCELLED");
            setFeedback({
              type: "success",
              message: "Site visit cancelled successfully.",
            });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
