"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import {
  buildWhatsAppPitch,
  buildListingShareUrl,
  type PitchListingData,
  type PitchToggles,
} from "@/lib/pitch";
import { useToast } from "@/context/ToastContext";

export interface ShareListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: PitchListingData;
  agentName?: string | null;
  agentPhone?: string | null;
  siteBaseUrl?: string;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }

  if (typeof document !== "undefined") {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand("copy");
      document.body.removeChild(textarea);
      return success;
    } catch {
      return false;
    }
  }

  return false;
}

export function ShareListingModal({
  isOpen,
  onClose,
  listing,
  agentName,
  agentPhone,
  siteBaseUrl,
}: ShareListingModalProps) {
  const { showToast } = useToast();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Field existence flags
  const hasPrice = Boolean(
    listing.priceOnRequest ||
      (listing.priceDisplay && listing.priceDisplay.trim()) ||
      (listing.price != null && Number(listing.price) > 0)
  );
  const hasArea = Boolean(listing.areaSqFt && listing.areaSqFt > 0);
  const hasFacing = Boolean(listing.facing);
  const hasProjectDetails = Boolean(
    (listing.projectUnits && listing.projectUnits > 0) ||
      (listing.projectArea && listing.projectArea > 0)
  );
  const hasRera = Boolean(listing.reraId && listing.reraId.trim());
  const hasMapLink = Boolean(
    (listing.latitude && listing.longitude) || listing.addressLine || listing.city
  );
  const hasPhone = Boolean(agentPhone && agentPhone.trim());

  // Checkbox toggles state (default true if data exists)
  const [toggles, setToggles] = useState<PitchToggles>({
    price: hasPrice,
    area: hasArea,
    facing: hasFacing,
    projectDetails: hasProjectDetails,
    rera: hasRera,
    mapLink: hasMapLink,
    phone: hasPhone,
  });

  const baseUrl = useMemo(() => {
    if (siteBaseUrl) return siteBaseUrl;
    if (typeof window !== "undefined" && window.location.origin) {
      return window.location.origin;
    }
    return "https://rebx.app";
  }, [siteBaseUrl]);

  const shareUrl = useMemo(
    () => buildListingShareUrl(baseUrl, listing.slug),
    [baseUrl, listing.slug]
  );

  // Auto-generated pitch based on current toggles
  const autoPitch = useMemo(() => {
    return buildWhatsAppPitch({
      listing,
      agent: { name: agentName, phone: agentPhone },
      baseUrl,
      toggles,
    });
  }, [listing, agentName, agentPhone, baseUrl, toggles]);

  const [pitchText, setPitchText] = useState(autoPitch);
  const [isManuallyEdited, setIsManuallyEdited] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // Check Web Share API availability on client
  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanShare(true);
    }
  }, []);

  // Update text when autoPitch changes if user hasn't manually modified it
  useEffect(() => {
    if (!isManuallyEdited) {
      setPitchText(autoPitch);
    }
  }, [autoPitch, isManuallyEdited]);

  // Reset states on modal open
  useEffect(() => {
    if (isOpen) {
      setIsManuallyEdited(false);
      setToggles({
        price: hasPrice,
        area: hasArea,
        facing: hasFacing,
        projectDetails: hasProjectDetails,
        rera: hasRera,
        mapLink: hasMapLink,
        phone: hasPhone,
      });
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, hasPrice, hasArea, hasFacing, hasProjectDetails, hasRera, hasMapLink, hasPhone]);

  // Close on Escape & trap focus
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleToggleChange(field: keyof PitchToggles) {
    setToggles((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      // If user hasn't manually modified, autoPitch effect will sync pitchText
      // If user has edited, we recalculate but also mark that they can reset
      if (isManuallyEdited) {
        const nextPitch = buildWhatsAppPitch({
          listing,
          agent: { name: agentName, phone: agentPhone },
          baseUrl,
          toggles: next,
        });
        setPitchText(nextPitch);
        setIsManuallyEdited(false);
      }
      return next;
    });
  }

  function handleResetToAuto() {
    setIsManuallyEdited(false);
    setPitchText(autoPitch);
  }

  function handleSendWhatsApp() {
    const encoded = encodeURIComponent(pitchText);
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  async function handleWebShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: listing.title,
          text: pitchText,
        });
      } catch {
        // User cancelled or share dismissed
      }
    }
  }

  async function handleCopyText() {
    const success = await copyToClipboard(pitchText);
    if (success) {
      showToast({
        message: "Copied. Paste it into your WhatsApp Status or chat.",
        type: "success",
      });
    } else {
      showToast({
        message: "Failed to copy text. Please select and copy manually.",
        type: "error",
      });
    }
  }

  async function handleCopyLink() {
    const success = await copyToClipboard(shareUrl);
    if (success) {
      showToast({
        message: "Link copied to clipboard.",
        type: "success",
      });
    } else {
      showToast({
        message: "Failed to copy link.",
        type: "error",
      });
    }
  }

  const coverPhoto = listing.images && listing.images.length > 0 ? listing.images[0].url : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-2xs overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-whatsapp-title"
      ref={modalRef}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white p-4 sm:p-6 shadow-2xl border border-gray-100 my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3.5">
          <div className="flex items-center gap-3 min-w-0 pr-2">
            {coverPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverPhoto}
                alt={listing.title}
                className="w-12 h-12 rounded-lg object-cover border border-gray-200 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-xl shrink-0">
                🏡
              </div>
            )}
            <div className="min-w-0">
              <h2 id="share-whatsapp-title" className="text-base sm:text-lg font-bold text-gray-900 truncate">
                Share on WhatsApp
              </h2>
              <p className="text-xs text-gray-500 truncate mt-0.5">{listing.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Checkbox Toggles */}
        <div className="mt-3.5">
          <p className="text-xs font-semibold text-gray-700 mb-2">Include in pitch:</p>
          <div className="flex flex-wrap gap-2 text-xs">
            <CheckboxPill
              label="Price"
              checked={Boolean(toggles.price)}
              disabled={!hasPrice}
              onChange={() => handleToggleChange("price")}
            />
            <CheckboxPill
              label="Area"
              checked={Boolean(toggles.area)}
              disabled={!hasArea}
              onChange={() => handleToggleChange("area")}
            />
            <CheckboxPill
              label="Facing"
              checked={Boolean(toggles.facing)}
              disabled={!hasFacing}
              onChange={() => handleToggleChange("facing")}
            />
            <CheckboxPill
              label="Project details"
              checked={Boolean(toggles.projectDetails)}
              disabled={!hasProjectDetails}
              onChange={() => handleToggleChange("projectDetails")}
            />
            <CheckboxPill
              label="RERA"
              checked={Boolean(toggles.rera)}
              disabled={!hasRera}
              onChange={() => handleToggleChange("rera")}
            />
            <CheckboxPill
              label="Map link"
              checked={Boolean(toggles.mapLink)}
              disabled={!hasMapLink}
              onChange={() => handleToggleChange("mapLink")}
            />
            <CheckboxPill
              label="My phone number"
              checked={Boolean(toggles.phone)}
              disabled={!hasPhone}
              onChange={() => handleToggleChange("phone")}
            />
          </div>
          {!hasPhone && (
            <p className="text-[11px] text-amber-700 mt-2 bg-amber-50/80 border border-amber-200/80 rounded-md px-2.5 py-1.5 flex items-center justify-between">
              <span>Add your phone number to include it in the pitch.</span>
              <Link href="/account" className="underline font-semibold ml-1.5 hover:text-amber-900">
                Account settings →
              </Link>
            </p>
          )}
        </div>

        {/* Textarea */}
        <div className="mt-3.5">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
            <label htmlFor="whatsapp-pitch-editor" className="font-semibold text-gray-700">
              Pitch message
            </label>
            <div className="flex items-center gap-3">
              {isManuallyEdited && (
                <button
                  type="button"
                  onClick={handleResetToAuto}
                  className="text-emerald-700 hover:text-emerald-900 font-medium underline cursor-pointer text-[11px]"
                >
                  Reset to auto-generated
                </button>
              )}
              <span className={`text-[11px] ${pitchText.length > 1500 ? "text-red-600 font-bold" : "text-gray-400"}`}>
                {pitchText.length} / 1500
              </span>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            id="whatsapp-pitch-editor"
            rows={7}
            value={pitchText}
            onChange={(e) => {
              setPitchText(e.target.value);
              setIsManuallyEdited(true);
            }}
            aria-label="Editable WhatsApp pitch text"
            className="w-full rounded-xl border border-gray-300 p-3 text-xs sm:text-sm text-gray-800 focus:border-black focus:outline-hidden focus:ring-1 focus:ring-black font-mono leading-relaxed"
          />
        </div>

        {/* Action Buttons */}
        <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-hidden focus:ring-2 focus:ring-black cursor-pointer transition shadow-2xs"
          >
            Close
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              className="min-h-[44px] flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-hidden focus:ring-2 focus:ring-black cursor-pointer transition shadow-2xs"
            >
              Copy link
            </button>
            <button
              type="button"
              onClick={handleCopyText}
              className="min-h-[44px] flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-hidden focus:ring-2 focus:ring-black cursor-pointer transition shadow-2xs"
            >
              Copy text
            </button>
            {canShare && (
              <button
                type="button"
                onClick={handleWebShare}
                className="min-h-[44px] flex-1 sm:flex-initial px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-hidden focus:ring-2 focus:ring-black cursor-pointer transition shadow-2xs"
              >
                Share via...
              </button>
            )}
            <button
              type="button"
              onClick={handleSendWhatsApp}
              className="min-h-[44px] w-full sm:w-auto px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-700 cursor-pointer transition shadow-sm inline-flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.771-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.299.045-.677.063-1.092-.069-.252-.08-.575-.187-.988-.365-1.739-.751-2.874-2.502-2.961-2.617-.087-.116-.708-.94-.708-1.793s.448-1.273.607-1.446c.159-.173.346-.217.462-.217l.332.006c.106.005.249-.04.39.298.144.347.491 1.2.534 1.287.043.087.072.188.014.304-.058.116-.087.188-.173.289l-.26.304c-.087.086-.177.18-.076.354.101.174.449.741.964 1.201.662.591 1.221.774 1.394.86.174.086.275.072.376-.043.101-.116.433-.506.549-.68.116-.173.231-.145.39-.086s1.011.477 1.184.564.289.13.332.202c.043.073.043.419-.101.824z" />
              </svg>
              <span>Send on WhatsApp</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckboxPill({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium transition cursor-pointer select-none ${
        disabled
          ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"
          : checked
            ? "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-2xs"
            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={onChange}
        className="w-3.5 h-3.5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 disabled:opacity-50 cursor-pointer"
      />
      <span>{label}</span>
    </label>
  );
}

