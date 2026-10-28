"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { customerNotInterested } from "@/lib/actions/deals";
import { SiteVisitModal } from "@/components/deals/site-visit/SiteVisitModal";
import { RescheduleVisitModal } from "@/components/agent/site-visits/RescheduleVisitModal";

export interface SerializedSiteVisitHeaderInfo {
  id: number;
  status: string; // "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED"
  date: string | Date;
  timeSlot: string;
  visitType?: string;
  agent?: {
    name?: string | null;
    email?: string;
  } | null;
}

interface CustomerDealHeaderActionsProps {
  dealId: number;
  currentStage: string;
  propertyTitle?: string;
  propertyAddress?: string | null;
  siteVisit?: SerializedSiteVisitHeaderInfo | null;
}

function formatDate(d: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(d));
}

export function CustomerDealHeaderActions({
  dealId,
  currentStage,
  propertyTitle = "Property",
  propertyAddress = null,
  siteVisit = null,
}: CustomerDealHeaderActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [isSiteVisitModalOpen, setIsSiteVisitModalOpen] = useState(false);
  const [isPendingNoticeModalOpen, setIsPendingNoticeModalOpen] = useState(false);
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] = useState(false);

  const isClosed = currentStage === "CLOSED_LOST" || currentStage === "CLOSED_WON";
  const isVisitPending = siteVisit?.status === "PENDING";
  const isVisitConfirmed = siteVisit?.status === "CONFIRMED";

  function handleSiteVisitButtonClick() {
    setFeedback(null);
    if (isVisitPending) {
      setFeedback({
        type: "info",
        message: "Your site visit confirmation by the agent is pending.",
      });
      setIsPendingNoticeModalOpen(true);
    } else {
      setIsSiteVisitModalOpen(true);
    }
  }

  function handleMakeADeal() {
    const targetUrl = `/customer/dashboard/deals/${dealId}#deal-offer-input`;
    if (typeof window !== "undefined" && window.location.pathname === `/customer/dashboard/deals/${dealId}`) {
      const input = document.getElementById("deal-offer-input") as HTMLInputElement | null;
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => {
          input.focus();
          input.classList.add("ring-2", "ring-blue-500", "border-blue-500");
          setTimeout(() => {
            input.classList.remove("ring-2", "ring-blue-500", "border-blue-500");
          }, 2000);
        }, 300);
      }
    } else {
      router.push(targetUrl);
    }
  }

  function handleNotInterested() {
    if (
      !window.confirm(
        "Are you sure you want to mark this property as Not Interested? This will close the deal conversation."
      )
    ) {
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const res = await customerNotInterested(dealId);
      if (res.success) {
        setFeedback({ type: "success", message: "Marked as not interested." });
        router.refresh();
      } else {
        setFeedback({ type: "error", message: res.message || "Action failed." });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5 w-full sm:w-auto">
      {feedback && (
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded transition-all ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : feedback.type === "info"
                ? "bg-amber-50 text-amber-800 border border-amber-200"
                : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {feedback.message}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {/* 1. Site Visit Button: Reschedule when CONFIRMED, Book site visit otherwise */}
        {isVisitConfirmed && siteVisit ? (
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setIsRescheduleModalOpen(true);
            }}
            disabled={isPending || isClosed}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title="Reschedule your confirmed site visit"
          >
            <span>🔄</span>
            <span>Reschedule site visit</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSiteVisitButtonClick}
            disabled={isPending || isClosed}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            title={
              isVisitPending
                ? "Site visit confirmation is pending by the agent"
                : "Schedule a site visit for this property"
            }
          >
            <span>📅</span>
            <span>Book site visit</span>
          </button>
        )}

        {/* 2. Make a deal */}
        <button
          type="button"
          onClick={handleMakeADeal}
          disabled={isClosed}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
          title="Make an offer on this property"
        >
          <span>🤝</span>
          <span>Make a deal</span>
        </button>

        {/* 3. Not interested */}
        <button
          type="button"
          onClick={handleNotInterested}
          disabled={isPending || isClosed}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-gray-700 shadow-xs hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer disabled:opacity-50"
          title="Mark as not interested"
        >
          <span>✕</span>
          <span>{currentStage === "CLOSED_LOST" ? "Not interested (Closed)" : "Not interested"}</span>
        </button>
      </div>

      {/* Pending Confirmation Modal */}
      {isPendingNoticeModalOpen && siteVisit && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pending-visit-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 sm:p-6 shadow-xl border border-gray-100">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600 border border-amber-200">
                  <span className="text-base">⏳</span>
                </div>
                <div>
                  <h3 id="pending-visit-modal-title" className="text-base font-bold text-gray-900">
                    Confirmation Pending
                  </h3>
                  <span className="text-xs text-amber-700 font-medium">
                    Awaiting Agent Confirmation
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPendingNoticeModalOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs sm:text-sm">
              <p className="text-gray-600">
                You already have a site visit request submitted for this property. Confirmation by the assigned agent is currently pending.
              </p>

              <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3.5 space-y-1.5 text-xs">
                <div className="font-semibold text-gray-900 truncate">
                  {propertyTitle}
                </div>
                <div className="text-gray-700 flex items-center gap-1.5">
                  <span className="text-gray-500">Requested Date:</span>
                  <span className="font-semibold text-gray-900">{formatDate(siteVisit.date)}</span>
                </div>
                <div className="text-gray-700 flex items-center gap-1.5">
                  <span className="text-gray-500">Requested Time:</span>
                  <span className="font-semibold text-gray-900">{siteVisit.timeSlot}</span>
                </div>
                {siteVisit.visitType && (
                  <div className="text-gray-700 flex items-center gap-1.5">
                    <span className="text-gray-500">Tour Type:</span>
                    <span className="font-medium text-gray-800">
                      {siteVisit.visitType === "VIRTUAL" ? "Virtual Video Tour" : "In-Person Tour"}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-500">
                The agent has been notified and will confirm or respond to your request shortly. You will receive an update in this chat once confirmed.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setIsPendingNoticeModalOpen(false)}
                className="min-h-[40px] rounded-lg bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-gray-800 transition cursor-pointer shadow-xs"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal (for confirmed site visit) */}
      {siteVisit && isVisitConfirmed && (
        <RescheduleVisitModal
          siteVisitId={siteVisit.id}
          propertyTitle={propertyTitle}
          agentName={siteVisit.agent?.name || undefined}
          currentDateFormatted={formatDate(siteVisit.date)}
          currentTimeSlot={siteVisit.timeSlot}
          isOpen={isRescheduleModalOpen}
          onClose={() => setIsRescheduleModalOpen(false)}
          onSuccess={() => {
            setFeedback({
              type: "success",
              message: "Site visit rescheduled. Status updated to pending agent confirmation.",
            });
            setIsRescheduleModalOpen(false);
            router.refresh();
          }}
          viewerRole="CUSTOMER"
        />
      )}

      {/* Site Visit Booking Modal */}
      <SiteVisitModal
        dealId={dealId}
        propertyTitle={propertyTitle}
        propertyAddress={propertyAddress}
        isOpen={isSiteVisitModalOpen}
        onClose={() => setIsSiteVisitModalOpen(false)}
        onSuccess={() => {
          setFeedback({ type: "success", message: "Site visit booked!" });
          router.refresh();
        }}
      />
    </div>
  );
}
