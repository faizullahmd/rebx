"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SiteVisitStatus } from "@prisma/client";
import { confirmSiteVisit, completeSiteVisit } from "@/lib/actions/site-visits";
import { getActiveRescheduleProposal } from "@/lib/site-visit-proposal";
import { getGoogleMapsDirectionsUrl, formatDisplayAddress } from "@/lib/maps";
import { CancelVisitModal } from "./CancelVisitModal";

interface SerializedSiteVisit {
  id: number;
  dealId: number;
  listingId: number;
  customerId: number;
  agentId: number;
  date: string | Date;
  timeSlot: string;
  visitType: "IN_PERSON" | "VIRTUAL";
  status: SiteVisitStatus;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  listing: {
    id: number;
    title: string;
    slug: string;
    addressLine: string;
    city: string;
    state: string | null;
    country?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    price: number | string | null;
    currency: string;
    images: { url: string }[];
  };
  customer: {
    id: number;
    name: string;
    email: string;
    customerProfile: { phone: string | null } | null;
  };
  deal: {
    id: number;
    stage: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
  };
}

interface AgentSiteVisitsListProps {
  initialVisits: SerializedSiteVisit[];
  stats: {
    total: number;
    pending: number;
    confirmed: number;
    cancelled: number;
    completed: number;
  };
}

type FilterTab = "ALL" | "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

