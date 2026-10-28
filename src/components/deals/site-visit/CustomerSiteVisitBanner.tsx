"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteVisitStatus } from "@prisma/client";
import { SiteVisitModal } from "./SiteVisitModal";
import {
  getGoogleMapsDirectionsUrl,
  formatDisplayAddress,
} from "@/lib/maps";

interface SerializedSiteVisit {
  id: number;
  dealId: number;
  listingId: number;
  date: string | Date;
  timeSlot: string;
  visitType: "IN_PERSON" | "VIRTUAL";
  status: SiteVisitStatus;
  notes: string | null;
  listing: {
    title: string;
    addressLine: string;
    city: string;
    state: string | null;
    country?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  agent: {
    name: string;
    email: string;
  };
}

interface CustomerSiteVisitBannerProps {
  visit: SerializedSiteVisit | null;
  dealId: number;
  propertyTitle: string;
  propertyAddress?: string | null;
}

export function CustomerSiteVisitBanner({
  visit,
  dealId,
  propertyTitle,
  propertyAddress,
}: CustomerSiteVisitBannerProps) {
  const router = useRouter();
  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  if (!visit) {
    return null;
  }

  const visitDate = new Date(visit.date);
  const formattedDate = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(visitDate);

  const isCancelled = visit.status === "CANCELLED";
  const isConfirmed = visit.status === "CONFIRMED";
  const isCompleted = visit.status === "COMPLETED";
  const isPending = visit.status === "PENDING";

  // Extract cancellation reason if present in notes
  let cancellationReason: string | null = null;
  if (isCancelled && visit.notes) {
    const match = visit.notes.match(/Reason:\s*([^;\]]+)/i);
    if (match?.[1]) {
      cancellationReason = match[1].trim();
    }
  }

  // Check if original date expired after decline
  const isExpiredDecline = isCancelled && visit.notes?.includes("Original appointment date has passed");


  // Visual tones
  let containerStyle = "border-blue-200 bg-blue-50/60 text-blue-900";
  let badgeStyle = "bg-blue-100 text-blue-800 border-blue-300";
  let statusText = "Pending Confirmation";

  // Location and Google Maps link
  const listingLoc = {
    addressLine: visit.listing?.addressLine || propertyAddress || null,
    city: visit.listing?.city,
    state: visit.listing?.state,
    country: visit.listing?.country,
    postalCode: visit.listing?.postalCode,
    latitude: visit.listing?.latitude,
    longitude: visit.listing?.longitude,
  };
  const fullAddress = formatDisplayAddress(listingLoc) || propertyAddress || null;
  const directionsUrl = getGoogleMapsDirectionsUrl(listingLoc);

  if (isConfirmed) {
    containerStyle = "border-emerald-200 bg-emerald-50/60 text-emerald-950";
    badgeStyle = "bg-emerald-100 text-emerald-800 border-emerald-300";
    statusText = "Visit Confirmed";
  } else if (isCancelled) {
    containerStyle = "border-rose-200 bg-rose-50/60 text-rose-950";
    badgeStyle = "bg-rose-100 text-rose-800 border-rose-300";
    statusText = isExpiredDecline ? "Booking Expired" : "Visit Cancelled";
  } else if (isCompleted) {
    containerStyle = "border-neutral-200 bg-neutral-50/70 text-neutral-800";
    badgeStyle = "bg-neutral-100 text-neutral-700 border-neutral-300";
    statusText = "Visit Completed";
  }

  return (
    <>
      <div className={`rounded-xl border p-4 sm:p-5 shadow-xs transition-all ${containerStyle}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/80 shadow-xs border border-black/5">
              {isConfirmed ? (
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : isCancelled ? (
                <svg className="h-5 w-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : isCompleted ? (
                <svg className="h-5 w-5 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tracking-tight">Site Visit</span>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeStyle}`}>
                  {statusText}
                </span>
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                  • {visit.visitType === "IN_PERSON" ? "In-Person Tour" : "Virtual Tour"}
                </span>
              </div>

              {/* Timing Display */}
              <div className="mt-2 text-sm">
                <div>
                  <span className="font-semibold">{formattedDate}</span> at{" "}
                  <span className="font-semibold">{visit.timeSlot}</span>
                  {visit.agent?.name && (
                    <span className="text-neutral-600"> with Agent {visit.agent.name}</span>
                  )}
                </div>
              </div>

              {/* Property Address & Google Maps Directions Link */}
              {fullAddress && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-600">
                  <span className="font-medium text-neutral-800">📍 {fullAddress}</span>
                  {directionsUrl && (
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    >
                      <span>View Map & Directions</span>
                      <span>↗</span>
                    </a>
                  )}
                </div>
              )}

              {isExpiredDecline && (
                <p className="mt-1.5 text-xs text-rose-800 bg-rose-100/70 rounded-md px-2.5 py-1 border border-rose-200">
                  ⚠️ The original appointment date has passed. Please book a new visit when convenient.
                </p>
              )}

              {isCancelled && !isExpiredDecline && cancellationReason && (
                <p className="mt-1.5 text-xs text-rose-800 bg-rose-100/70 rounded-md px-2.5 py-1 border border-rose-200">
                  <span className="font-semibold">Cancellation reason:</span> {cancellationReason}
                </p>
              )}

              {isConfirmed && (
                <p className="mt-1 text-xs text-emerald-800">
                  Your appointment is confirmed. The agent will meet you at the scheduled time.
                </p>
              )}

              {isPending && (
                <p className="mt-1 text-xs text-blue-800">
                  Your booking request is pending agent confirmation.
                </p>
              )}

              {/* Inline Feedback */}
              {feedback && (
                <div
                  className={`mt-2 rounded-md p-2 text-xs font-medium border ${
                    feedback.type === "success"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-red-50 text-red-800 border-red-200"
                  }`}
                >
                  {feedback.message}
                </div>
              )}
            </div>
          </div>

          {/* Right Action Buttons */}
          <div className="sm:self-center shrink-0 flex items-center gap-2">
            {isConfirmed && directionsUrl && visit.visitType === "IN_PERSON" ? (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-50 transition cursor-pointer"
              >
                <span>🗺️</span>
                <span>Get Directions</span>
                <span className="text-[10px]">↗</span>
              </a>
            ) : (isCancelled || isCompleted) ? (
              <button
                type="button"
                onClick={() => setIsBookModalOpen(true)}
                className="inline-flex items-center justify-center rounded-lg bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-800 shadow-xs border border-neutral-300 hover:bg-neutral-50 transition-colors cursor-pointer"
              >
                Book another visit
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isBookModalOpen && (
        <SiteVisitModal
          dealId={dealId}
          isOpen={isBookModalOpen}
          onClose={() => setIsBookModalOpen(false)}
          propertyTitle={propertyTitle}
          propertyAddress={propertyAddress}
        />
      )}
    </>
  );
}
