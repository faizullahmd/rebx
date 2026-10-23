import type { DealMessageType, DealMessageSenderRole } from "@prisma/client";

interface DealMessageBubbleProps {
  message: {
    id: number;
    senderRole: DealMessageSenderRole;
    type: DealMessageType;
    text: string;
    createdAt: Date;
    sender?: { name: string; role: string } | null;
  };
  viewerRole: "AGENT" | "CUSTOMER";
  dealAgentName?: string;
  dealCustomerName?: string;
}

export function DealMessageBubble({
  message,
  viewerRole,
  dealAgentName = "Agent",
  dealCustomerName = "Client",
}: DealMessageBubbleProps) {
  const isMine =
    (viewerRole === "AGENT" && message.senderRole === "AGENT") ||
    (viewerRole === "CUSTOMER" && message.senderRole === "CUSTOMER");

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

  const dateStr = `${day}${suffix}, ${dateObj.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} ${dateObj.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}`;

  // 1. System Events: Small grey centered lines
  if (message.type === "EVENT") {
    return (
      <div className="flex items-center justify-center py-2">
        <span className="rounded-full bg-gray-100 border border-gray-200 px-3 py-1 text-center text-[11px] font-medium text-gray-500">
          {message.text} · {dateStr}
        </span>
      </div>
    );
  }

  // 2. Private Agent Notes (Agent only): Lock icon, amber styling
  if (message.type === "NOTE") {
    return (
      <div className="my-2.5 rounded-xl border border-amber-300 bg-amber-50/80 p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-amber-200/70 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-amber-900">
            <span role="img" aria-label="lock">🔒</span>
            <span>Private Note</span>
            <span className="text-[10px] font-normal text-amber-700 bg-amber-100/70 px-1.5 py-0.5 rounded">
              Only visible to you
            </span>
          </div>
          <span className="text-[11px] text-amber-700">{dateStr}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-xs text-amber-950 font-normal leading-relaxed">
          {message.text}
        </p>
      </div>
    );
  }

  // 3. Clean Message Card (Matching the reference image)
  const senderTitle = isMine
    ? viewerRole === "CUSTOMER"
      ? "Me (Buyer)"
      : "Me (Agent)"
    : message.senderRole === "AGENT"
      ? `Agent (${dealAgentName})`
      : `Buyer (${dealCustomerName})`;

  return (
    <div
      className={`my-2.5 rounded-xl border border-gray-200 bg-white p-4 shadow-2xs transition-shadow ${
        isMine ? "border-l-4 border-l-gray-900" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs sm:text-sm font-semibold text-gray-900">
          {senderTitle}
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400">{dateStr}</span>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs sm:text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
        {message.text}
      </div>
    </div>
  );
}