export function AgentSiteVisitsList({ initialVisits, stats }: AgentSiteVisitsListProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<FilterTab>("ALL");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeActionId, setActiveActionId] = useState<number | null>(null);

  // Modal states
  const [cancelTarget, setCancelTarget] = useState<SerializedSiteVisit | null>(null);

  // Filter visits
  const filteredVisits = initialVisits.filter((v) => {
    if (activeTab === "ALL") return true;
    return v.status === activeTab;
  });

  function formatDate(d: string | Date) {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
    }).format(new Date(d));
  }

  function formatTime(d: string | Date) {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(d));
  }

  function handleConfirm(visit: SerializedSiteVisit) {
    if (
      !window.confirm(
        `Confirm site visit for ${visit.deal.contactName || visit.customer.name} on ${formatDate(
          visit.date
        )} (${visit.timeSlot})?`
      )
    ) {
      return;
    }

    setFeedback(null);
    setActiveActionId(visit.id);
    startTransition(async () => {
      const res = await confirmSiteVisit(visit.id);
      setActiveActionId(null);
      if (res.success) {
        setFeedback({ type: "success", message: res.message });
        router.refresh();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  function handleComplete(visit: SerializedSiteVisit) {
    if (
      !window.confirm(
        `Mark this site visit for ${visit.deal.contactName || visit.customer.name} as completed?`
      )
    ) {
      return;
    }

    setFeedback(null);
    setActiveActionId(visit.id);
    startTransition(async () => {
      const res = await completeSiteVisit(visit.id);
      setActiveActionId(null);
      if (res.success) {
        setFeedback({ type: "success", message: res.message });
        router.refresh();
      } else {
        setFeedback({ type: "error", message: res.message });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between rounded-lg p-3 text-xs sm:text-sm font-medium border ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-gray-400 hover:text-gray-700 ml-3 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Prominent Pending Notification Banner */}
      {stats.pending > 0 && activeTab !== "PENDING" && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs sm:text-sm text-amber-900 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-200 text-amber-800 font-bold shrink-0">
              !
            </span>
            <span>
              <strong>Action Required:</strong> You have <strong>{stats.pending}</strong> pending site visit{" "}
              {stats.pending === 1 ? "request" : "requests"} awaiting your confirmation.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("PENDING")}
            className="w-fit rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 transition cursor-pointer shadow-xs shrink-0"
          >
            View Pending Requests ({stats.pending})
          </button>
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("ALL")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === "ALL"
              ? "bg-gray-900 text-white shadow-xs"
              : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
          }`}
        >
          <span>All Visits</span>
          <span className="rounded-full bg-gray-200 text-gray-800 px-1.5 py-0.2 text-[11px]">
            {stats.total}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("PENDING")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === "PENDING"
              ? "bg-amber-600 text-white shadow-xs"
              : "bg-white text-gray-700 hover:bg-amber-50 border border-gray-200"
          }`}
        >
          <span>Pending</span>
          <span
            className={`rounded-full px-1.5 py-0.2 text-[11px] ${
              stats.pending > 0 ? "bg-amber-200 text-amber-900 font-bold" : "bg-gray-200 text-gray-700"
            }`}
          >
            {stats.pending}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("CONFIRMED")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === "CONFIRMED"
              ? "bg-emerald-700 text-white shadow-xs"
              : "bg-white text-gray-700 hover:bg-emerald-50 border border-gray-200"
          }`}
        >
          <span>Confirmed</span>
          <span className="rounded-full bg-gray-200 text-gray-800 px-1.5 py-0.2 text-[11px]">
            {stats.confirmed}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("CANCELLED")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === "CANCELLED"
              ? "bg-gray-700 text-white shadow-xs"
              : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
          }`}
        >
          <span>Cancelled</span>
          <span className="rounded-full bg-gray-200 text-gray-800 px-1.5 py-0.2 text-[11px]">
            {stats.cancelled}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("COMPLETED")}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
            activeTab === "COMPLETED"
              ? "bg-slate-700 text-white shadow-xs"
              : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
          }`}
        >
          <span>Completed</span>
          <span className="rounded-full bg-gray-200 text-gray-800 px-1.5 py-0.2 text-[11px]">
            {stats.completed}
          </span>
        </button>
      </div>

      {/* Visits List */}
      {filteredVisits.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <div className="text-3xl mb-2">📅</div>
          <h3 className="text-sm font-semibold text-gray-900">No site visits found</h3>
          <p className="mt-1 text-xs text-gray-500 max-w-sm">
            {activeTab === "ALL"
              ? "When customers book site visits from their dashboard or chat thread, they will show up here."
              : `There are currently no ${activeTab.toLowerCase()} site visit requests.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filteredVisits.map((visit) => {
            const customerName = visit.deal.contactName || visit.customer.name;
            const customerEmail = visit.deal.contactEmail || visit.customer.email;
            const customerPhone = visit.deal.contactPhone || visit.customer.customerProfile?.phone;
            const formattedVisitDate = formatDate(visit.date);
            const addressString = [visit.listing.addressLine, visit.listing.city, visit.listing.state]
              .filter(Boolean)
              .join(", ");
            const photo = visit.listing.images?.[0]?.url;

            const activeProposal = getActiveRescheduleProposal(visit.notes);
            const isProposalPending = activeProposal?.status === "PENDING";

            const directionsUrl = getGoogleMapsDirectionsUrl(visit.listing);
            const displayAddress = formatDisplayAddress(visit.listing) || addressString;

            return (
              <div
                key={visit.id}
                className={`flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border bg-white p-5 shadow-xs transition hover:border-gray-300 ${
                  visit.status === "PENDING"
                    ? "border-amber-200/80 bg-gradient-to-r from-amber-50/30 to-white"
                    : isProposalPending
                      ? "border-indigo-200/80 bg-gradient-to-r from-indigo-50/20 to-white"
                      : visit.status === "CONFIRMED"
                        ? "border-emerald-200/80"
                        : "border-gray-200"
                }`}
              >
                {/* Left Section: Details */}
                <div className="flex flex-col sm:flex-row gap-4 min-w-0 flex-1">
                  {/* Property Image Thumbnail */}
                  <div className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo}
                        alt={visit.listing.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400">
                        REBX
                      </div>
                    )}
                  </div>

                  {/* Property & Appointment Content */}
                  <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/listings/${visit.listing.slug}`}
                        target="_blank"
                        className="text-sm font-bold text-gray-900 hover:text-blue-600 transition truncate max-w-md"
                        title={visit.listing.title}
                      >
                        {visit.listing.title}
                      </Link>

                      {/* Status Badge */}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                          visit.status === "PENDING"
                            ? "bg-amber-100 text-amber-800 border-amber-200"
                            : visit.status === "CONFIRMED"
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : visit.status === "CANCELLED"
                                ? "bg-red-50 text-red-700 border-red-200"
                                : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                      >
                        {visit.status === "PENDING"
                          ? "Pending Confirmation"
                          : visit.status === "CONFIRMED"
                            ? "Confirmed"
                            : visit.status === "CANCELLED"
                              ? "Cancelled"
                              : "Completed"}
                      </span>

                      {/* Active Proposal Badge */}
                      {isProposalPending && (
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold border bg-indigo-100 text-indigo-800 border-indigo-200 animate-pulse">
                          Reschedule Proposal Pending
                        </span>
                      )}

                      {/* Visit Type */}
                      <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700">
                        {visit.visitType === "VIRTUAL" ? "📹 Virtual Tour" : "📍 In-Person Visit"}
                      </span>
                    </div>

                    {/* Address & Google Maps Directions */}
                    {displayAddress && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <span>📍</span>
                          <span>{displayAddress}</span>
                        </span>
                        {directionsUrl && (
                          <a
                            href={directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                            title="Get directions on Google Maps"
                          >
                            <span>Directions</span>
                            <span className="text-[10px]">↗</span>
                          </a>
                        )}
                      </div>
                    )}

                    {/* Customer & Visit Timing Details Grid */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-600">
                      <div>
                        <span className="text-gray-400">Customer: </span>
                        <strong className="text-gray-900 font-semibold">{customerName}</strong>
                        {customerEmail && (
                          <a
                            href={`mailto:${customerEmail}`}
                            className="ml-1 text-blue-600 hover:underline"
                          >
                            ({customerEmail})
                          </a>
                        )}
                        {customerPhone && (
                          <a
                            href={`tel:${customerPhone}`}
                            className="ml-1 text-gray-500 hover:underline"
                          >
                            · {customerPhone}
                          </a>
                        )}
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 font-medium text-gray-900">
                          <span>🗓️</span>
                          <span>
                            <strong>{formattedVisitDate}</strong> at <strong>{visit.timeSlot}</strong>
                          </span>
                        </div>
                        {isProposalPending && activeProposal && (
                          <div className="text-[11px] text-indigo-700 font-medium">
                            Proposed: {formatDate(activeProposal.proposedDate)} at {activeProposal.proposedTimeSlot}
                          </div>
                        )}
                      </div>

                      <div className="text-[11px] text-gray-400">
                        Requested: {formatTime(visit.createdAt)}
                      </div>
                    </div>

                    {/* Notes & History */}
                    {visit.notes && (
                      <div className="mt-1.5 rounded-lg bg-gray-50/90 border border-gray-200/60 p-2 text-[11px] text-gray-700 whitespace-pre-line leading-relaxed max-w-2xl">
                        {visit.notes}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Section: Actions */}
                <div className="flex flex-col sm:flex-row lg:flex-col items-stretch lg:items-end justify-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                  {/* PENDING Actions: Confirm, Reschedule, Cancel */}
                  {visit.status === "PENDING" && (
                    <div className="flex flex-wrap lg:flex-col gap-2 w-full lg:w-auto">
                      <button
                        type="button"
                        disabled={isPending && activeActionId === visit.id}
                        onClick={() => handleConfirm(visit)}
                        className="flex-1 lg:flex-none min-h-[38px] rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                      >
                        {isPending && activeActionId === visit.id ? (
                          "Confirming..."
                        ) : (
                          <>
                            <span>✓</span>
                            <span>Confirm Visit</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setCancelTarget(visit)}
                        className="flex-1 lg:flex-none min-h-[38px] rounded-lg border border-red-200 bg-red-50/50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition cursor-pointer flex items-center justify-center"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* CONFIRMED Actions: Cancel, Mark Completed */}
                  {visit.status === "CONFIRMED" && (
                    <div className="flex flex-wrap lg:flex-col gap-2 w-full lg:w-auto">

                      <button
                        type="button"
                        disabled={isPending && activeActionId === visit.id}
                        onClick={() => handleComplete(visit)}
                        className="flex-1 lg:flex-none min-h-[36px] rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer flex items-center justify-center"
                      >
                        Mark Completed
                      </button>

                      <button
                        type="button"
                        onClick={() => setCancelTarget(visit)}
                        className="flex-1 lg:flex-none text-xs font-medium text-red-600 hover:text-red-800 hover:underline py-1 transition cursor-pointer text-center"
                      >
                        Cancel Visit
                      </button>
                    </div>
                  )}

                  {/* Directions link for confirmed in-person visits */}
                  {visit.status === "CONFIRMED" && directionsUrl && visit.visitType === "IN_PERSON" && (
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-300 bg-emerald-50/60 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition cursor-pointer"
                    >
                      <span>🗺️</span>
                      <span>Directions</span>
                      <span className="text-[10px]">↗</span>
                    </a>
                  )}

                  {/* Link to Deal Conversation */}
                  <Link
                    href={`/agent/dashboard/deals/${visit.dealId}`}
                    className="inline-flex items-center justify-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline pt-1"
                  >
                    <span>Open Deal Chat</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <CancelVisitModal
          siteVisitId={cancelTarget.id}
          customerName={cancelTarget.deal.contactName || cancelTarget.customer.name}
          propertyTitle={cancelTarget.listing.title}
          visitDateFormatted={formatDate(cancelTarget.date)}
          timeSlot={cancelTarget.timeSlot}
          isOpen={Boolean(cancelTarget)}
          onClose={() => setCancelTarget(null)}
          onSuccess={() => {
            setFeedback({ type: "success", message: "Site visit cancelled successfully." });
            setCancelTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
