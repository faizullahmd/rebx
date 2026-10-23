"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import type { DealStage } from "@prisma/client";
import { DEAL_STAGES, DEAL_STAGE_LABELS } from "@/lib/validation/deal";
import { changeDealStage, deleteDeal } from "@/lib/actions/deals";

interface DealMoreMenuProps {
  dealId: number;
  currentStage: string;
}

export function DealMoreMenu({ dealId, currentStage }: DealMoreMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showStageModal, setShowStageModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedStage, setSelectedStage] = useState<DealStage>(currentStage as DealStage);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleStageChange(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    startTransition(async () => {
      const res = await changeDealStage(dealId, selectedStage);
      if (!res.success) {
        setErrorMessage(res.message || "Failed to update stage.");
      } else {
        setShowStageModal(false);
        setIsOpen(false);
      }
    });
  }

  function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      await deleteDeal(dealId);
    });
  }

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 focus:outline-none cursor-pointer"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span>Actions ▾</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-44 origin-top-right rounded-xl border border-gray-100 bg-white py-1.5 shadow-lg ring-1 ring-black/5 z-20">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setShowStageModal(true);
            }}
            className="flex w-full items-center px-4 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Change stage
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setShowDeleteModal(true);
            }}
            className="flex w-full items-center px-4 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 cursor-pointer"
          >
            Delete deal
          </button>
        </div>
      )}

      {/* Change Stage Modal */}
      {showStageModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-gray-100">
            <h3 className="text-base font-bold text-gray-900">Manual Stage Override</h3>
            <p className="mt-1 text-xs text-gray-500">
              Update this deal&apos;s stage. A system audit message will be recorded.
            </p>

            <form onSubmit={handleStageChange} className="mt-4">
              <label htmlFor="stageSelect" className="block text-xs font-medium text-gray-700 mb-1">
                Select stage:
              </label>
              <select
                id="stageSelect"
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value as DealStage)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs focus:border-gray-900 focus:outline-none cursor-pointer"
              >
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {DEAL_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>

              {errorMessage && <p className="mt-2 text-xs text-red-600">{errorMessage}</p>}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setShowStageModal(false)}
                  className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:opacity-50 cursor-pointer"
                >
                  {isPending ? "Updating…" : "Update Stage"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Deal Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-gray-100">
            <h3 className="text-base font-bold text-red-600">Delete this deal?</h3>
            <p className="mt-2 text-xs text-gray-600">
              Are you sure you want to permanently delete this deal and its associated records?
              This action cannot be undone.
            </p>

            <form onSubmit={handleDelete} className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setShowDeleteModal(false)}
                className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {isPending ? "Deleting…" : "Confirm Delete"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
