"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";

export interface AgentProfileHeaderProps {
  name: string;
  username: string;
  role: "AGENT" | "DEVELOPER";
  createdAt: Date;
  agencyName?: string | null;
  licenseNo?: string | null;
  phone?: string | null;
  bio?: string | null;
  activeListingCount: number;
  operatingLocations: string[];
  mode?: "public" | "dashboard";
}

export function AgentProfileHeader({
  name,
  username,
  role,
  createdAt,
  agencyName,
  licenseNo,
  phone,
  bio,
  activeListingCount,
  operatingLocations,
  mode = "public",
}: AgentProfileHeaderProps) {
  const [copied, setCopied] = useState(false);

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(createdAt));

  const cleanPhone = phone ? phone.replace(/[^0-9]/g, "") : null;

  async function handleCopyPublicLink() {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "https://rebx.app";
      const publicUrl = `${origin}/portfolio/${username}`;
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-200/90 bg-white p-5 shadow-xs sm:p-6">
      {/* Subtle background decoration accent */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-neutral-100/70 blur-3xl" />

      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {/* Avatar */}
        <div className="flex-none">
          <Avatar name={name} size="lg" />
        </div>

        {/* Info & Details */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
              {name}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-600/20 ring-inset">
              <svg className="h-3 w-3 fill-current" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {role === "DEVELOPER" ? "Verified Developer" : "Verified Agent"}
            </span>
          </div>

          {/* Username & Agency row */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-neutral-600">
            <span className="font-mono text-xs font-medium text-neutral-500">{`@${username}`}</span>
            {agencyName && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="font-medium text-neutral-800">{agencyName}</span>
              </>
            )}
            {licenseNo && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="text-xs text-neutral-500">Lic. #{licenseNo}</span>
              </>
            )}
            {operatingLocations.length > 0 && (
              <>
                <span className="text-neutral-300">•</span>
                <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
                  <svg className="h-3.5 w-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {operatingLocations.join(" · ")}
                </span>
              </>
            )}
          </div>

          {/* Bio (if available) */}
          {bio && (
            <p className="pt-1 max-w-2xl text-xs sm:text-sm leading-relaxed text-neutral-600">
              {bio}
            </p>
          )}

          {/* Stats strip */}
          <div className="flex flex-wrap items-center gap-4 pt-0.5 text-xs text-neutral-600">
            <div>
              <span className="font-semibold text-neutral-900">{activeListingCount}</span>{" "}
              {activeListingCount === 1 ? "active property" : "active properties"}
            </div>
            <div className="h-3 w-px bg-neutral-200" />
            <div>
              Member since <span className="font-medium text-neutral-900">{formattedDate}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons Column */}
        {mode === "dashboard" ? (
          <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-stretch sm:min-w-[170px] shrink-0">
            <a
              href={`/portfolio/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-2xs transition hover:bg-neutral-800"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              <span>View public portfolio</span>
            </a>

            <button
              type="button"
              onClick={handleCopyPublicLink}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-neutral-800 shadow-2xs transition hover:bg-neutral-50 cursor-pointer"
            >
              {copied ? (
                <>
                  <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-emerald-700 font-medium">Link Copied!</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span>Share Portfolio</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-stretch sm:min-w-[140px] shrink-0">
            {phone && (
              <a
                href={`tel:${phone}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white shadow-2xs transition hover:bg-neutral-800"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                  />
                </svg>
                <span>Call Agent</span>
              </a>
            )}

            {cleanPhone && (
              <a
                href={`https://wa.me/${cleanPhone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                <svg className="h-4 w-4 fill-emerald-600" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                </svg>
                <span>WhatsApp</span>
              </a>
            )}

            <button
              type="button"
              onClick={handleCopyPublicLink}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-neutral-800 shadow-2xs transition hover:bg-neutral-50 cursor-pointer"
            >
              {copied ? (
                <>
                  <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-emerald-700">Link Copied!</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span>Share Portfolio</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
