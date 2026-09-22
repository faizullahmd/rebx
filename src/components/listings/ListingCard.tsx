import Link from "next/link";
import type { Listing, ListingImage } from "@prisma/client";
import { TRANSACTION_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/property-taxonomy";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ListingCard({
  listing,
}: {
  listing: Listing & { images: ListingImage[] };
}) {
  const cover = listing.images[0]?.url;

  return (
    <Link
      href={`/listings/${listing.slug}`}
      className="group block overflow-hidden rounded-lg border border-gray-200 hover:shadow-md"
    >
      <div className="aspect-[4/3] w-full bg-gray-100">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={listing.title}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            No photo
          </div>
        )}
      </div>
      <div className="p-4">
        <p className="text-sm text-gray-500">
          {listing.city}
          {listing.state ? `, ${listing.state}` : ""}
        </p>
        <h3 className="mt-1 truncate font-medium text-gray-900">{listing.title}</h3>
        {listing.propertyType && (
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            {PROPERTY_TYPE_LABELS[listing.propertyType]} · {TRANSACTION_LABELS[listing.transactionType]}
          </p>
        )}
        <p className="mt-2 text-lg font-semibold">
          {currencyFormatter.format(Number(listing.price))}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {[
            listing.bedrooms ? `${listing.bedrooms} bd` : null,
            listing.bathrooms ? `${listing.bathrooms} ba` : null,
            listing.areaSqFt ? `${listing.areaSqFt} sqft` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}
