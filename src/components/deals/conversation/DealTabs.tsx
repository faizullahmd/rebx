"use client";

import { useState, useTransition } from "react";
import type { Booking, Commission } from "@prisma/client";
import { BookingPanel } from "@/components/bookings/BookingPanel";
import { CommissionPanel } from "@/components/commissions/CommissionPanel";
import { addDealPrivateNote } from "@/lib/actions/deals";

type ClientBooking = Omit<Booking, "saleAmount"> & { saleAmount: number };
type ClientCommission = Omit<Commission, "amount"> & { amount: number };

interface DealTabsProps {
  dealId: number;
  dealStage: string;
  hasDeveloper: boolean;
  booking: ClientBooking | null;
  commissions: ClientCommission[];
  privateNotes: { id: number; text: string; createdAt: Date }[];
}

export function DealTabs({
  dealId,
  dealStage,
  hasDeveloper,
  booking,
  commissions,
  privateNotes,
}: DealTabsProps) {
  const [activeTab, setActiveTab] = useState<"booking" | "commission" | "notes">("booking");
  const [isPending, startTransition] = useTransition();
  const [noteText, setNoteText] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

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

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setActiveTab("booking")}
          className={`border-b-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === "booking"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          Booking
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("commission")}
          className={`border-b-2 px-4 py-2.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
            activeTab === "commission"
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
            activeTab === "notes"
              ? "border-gray-900 text-gray-900"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          Private Notes ({privateNotes.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="pt-4">
        {activeTab === "booking" && (
          <div>
            {booking ? (
              <BookingPanel booking={booking} />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                <p>No booking recorded yet.</p>
                <p className="mt-1 text-xs text-gray-400">
                  {dealStage === "UNDER_CONTRACT"
                    ? "Offer has been agreed. You can record the formal booking when finalized."
                    : "A booking can be recorded once the offer is accepted or under contract."}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "commission" && (
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

        {activeTab === "notes" && (
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

            <div className="divide-y divide-gray-100">
              {privateNotes.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">No private notes yet.</p>
              ) : (
                privateNotes.map((note) => (
                  <div key={note.id} className="py-2.5 text-xs">
                    <div className="flex items-center justify-between text-gray-400 text-[11px] mb-1">
                      <span>🔒 Internal note</span>
                      <span>{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-gray-800">{note.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
