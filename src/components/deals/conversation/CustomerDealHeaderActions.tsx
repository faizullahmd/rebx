"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bookCustomerSiteVisit, customerNotInterested } from "@/lib/actions/deals";

interface CustomerDealHeaderActionsProps {
  dealId: number;
  currentStage: string;
}

export function CustomerDealHeaderActions({
  dealId,
  currentStage,
}: CustomerDealHeaderActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const isClosed = currentStage === "CLOSED_LOST" || currentStage === "CLOSED_WON";
  const isSiteVisitScheduled = currentStage === "VIEWING_SCHEDULED";

  function handleBookSiteVisit() {
    setFeedback(null);
    startTransition(async () => {
      const res = await bookCustomerSiteVisit(dealId);
      if (res.success) {
        setFeedback({ type: "success", message: "Site visit booked!" });
        router.refresh();
      } else {
        setFeedback({ type: "error", message: res.message || "Failed to book site visit." });
      }
    });
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
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {feedback.message}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {/* 1. Book site visit */}
        <button
          type="button"
          onClick={handleBookSiteVisit}
          disabled={isPending || isClosed}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shadow-xs ${
            isSiteVisitScheduled
              ? "bg-emerald-600 hover:bg-emerald-700 text-white"
              : "bg-gray-900 hover:bg-gray-800 text-white disabled:opacity-50"
          }`}
          title="Schedule a site visit for this property"
        >
          <span>📅</span>
          <span>
            {isPending
              ? "Updating..."
              : isSiteVisitScheduled
                ? "Book site visit"
                : "Book site visit"}
          </span>
        </button>

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
    </div>
  );
}
