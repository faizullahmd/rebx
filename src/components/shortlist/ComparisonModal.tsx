"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { ShortlistItem } from "@/lib/data/shortlist";

export interface ComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  properties: ShortlistItem[];
  onRemoveProperty: (listingId: number) => void;
  onOpenNoteEditor?: (listingId: number) => void;
}

export function ComparisonModal({
  isOpen,
  onClose,
  properties,
  onRemoveProperty,
  onOpenNoteEditor,
}: ComparisonModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
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

  if (!isOpen || properties.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 md:p-6 backdrop-blur-2xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="comparison-matrix-title"
      ref={modalRef}
    >
      <div className="relative w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-neutral-200 overflow-hidden my-auto animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 bg-white shrink-0">
          <div>
            <h2
              id="comparison-matrix-title"
              className="text-lg sm:text-xl font-bold text-neutral-900 tracking-tight"
            >
              Side-by-Side Property Comparison
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Comparing {properties.length} of 4 properties
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
            aria-label="Close comparison dialog"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Comparison Matrix Table */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 sm:p-6">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead>
              {/* Row 1: Property Cards Header */}
              <tr className="border-b border-neutral-200">
                <th className="w-48 pb-4 pr-4 align-bottom font-medium text-xs text-neutral-400 uppercase tracking-wider">
                  Features & Specs
                </th>
                {properties.map((p) => (
                  <th key={p.id} className="pb-4 px-3 align-top min-w-[200px] w-1/4">
                    <div className="flex flex-col gap-2">
                      <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-neutral-100 border border-neutral-200 shadow-2xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.coverImage}
                          alt={p.name}
                          className="h-full w-full object-cover"
                        />
                        {properties.length > 2 && (
                          <button
                            type="button"
                            onClick={() => onRemoveProperty(p.listingId)}
                            title="Remove from comparison"
                            className="absolute top-2 right-2 rounded-full bg-black/60 hover:bg-black text-white p-1 text-xs w-6 h-6 flex items-center justify-center transition cursor-pointer shadow-xs"
                            aria-label={`Remove ${p.name} from comparison`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div>
                        <span className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded bg-neutral-100 text-neutral-700">
                          {p.type}
                        </span>
                        <h3 className="font-bold text-neutral-900 text-sm mt-1 line-clamp-1">
                          {p.name}
                        </h3>
                        <p className="text-xs text-neutral-500 line-clamp-1">{p.city}</p>
                        <p className="text-sm font-bold text-neutral-900 mt-1">
                          {p.formattedPrice}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 mt-1">
                        <Link
                          href={`/listings/${p.slug}`}
                          className="w-full text-center rounded-lg border border-neutral-300 bg-white py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 transition shadow-2xs"
                        >
                          View Property
                        </Link>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-100">
              {/* SECTION: PRICING */}
              <tr className="bg-neutral-50/70">
                <td
                  colSpan={properties.length + 1}
                  className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-500"
                >
                  💰 Pricing & Valuation
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Total Price
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 font-semibold text-neutral-900">
                    {p.formattedPrice}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Price / Sq. Ft.
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.pricePerSqFt ? `₹ ${p.pricePerSqFt.toLocaleString("en-IN")} / sq.ft` : "—"}
                  </td>
                ))}
              </tr>

              {/* SECTION: SPACE & LAYOUT */}
              <tr className="bg-neutral-50/70">
                <td
                  colSpan={properties.length + 1}
                  className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-500"
                >
                  📐 Space & Layout
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Super Built-up Area
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800 font-medium">
                    {p.sqFt ? `${p.sqFt.toLocaleString("en-IN")} sq.ft` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Bedrooms
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.beds ? `${p.beds} BHK` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Bathrooms
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.baths ? `${p.baths} Baths` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Furnishing
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.furnishing || "—"}
                  </td>
                ))}
              </tr>

              {/* SECTION: ORIENTATION & STATUS */}
              <tr className="bg-neutral-50/70">
                <td
                  colSpan={properties.length + 1}
                  className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-500"
                >
                  🧭 Orientation & Status
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Facing Direction
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800 font-medium">
                    {p.facing ? `${p.facing} Facing` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Availability
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        p.status === "Available"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {p.availability || p.status}
                    </span>
                  </td>
                ))}
              </tr>

              {/* SECTION: PROJECT FACTS */}
              <tr className="bg-neutral-50/70">
                <td
                  colSpan={properties.length + 1}
                  className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-neutral-500"
                >
                  🏗 Project Facts
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  RERA Registration
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800 text-xs font-mono">
                    {p.reraId ? `✅ ${p.reraId}` : "Not listed"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Total Units
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.projectUnits ? `${p.projectUnits} Units` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Project Area
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.projectArea ? `${p.projectArea} Acres` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-2.5 pr-4 text-xs font-semibold text-neutral-600">
                  Possession
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-2.5 px-3 text-neutral-800">
                    {p.possessionStarts || "—"}
                  </td>
                ))}
              </tr>

              {/* SECTION: PRIVATE BUYER NOTES */}
              <tr className="bg-amber-50/50">
                <td
                  colSpan={properties.length + 1}
                  className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider text-amber-800"
                >
                  📝 Your Private Notes (Visible only to you)
                </td>
              </tr>
              <tr>
                <td className="py-3 pr-4 text-xs font-semibold text-neutral-600 align-top">
                  Personal Notes
                </td>
                {properties.map((p) => (
                  <td key={p.id} className="py-3 px-3 align-top">
                    {p.notes ? (
                      <div className="rounded-lg bg-amber-50/80 border border-amber-200/80 p-2.5 text-xs text-amber-900 leading-relaxed font-sans">
                        <p>{p.notes}</p>
                        {onOpenNoteEditor && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenNoteEditor(p.listingId);
                            }}
                            className="mt-1.5 text-[11px] font-semibold text-amber-700 hover:text-amber-900 underline cursor-pointer"
                          >
                            Edit note
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg bg-amber-50/50 border border-dashed border-amber-200/80 p-2.5 text-xs text-amber-800">
                        <span className="italic text-neutral-500">No private notes yet.</span>
                        {onOpenNoteEditor && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenNoteEditor(p.listingId);
                            }}
                            className="block mt-1.5 text-[11px] font-bold text-amber-900 not-italic hover:underline cursor-pointer"
                          >
                            + Add note
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3.5 bg-neutral-50 shrink-0">
          <p className="text-xs text-neutral-500">
            Tip: You can compare up to 4 properties simultaneously.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white px-4 py-2 text-xs font-semibold transition cursor-pointer shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

