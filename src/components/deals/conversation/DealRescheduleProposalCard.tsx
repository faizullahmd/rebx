"use client";

import type { RescheduleProposal } from "@/lib/site-visit-proposal";

interface DealRescheduleProposalCardProps {
  dealId: number;
  messageId: number;
  proposal: RescheduleProposal;
  viewerRole: "AGENT" | "CUSTOMER";
  createdAt: Date | string;
  dealAgentName?: string;
}

export function DealRescheduleProposalCard({
  proposal,
  createdAt,
  dealAgentName = "Agent",
}: DealRescheduleProposalCardProps) {
  const proposedDateObj = new Date(proposal.proposedDate);
  const formattedProposedDate = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(proposedDateObj);

  const origDateObj = new Date(proposal.originalDate);
  const formattedOrigDate = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(origDateObj);

  const dateObj = new Date(createdAt);
  const dateStr = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(dateObj);

  return (
    <div className="my-3 mx-auto max-w-xl rounded-2xl border border-indigo-200/80 bg-linear-to-b from-indigo-50/70 to-white p-4 sm:p-5 shadow-xs">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-indigo-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
            <span className="text-sm">🗓️</span>
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-gray-900">
              Site Visit Rescheduled
            </h4>
            <span className="text-[11px] text-gray-500">
              Updated by {dealAgentName} · {dateStr}
            </span>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">
            <span>🔄</span>
            <span>Rescheduled</span>
          </span>
        </div>
      </div>

      {/* Appointment Comparison Grid */}
      <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Proposed New Appointment */}
        <div className="rounded-xl border border-indigo-200 bg-white p-3 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              ✨ New Appointment Time
            </span>
          </div>
          <p className="mt-1.5 text-sm font-bold text-gray-900">
            {formattedProposedDate}
          </p>
          <p className="text-xs font-semibold text-indigo-600">
            {proposal.proposedTimeSlot}
          </p>
        </div>

        {/* Current / Original Appointment */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 shadow-2xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">
            Previous Appointment
          </span>
          <p className="mt-1.5 text-sm font-medium text-gray-700">
            {formattedOrigDate}
          </p>
          <p className="text-xs text-gray-500">{proposal.originalTimeSlot}</p>
        </div>
      </div>

      {/* Reason from Agent */}
      {proposal.reason && (
        <div className="mt-3 rounded-lg border border-gray-200/70 bg-white/90 p-2.5 text-xs text-gray-700">
          <span className="font-semibold text-gray-900">Agent note: </span>
          <span>{proposal.reason}</span>
        </div>
      )}
    </div>
  );
}
