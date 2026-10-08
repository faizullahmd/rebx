"use client";

import Link from "next/link";
import { ListingTagDropdown } from "@/components/listings/ListingTagDropdown";
import { getListingTag } from "@/lib/tags";
import { deleteListing } from "@/lib/actions/listings";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ListingActionsMenu } from "@/components/dashboard/ListingActionsMenu";

import { formatListingPrice } from "@/lib/price";

export interface DashboardListingItem {
  id: number;
  title: string;
  city: string;
  price: number | string;
  priceDisplay?: string | null;
  currency?: string;
  status: string;
  tags?: any;
}

export function DashboardListingsTable({
  listings,
  onTagChange,
  emptyMessage,
}: DashboardListingsTableProps) {
  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center sm:p-10">
        <p className="text-sm text-neutral-600 mb-3">
          {emptyMessage || "No listings yet"}
        </p>
        <Link
          href="/agent/dashboard/listings/new"
          className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          + New listing
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* MOBILE COMPACT TABLE (below md: 4 columns, table-fixed, fits 360px) */}
      <div className="md:hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: "42%" }} />
            <col style={{ width: "22%" }} />
            <col style={{ width: "26%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60 text-gray-500 text-[11px] font-medium uppercase tracking-wider">
              <th className="py-2.5 px-2 font-medium rounded-tl-xl">Listing</th>
              <th className="py-2.5 px-2 font-medium">Status</th>
              <th className="py-2.5 px-2 font-medium">Tag</th>
              <th className="py-2.5 px-2 font-medium text-right rounded-tr-xl">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listings.map((listing, index) => {
              const isLast = index === listings.length - 1;
              return (
                <tr key={listing.id} className="hover:bg-gray-50/40">
                  {/* Column 1: Listing (Title on line 1, City · $Price on line 2) */}
                  <td className={`py-3 px-2 align-middle ${isLast ? "rounded-bl-xl" : ""}`}>
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate" title={listing.title}>
                        {listing.title}
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {listing.city} · {formatListingPrice(listing.price, listing.currency, listing.priceDisplay)}
                      </div>
                    </div>
                  </td>

                  {/* Column 2: Status (StatusBadge in small size) */}
                  <td className="py-3 px-2 align-middle">
                    <StatusBadge status={listing.status} size="sm" />
                  </td>

                  {/* Column 3: Tag (ListingTagDropdown in compact size) */}
                  <td className="py-3 px-2 align-middle">
                    <ListingTagDropdown
                      listingId={listing.id}
                      initialTag={getListingTag(listing.tags)}
                      onTagChange={onTagChange ? (nextTag) => onTagChange(listing.id, nextTag) : undefined}
                      compact
                    />
                  </td>

                  {/* Column 4: Actions (⋯ menu with Edit & Delete) */}
                  <td className={`py-3 px-2 text-right align-middle ${isLast ? "rounded-br-xl" : ""}`}>
                    <div className="flex justify-end">
                      <ListingActionsMenu
                        listingId={listing.id}
                        isLastRow={index >= listings.length - 2}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* DESKTOP TABLE (md and up: exactly 6 columns as before) */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-2xs">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/60 text-gray-500">
              <th className="py-3 px-4 font-medium">Title</th>
              <th className="py-3 px-4 font-medium">City</th>
              <th className="py-3 px-4 font-medium">Price</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Tag</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listings.map((listing) => (
              <tr key={listing.id} className="hover:bg-gray-50/40 transition-colors">
                <td className="py-3 px-4 font-medium text-gray-900">{listing.title}</td>
                <td className="py-3 px-4 text-gray-600">{listing.city}</td>
                <td className="py-3 px-4 text-gray-600">
                  {formatListingPrice(listing.price, listing.currency, listing.priceDisplay)}
                </td>
                <td className="py-3 px-4">
                  <StatusBadge status={listing.status} size="md" />
                </td>
                <td className="py-3 px-4">
                  <ListingTagDropdown
                    listingId={listing.id}
                    initialTag={getListingTag(listing.tags)}
                    onTagChange={onTagChange ? (nextTag) => onTagChange(listing.id, nextTag) : undefined}
                  />
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex justify-end gap-3">
                    <Link
                      href={`/agent/dashboard/listings/${listing.id}/edit`}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Edit
                    </Link>
                    <form
                      action={deleteListing.bind(null, listing.id)}
                      onSubmit={(e) => {
                        if (!confirm("Are you sure you want to delete this listing?")) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <button type="submit" className="text-red-600 hover:text-red-800 cursor-pointer">
                        Delete
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
