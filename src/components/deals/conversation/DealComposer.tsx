"use client";

import { useState, useTransition, useMemo, type KeyboardEvent } from "react";
import { sendDealMessage, sendDealOffer, counterDealOffer } from "@/lib/actions/deals";
import { parsePriceInput, formatListingPrice } from "@/lib/price";
import type { ExpiryOption } from "@/lib/validation/deal-message";

interface DealComposerProps {
  dealId: number;
  viewerRole: "AGENT" | "CUSTOMER";
  currencySymbol?: string;
  counterOfferState: { active: boolean; messageId: number | null; initialAmount: number } | null;
  onClearCounter: () => void;
  onSent: () => void;
}

export function DealComposer({
  dealId,
  viewerRole,
  currencySymbol = "₹",
  counterOfferState,
  onClearCounter,
  onSent,
}: DealComposerProps) {
  const [isPending, startTransition] = useTransition();
  const [messageText, setMessageText] = useState("");
  const [offerAmount, setOfferAmount] = useState<string>(
    counterOfferState?.initialAmount ? String(counterOfferState.initialAmount) : ""
  );
  const [expiry, setExpiry] = useState<ExpiryOption>("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const placeholderText =
    viewerRole === "AGENT" ? "Send a Message to Buyer" : "Send a Message to Seller";

  const buttonText = counterOfferState?.active
    ? "Send Counter Offer"
    : viewerRole === "AGENT"
      ? "Send To Buyer"
      : "Send To Seller";

  // Parse input dynamically (supports "7.5 Lakhs", "1.5 Cr", "750000", "7,50,000", etc.)
  const parsedPrice = useMemo(() => {
    if (!offerAmount.trim()) return null;
    const res = parsePriceInput(offerAmount);
    return res.numericPrice > 0 ? res.numericPrice : null;
  }, [offerAmount]);

  function handleSubmit() {
    setErrorMsg(null);
    const textTrimmed = messageText.trim();
    let numericAmount = 0;

    if (offerAmount.trim()) {
      const parsed = parsePriceInput(offerAmount);
      numericAmount = parsed.numericPrice;

      if (numericAmount <= 0) {
        setErrorMsg("Please enter a valid offer amount (e.g., 7.5 Lakhs, 1.5 Cr, or 750000).");
        return;
      }
    }

    const hasOffer = numericAmount > 0;

    if (!hasOffer && !textTrimmed) {
      setErrorMsg("Please enter a message or an offer amount.");
      return;
    }

    startTransition(async () => {
      let res;
      if (hasOffer) {
        if (counterOfferState?.active && counterOfferState.messageId) {
          res = await counterDealOffer(
            dealId,
            counterOfferState.messageId,
            numericAmount,
            expiry,
            textTrimmed || undefined
          );
        } else {
          res = await sendDealOffer(dealId, numericAmount, expiry, textTrimmed || undefined);
        }
      } else {
        res = await sendDealMessage(dealId, textTrimmed);
      }

      if (!res.success) {
        setErrorMsg(res.message || "Failed to send. Please try again.");
      } else {
        setMessageText("");
        setOfferAmount("");
        setExpiry("none");
        onClearCounter();
        onSent();
      }
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="border-t border-gray-200 bg-[#f8f9fa] p-4 sm:p-5 rounded-b-xl">
      {counterOfferState?.active && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2 text-xs text-amber-900">
          <span>
            Countering previous offer (Current: <strong>₹ {counterOfferState.initialAmount.toLocaleString("en-IN")}</strong>)
          </span>
          <button
            type="button"
            onClick={() => {
              onClearCounter();
              setOfferAmount("");
            }}
            className="font-bold text-amber-700 hover:text-amber-900 underline cursor-pointer"
          >
            Cancel counter
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3.5 py-2 text-xs text-red-700 font-medium" role="alert">
          {errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {/* Large Message Textarea */}
        <textarea
          rows={3}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={isPending}
          className="w-full resize-none rounded-lg border border-gray-200 bg-white p-3.5 text-xs sm:text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none leading-relaxed"
          aria-label="Message content"
        />

        {/* Bottom Bar: Currency & Offer input on Left, Coral Send button on Right */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center">
              <span className="inline-flex h-9 items-center rounded-l-md border border-r-0 border-gray-300 bg-gray-100 px-3 text-xs font-semibold text-gray-700 select-none">
                INR ₹
              </span>
              <input
                id="deal-offer-input"
                type="text"
                placeholder="Add Offer Amount (Optional)"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                disabled={isPending}
                className="h-9 w-52 sm:w-64 rounded-r-md border border-gray-300 bg-white px-3 text-xs sm:text-sm text-gray-800 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none transition-all duration-200"
                aria-label="Add offer amount"
              />
            </div>

            {/* Live conversion badge for expressions like "7.5 Lakhs" or "1.5 Cr" */}
            {parsedPrice !== null && (
              <span className="inline-flex items-center rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                = {formatListingPrice(parsedPrice, "INR")}
              </span>
            )}

            {offerAmount && (
              <select
                id="expirySelect"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value as ExpiryOption)}
                disabled={isPending}
                className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-700 focus:border-gray-900 focus:outline-none cursor-pointer"
                title="Offer Expiry"
              >
                <option value="none">No expiry</option>
                <option value="24h">24h expiry</option>
                <option value="48h">48h expiry</option>
                <option value="7d">7d expiry</option>
              </select>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline text-[11px] text-gray-400">Ctrl+Enter to send</span>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSubmit}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[#f06a4d] px-6 text-xs sm:text-sm font-semibold text-white shadow-xs hover:bg-[#e0583b] disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isPending ? "Sending…" : buttonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
