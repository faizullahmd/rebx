"use client";

import { useState } from "react";
import { ShareListingModal } from "@/components/listings/ShareListingModal";
import type { PitchListingData } from "@/lib/pitch";

export interface ShareListingButtonProps {
  listing: PitchListingData & { status: string };
  agentName?: string | null;
  agentPhone?: string | null;
  variant?: "link" | "menuitem" | "button";
  className?: string;
}

export function ShareListingButton({
  listing,
  agentName,
  agentPhone,
  variant = "link",
  className = "",
}: ShareListingButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isActive = listing.status === "ACTIVE";
  const disabledTooltip = "Publish this listing to share it.";

  if (variant === "menuitem") {
    if (!isActive) {
      return (
        <span
          title={disabledTooltip}
          className={`flex w-full items-center px-4 py-2.5 text-sm text-gray-400 cursor-not-allowed min-h-[40px] opacity-60 ${className}`}
        >
          Share (Inactive)
        </span>
      );
    }

    return (
      <>
        <button
          type="button"
          role="menuitem"
          onClick={() => setIsOpen(true)}
          className={`flex w-full items-center px-4 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 min-h-[40px] text-left cursor-pointer transition-colors ${className}`}
        >
          Share on WhatsApp
        </button>
        <ShareListingModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          listing={listing}
          agentName={agentName}
          agentPhone={agentPhone}
        />
      </>
    );
  }

  // Default "link" variant for desktop table row actions
  if (!isActive) {
    return (
      <span
        title={disabledTooltip}
        aria-disabled="true"
        className={`text-gray-400 cursor-not-allowed select-none ${className}`}
      >
        Share
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`text-emerald-700 hover:text-emerald-900 font-medium cursor-pointer transition-colors ${className}`}
        title="Share on WhatsApp"
        aria-label={`Share ${listing.title} on WhatsApp`}
      >
        Share
      </button>
      <ShareListingModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        listing={listing}
        agentName={agentName}
        agentPhone={agentPhone}
      />
    </>
  );
}

