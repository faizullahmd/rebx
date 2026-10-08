"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { deleteListing } from "@/lib/actions/listings";

interface ListingActionsMenuProps {
  listingId: number;
  isLastRow?: boolean;
}

export function ListingActionsMenu({ listingId, isLastRow = false }: ListingActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      <button
        type="button"
        aria-label="Listing actions"
        aria-expanded={isOpen}
        aria-haspopup="true"
        onClick={() => setIsOpen((prev) => !prev)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 cursor-pointer transition-colors"
      >
        <span className="text-xl font-bold leading-none select-none tracking-widest">⋯</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className={`absolute right-0 z-50 min-w-[120px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg focus:outline-none ${
            isLastRow ? "bottom-full mb-1 origin-bottom-right" : "top-full mt-1 origin-top-right"
          }`}
        >
          <Link
            href={`/agent/dashboard/listings/${listingId}/edit`}
            onClick={() => setIsOpen(false)}
            role="menuitem"
            className="flex w-full items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 min-h-[40px] transition-colors"
          >
            Edit
          </Link>
          <form
            action={deleteListing.bind(null, listingId)}
            onSubmit={(e) => {
              if (!confirm("Are you sure you want to delete this listing?")) {
                e.preventDefault();
              } else {
                setIsOpen(false);
              }
            }}
          >
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 min-h-[40px] text-left cursor-pointer transition-colors"
            >
              Delete
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
