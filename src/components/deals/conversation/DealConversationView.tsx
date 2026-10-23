"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DealMessageType, DealMessageSenderRole, DealOfferStatus } from "@prisma/client";
import { DealMessageBubble } from "./DealMessageBubble";
import { DealOfferCard } from "./DealOfferCard";
import { DealComposer } from "./DealComposer";
import { markDealThreadRead } from "@/lib/actions/deals";

export interface ConversationMessage {
  id: number;
  senderRole: DealMessageSenderRole;
  type: DealMessageType;
  text: string;
  amount: number | null;
  currency: string;
  offerStatus: DealOfferStatus | null;
  expiresAt: Date | null;
  createdAt: Date;
  sender?: { name: string; role: string } | null;
}

interface DealConversationViewProps {
  dealId: number;
  messages: ConversationMessage[];
  viewerRole: "AGENT" | "CUSTOMER";
  dealAgentName?: string;
  dealCustomerName?: string;
  currencySymbol?: string;
}

export function DealConversationView({
  dealId,
  messages,
  viewerRole,
  dealAgentName,
  dealCustomerName,
  currencySymbol = "₹",
}: DealConversationViewProps) {
  const router = useRouter();
  const threadEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [counterState, setCounterState] = useState<{
    active: boolean;
    messageId: number | null;
    initialAmount: number;
  } | null>(null);

  // Auto-scroll to bottom on load and whenever messages change
  const scrollToBottom = (smooth = true) => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    }
  };

  useEffect(() => {
    scrollToBottom(false);
    markDealThreadRead(dealId).catch(() => {});

    if (typeof window !== "undefined" && window.location.hash === "#deal-offer-input") {
      const timer = setTimeout(() => {
        const input = document.getElementById("deal-offer-input") as HTMLInputElement | null;
        if (input) {
          input.scrollIntoView({ behavior: "smooth", block: "center" });
          input.focus();
          input.classList.add("ring-2", "ring-blue-500", "border-blue-500");
          setTimeout(() => {
            input.classList.remove("ring-2", "ring-blue-500", "border-blue-500");
          }, 2000);
        }
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [dealId]);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length]);

  // Polling every 10 seconds when tab is visible
  useEffect(() => {
    let timer: NodeJS.Timeout;

    function poll() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        router.refresh();
        markDealThreadRead(dealId).catch(() => {});
      }
    }

    timer = setInterval(poll, 10000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        poll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [dealId, router]);

  function handleOpenCounter(amount: number, messageId: number) {
    setCounterState({ active: true, messageId, initialAmount: amount });
    scrollToBottom(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-bold text-gray-900">Conversation</h2>

      <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-xs">

      {/* Scrollable messages container - compact when few messages, expands up to max-h */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 max-h-[560px] transition-all duration-200"
        tabIndex={0}
        aria-label="Conversation messages"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center text-gray-400">
            <span className="text-2xl mb-1">💬</span>
            <p className="text-xs text-gray-500">No messages yet. Send a message or offer to begin.</p>
          </div>
        ) : (
          messages.map((msg) =>
            msg.type === "OFFER" ? (
              <DealOfferCard
                key={msg.id}
                dealId={dealId}
                message={msg}
                viewerRole={viewerRole}
                dealAgentName={dealAgentName}
                dealCustomerName={dealCustomerName}
                onOpenCounter={handleOpenCounter}
              />
            ) : (
              <DealMessageBubble
                key={msg.id}
                message={msg}
                viewerRole={viewerRole}
                dealAgentName={dealAgentName}
                dealCustomerName={dealCustomerName}
              />
            )
          )
        )}
        <div ref={threadEndRef} />
      </div>

      {/* Sticky Bottom Composer */}
      <DealComposer
        dealId={dealId}
        viewerRole={viewerRole}
        currencySymbol={currencySymbol}
        counterOfferState={counterState}
        onClearCounter={() => setCounterState(null)}
        onSent={() => scrollToBottom(true)}
      />
    </div>
    </div>
  );
}
