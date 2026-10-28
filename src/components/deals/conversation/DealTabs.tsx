"use client";

import { useState, useTransition } from "react";
import type { Booking, Commission } from "@prisma/client";
import { BookingPanel } from "@/components/bookings/BookingPanel";
import { CommissionPanel } from "@/components/commissions/CommissionPanel";
import { AdvanceBookingCard } from "@/components/deals/advance/AdvanceBookingCard";
import { addDealPrivateNote } from "@/lib/actions/deals";

type ClientBooking = Omit<Booking, "saleAmount"> & {
  saleAmount: number;
  advance?: {
    id: number;
    amount: number;
    percentUsed: number;
    currency: string;
    status: "PENDING" | "PAID";
    paidAt: Date | string | null;
    notes: string | null;
    markedPaidBy: number | null;
  } | null;
};
type ClientCommission = Omit<Commission, "amount"> & { amount: number };

interface DealTabsProps {
  dealId: number;
  dealStage: string;
  hasDeveloper: boolean;
  hasAcceptedOffer?: boolean;
  acceptedOfferAmount?: number | null;
  currency?: string;
  booking: ClientBooking | null;
  commissions: ClientCommission[];
  privateNotes: { id: number; text: string; createdAt: Date }[];
}

export function DealTabs({
  dealId,
  dealStage,
  hasDeveloper,
  hasAcceptedOffer = false,
  acceptedOfferAmount = null,
  currency = "INR",
  booking,
  commissions,
  privateNotes,
}: DealTabsProps) {
  // Show Booking tab only when deal has an accepted offer or is Under contract / Closed won.
  // Closed lost or pre-offer stages hide the Booking tab completely.
  const canShowBooking =
    dealStage !== "CLOSED_LOST" &&
    (dealStage === "UNDER_CONTRACT" ||
      dealStage === "CLOSED_WON" ||
      hasAcceptedOffer);

  const [activeTab, setActiveTab] = useState<"booking" | "commission" | "notes">(
    canShowBooking ? "booking" : "commission"
  );
  const [isPending, startTransition] = useTransition();
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  // If activeTab is booking but canShowBooking is false, adjust tab to commission
  const currentTab = !canShowBooking && activeTab === "booking" ? "commission" : activeTab;

  function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;

    setNoteError(null);
    startTransition(async () => {
      const res = await addDealPrivateNote(dealId, noteText);
      if (!res.success) {
        setNoteError(res.message || "Failed to add note.");
      } else {
        setNoteText("");
      }
    });
  }

  const effectiveSaleAmount = booking?.saleAmount ?? acceptedOfferAmount ?? null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200">
        {canShowBooking && (
          <button
            type="button"
            onClick={() => setActiveTab("booking")}
            className={`border-b-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              currentTab === "booking"
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Booking
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab("commission")}
          className={`border-b-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            currentTab === "commission"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          Commission
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("notes")}
          className={`border-b-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            currentTab === "notes"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          Private Notes ({privateNotes.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="pt-4">
        {canShowBooking && currentTab === "booking" && (
          <div className="flex flex-col gap-3">
            <AdvanceBookingCard
              dealId={dealId}
              saleAmount={effectiveSaleAmount}
              currency={currency === "USD" ? "INR" : (currency || "INR")}
              advance={booking?.advance ?? null}
            />
            <BookingPanel
              dealId={dealId}
              booking={booking}
              defaultSaleAmount={acceptedOfferAmount}
            />
          </div>
        )}

        {currentTab === "commission" && (
          <div>
            {booking?.status === "CONFIRMED" ? (
              <CommissionPanel
                dealId={dealId}
                hasDeveloper={hasDeveloper}
                commissions={commissions}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                <p className="font-medium text-gray-700">Commission logging locked</p>
                <p className="mt-1 text-xs text-gray-400">
                  Commissions can be recorded once the developer confirms the booking or the deal closes.
                </p>
              </div>
            )}
          </div>
        )}

        {currentTab === "notes" && (
          <div className="flex flex-col gap-4">
            <form onSubmit={handleAddNote} className="flex flex-col gap-2">
              <label htmlFor="privateNoteInput" className="text-xs font-semibold text-gray-700">
                Add an internal agent note (private to you):
              </label>
              <textarea
                id="privateNoteInput"
                rows={2}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write private notes on customer intent, lender pre-approval, strategy..."
                className="w-full rounded-lg border border-gray-200 p-2.5 text-xs sm:text-sm focus:border-gray-900 focus:outline-none"
              />
              {noteError && <p className="text-xs text-red-600">{noteError}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isPending || !noteText.trim()}
                  className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isPending ? "Saving…" : "Save Note"}
                </button>
              </div>
            </form>

            {privateNotes.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No private notes yet.</p>
            ) : (
              <div className="flex flex-col gap-2.5 divide-y divide-gray-100">
                {privateNotes.map((n) => (
                  <div key={n.id} className="pt-2 text-xs">
                    <p className="text-gray-800 whitespace-pre-wrap">{n.text}</p>
                    <span className="text-[10px] text-gray-400 mt-0.5 block">
                      {new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(n.createdAt))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
