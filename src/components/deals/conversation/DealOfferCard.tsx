"use client";

import { useState, useTransition } from "react";
import type { DealOfferStatus, DealMessageSenderRole } from "@prisma/client";
import { formatListingPrice } from "@/lib/price";
import { acceptDealOffer, rejectDealOffer } from "@/lib/actions/deals";

interface DealOfferCardProps {
  dealId: number;
  message: {
    id: number;
    senderRole: DealMessageSenderRole;
    amount: number | null;
    currency: string;
    offerStatus: DealOfferStatus | null;
    expiresAt: Date | null;
    createdAt: Date;
    text: string;
    sender?: { name: string } | null;
  };
  viewerRole: "AGENT" | "CUSTOMER";
  dealAgentName?: string;
  dealCustomerName?: string;
  onOpenCounter?: (amount: number, messageId: number) => void;
}

export function DealOfferCard({
  dealId,
  message,
  viewerRole,
  dealAgentName = "Agent",
  dealCustomerName = "Client",
  onOpenCounter,
}: DealOfferCardProps) {
  const [isPending, startTransition] = useTransition();
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const formattedAmount = message.amount
    ? formatListingPrice(message.amount, message.currency || "INR")
    : formatListingPrice(0, message.currency || "INR");

  const isFromOtherParty =
    (viewerRole === "AGENT" && message.senderRole === "CUSTOMER") ||
    (viewerRole === "CUSTOMER" && message.senderRole === "AGENT");

  const canActOnOffer = isFromOtherParty && message.offerStatus === "PENDING";

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

  const dateStr = `${day}${suffix}, ${dateObj.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} - ${dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}`;

  const isSenderMe =
    (viewerRole === "AGENT" && message.senderRole === "AGENT") ||
    (viewerRole === "CUSTOMER" && message.senderRole === "CUSTOMER");

  function handleAccept() {
    setActionError(null);
    startTransition(async () => {
      const res = await acceptDealOffer(dealId, message.id);
      if (!res.success) {
        setActionError(res.message || "Failed to accept offer.");
      } else {
        setShowAcceptConfirm(false);
      }
    });
  }

  function handleReject() {
    setActionError(null);
    startTransition(async () => {
      const res = await rejectDealOffer(dealId, message.id, rejectReason || undefined);
      if (!res.success) {
        setActionError(res.message || "Failed to reject offer.");
      } else {
        setShowRejectConfirm(false);
      }
    });
  }

  return (
    <div className="my-3 rounded-xl border border-gray-200 bg-white p-4 sm:p-5 shadow-xs transition-shadow">
      <div className="flex items-start gap-3.5">
        {/* Money icon on the left matching the screenshot */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-700">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.7}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm sm:text-base font-bold text-gray-900">
                {formattedAmount} Offer
              </h4>
              {message.offerStatus && message.offerStatus !== "PENDING" && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    message.offerStatus === "ACCEPTED"
                      ? "bg-green-100 text-green-800"
                      : message.offerStatus === "COUNTERED"
                        ? "bg-gray-100 text-gray-600"
                        : "bg-red-100 text-red-700"
                  }`}
                >
                  {message.offerStatus.toLowerCase()}
                </span>
              )}
            </div>
            <span className="text-[11px] text-gray-400">{dateStr}</span>
          </div>

          <p className="mt-1 text-xs text-gray-600 leading-relaxed">
            {isSenderMe
              ? `You offered ${formattedAmount} for this property. Please feel free to reach out to negotiate with the other party here.`
              : `${viewerRole === "AGENT" ? dealCustomerName : "Seller"} offered ${formattedAmount} for this property. Please feel free to reach out to negotiate here.`}
          </p>

          {message.text && message.text !== `Offered ${formattedAmount}` && (
            <p className="mt-1.5 text-xs text-gray-700 italic bg-gray-50 rounded-md p-2 border border-gray-100">
              “{message.text}”
            </p>
          )}

          {actionError && (
            <p className="mt-2 text-xs text-red-600 font-medium" role="alert">
              {actionError}
            </p>
          )}

          {/* Action Buttons for Pending Offer */}
          {canActOnOffer && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowAcceptConfirm(true)}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Accept Offer
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowRejectConfirm(true)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Decline
              </button>
            </div>
          )}

          {!isFromOtherParty && message.offerStatus === "PENDING" && (
            <p className="mt-2 text-[11px] text-amber-600 italic">
              Awaiting response from {viewerRole === "AGENT" ? dealCustomerName : "Seller"}...
            </p>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Accept */}
      {showAcceptConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-gray-100">
            <h3 className="text-base font-bold text-gray-900">Accept this offer?</h3>
            <p className="mt-2 text-sm text-gray-600">
              You are about to accept the offer of{" "}
              <strong className="text-gray-900">{formattedAmount}</strong>. This will transition the
              deal to <span className="font-semibold text-teal-800">Under contract</span>.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowAcceptConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleAccept}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
              >
                {isPending ? "Accepting…" : "Yes, accept offer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reject */}
      {showRejectConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-gray-100">
            <h3 className="text-base font-bold text-gray-900">Decline this offer?</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to decline the offer of{" "}
              <strong className="text-gray-900">{formattedAmount}</strong>?
            </p>
            <div className="mt-3">
              <label htmlFor="rejectReason" className="block text-xs font-medium text-gray-700 mb-1">
                Optional reason:
              </label>
              <input
                id="rejectReason"
                type="text"
                placeholder="e.g. Below expected price"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-gray-900 focus:outline-none"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowRejectConfirm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleReject}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 cursor-pointer disabled:opacity-50"
              >
                {isPending ? "Declining…" : "Decline offer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
