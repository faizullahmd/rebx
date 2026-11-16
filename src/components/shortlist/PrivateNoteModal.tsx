"use client";

import { useState, useEffect, useRef } from "react";
import { useToast } from "@/context/ToastContext";

export interface PrivateNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  listingId: number;
  listingTitle: string;
  initialNote: string | null;
  onSaveNote: (listingId: number, note: string | null) => void;
}

export function PrivateNoteModal({
  isOpen,
  onClose,
  listingId,
  listingTitle,
  initialNote,
  onSaveNote,
}: PrivateNoteModalProps) {
  const { showToast } = useToast();
  const [note, setNote] = useState(initialNote || "");
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNote(initialNote || "");
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, initialNote]);

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

  async function handleSave() {
    setIsSaving(true);
    const trimmed = note.trim();
    try {
      const res = await fetch(`/api/shortlist/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed || null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save note");
      }

      onSaveNote(listingId, trimmed || null);
      showToast({
        message: trimmed ? "Private note saved." : "Note cleared.",
        type: "success",
      });
      onClose();
    } catch (err: any) {
      showToast({
        message: err?.message || "Couldn't save note. Please try again.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Are you sure you want to delete this note?")) {
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/shortlist/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: null }),
      });

      if (!res.ok) {
        throw new Error("Failed to delete note");
      }

      onSaveNote(listingId, null);
      showToast({
        message: "Note removed.",
        type: "success",
      });
      onClose();
    } catch {
      showToast({
        message: "Couldn't remove note. Please try again.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-2xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="private-note-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-neutral-100 my-auto animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-100 pb-3">
          <div>
            <h2 id="private-note-title" className="text-base sm:text-lg font-bold text-neutral-900">
              Private Buyer Note
            </h2>
            <p className="text-xs text-neutral-500 truncate max-w-sm mt-0.5">
              {listingTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="mt-4">
          <label htmlFor="private-note-textarea" className="block text-xs font-bold text-neutral-900 mb-1.5">
            Your Notes (visible only to you)
          </label>
          <textarea
            ref={textareaRef}
            id="private-note-textarea"
            rows={5}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Balcony faces morning sun, close to Oakridge International School, agent said price is negotiable by 2-3 Lakhs..."
            className="w-full rounded-xl border border-neutral-300 bg-amber-50/25 p-3 text-xs sm:text-sm text-neutral-900 focus:border-neutral-900 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-neutral-900 leading-relaxed placeholder:text-neutral-400 shadow-2xs"
            maxLength={1000}
          />
          <div className="flex items-center justify-between mt-1 text-[11px] text-neutral-500 font-medium">
            <span>Keep family or co-buyers aligned before making an offer</span>
            <span>{note.length} / 1000</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-5 pt-3 border-t border-neutral-100 flex items-center justify-between gap-2">
          {initialNote ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSaving}
              className="text-xs font-semibold text-red-600 hover:text-red-700 hover:underline cursor-pointer disabled:opacity-50"
            >
              Delete note
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition cursor-pointer disabled:opacity-50 shadow-2xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {isSaving ? "Saving..." : "Save Note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

