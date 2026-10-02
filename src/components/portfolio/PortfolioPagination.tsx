"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

interface PortfolioPaginationProps {
  currentPage: number;
  totalPages: number;
}

export function PortfolioPagination({ currentPage, totalPages }: PortfolioPaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  function createPageUrl(pageNumber: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", pageNumber.toString());
    return `${pathname}?${params.toString()}`;
  }

  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between border-t border-neutral-200 pt-6">
      <div className="flex flex-1 justify-between sm:justify-end sm:gap-3 items-center">
        {hasPrev ? (
          <Link
            href={createPageUrl(currentPage - 1)}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50"
          >
            ← Previous
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 cursor-not-allowed">
            ← Previous
          </span>
        )}

        <span className="text-xs sm:text-sm font-medium text-neutral-600 px-2">
          Page {currentPage} of {totalPages}
        </span>

        {hasNext ? (
          <Link
            href={createPageUrl(currentPage + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-700 shadow-2xs hover:bg-neutral-50"
          >
            Next →
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-neutral-50 px-3.5 py-2 text-xs sm:text-sm font-medium text-neutral-400 cursor-not-allowed">
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}
