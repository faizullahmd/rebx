"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getOrCreateCustomerDeal } from "@/lib/actions/deals";

export function MakeDealCard({
  listingId,
  listingSlug,
  isLoggedIn,
  isCustomer,
  existingDealId,
}: {
  listingId: number;
  listingSlug: string;
  isLoggedIn: boolean;
  isCustomer: boolean;
  existingDealId?: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleClick = () => {
    if (!isLoggedIn) {
      // If customer is not logged in, redirect to login page with callbackUrl to return and open deal
      const callback = `/listings/${listingSlug}?startDeal=true`;
      router.push(`/login?callbackUrl=${encodeURIComponent(callback)}`);
      return;
    }

    if (existingDealId && isCustomer) {
      router.push(`/customer/dashboard/deals/${existingDealId}`);
      return;
    }

    startTransition(async () => {
      setErrorMsg(null);
      const res = await getOrCreateCustomerDeal(listingId);
      if (res.requireLogin) {
        const callback = `/listings/${listingSlug}?startDeal=true`;
        router.push(`/login?callbackUrl=${encodeURIComponent(callback)}`);
        return;
      }
      if (res.success && res.dealUrl) {
        router.push(res.dealUrl);
      } else {
        setErrorMsg(res.message || "Failed to open deal. Please try again.");
      }
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold">
          🤝
        </span>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Make a Deal</h3>
          <p className="text-[11px] text-gray-500">Direct Agent Negotiation</p>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-600 leading-relaxed">
        {existingDealId
          ? "You have a deal in progress for this property. Open the deal in your dashboard to view the conversation and submit offers."
          : "Ready to discuss pricing or make an offer? Connect directly with the listing agent to make a deal."}
      </p>

      {errorMsg && (
        <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-600">
          {errorMsg}
        </p>
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="mt-3 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-xs hover:bg-gray-800 active:scale-[0.99] transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {isPending ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span>Opening Deal…</span>
          </>
        ) : existingDealId ? (
          <>
            <span>Open Deal Conversation</span>
            <span aria-hidden="true">→</span>
          </>
        ) : (
          <>
            <span>Make a Deal</span>
            <span aria-hidden="true">→</span>
          </>
        )}
      </button>
    </div>
  );
}
