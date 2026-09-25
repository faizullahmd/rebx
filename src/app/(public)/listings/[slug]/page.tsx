import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getListingBySlug } from "@/lib/data/listings";
import { InquiryForm } from "@/components/deals/InquiryForm";
import { ListingImageCarousel } from "@/components/listings/ListingImageCarousel";
import { Avatar } from "@/components/ui/Avatar";
import {
  TRANSACTION_LABELS,
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
  FURNISHING_LABELS,
  FACING_LABELS,
  AVAILABILITY_LABELS,
} from "@/lib/property-taxonomy";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);

  if (!listing) {
    notFound();
  }

  const session = await auth();

  if (listing.status !== "ACTIVE") {
    const isOwnerOrAdmin =
      session?.user &&
      (Number(session.user.id) === listing.agentId || session.user.role === "ADMIN");
    if (!isOwnerOrAdmin) {
      notFound();
    }
  }

  return (
    <article className="flex flex-col gap-6">
      {listing.status !== "ACTIVE" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This listing is {listing.status.replace("_", " ").toLowerCase()} — only visible to
          you as a preview.
        </p>
      )}

      <ListingImageCarousel images={listing.images} alt={listing.title} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div>
            <p className="text-sm text-gray-500">
              {listing.addressLine}, {listing.city}
              {listing.state ? `, ${listing.state}` : ""}, {listing.country}
            </p>
            <h1 className="mt-1 text-3xl font-semibold">{listing.title}</h1>
            {(listing.propertyCategory || listing.propertyType) && (
              <p className="mt-1 text-sm font-medium uppercase tracking-wide text-gray-500">
                {[
                  listing.propertyType ? PROPERTY_TYPE_LABELS[listing.propertyType] : null,
                  listing.propertyCategory ? CATEGORY_LABELS[listing.propertyCategory] : null,
                  TRANSACTION_LABELS[listing.transactionType],
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p className="mt-2 text-2xl font-semibold text-gray-900">
              {currencyFormatter.format(Number(listing.price))}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {[
                listing.bedrooms ? `${listing.bedrooms} bedrooms` : null,
                listing.bathrooms ? `${listing.bathrooms} bathrooms` : null,
                listing.areaSqFt ? `${listing.areaSqFt} sqft` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {(listing.furnishing || listing.parkingSpots || listing.facing || listing.availability || listing.propertyAgeYears != null) && (
              <p className="mt-1 text-sm text-gray-500">
                {[
                  listing.furnishing ? FURNISHING_LABELS[listing.furnishing] : null,
                  listing.parkingSpots ? `${listing.parkingSpots} parking` : null,
                  listing.facing ? `${FACING_LABELS[listing.facing]} facing` : null,
                  listing.availability ? AVAILABILITY_LABELS[listing.availability] : null,
                  listing.propertyAgeYears != null ? `${listing.propertyAgeYears} yrs old` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>

          <p className="whitespace-pre-wrap text-gray-700">{listing.description}</p>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm">
            <Avatar name={listing.agent.name} />
            <div>
              <p className="font-medium text-gray-900">{listing.agent.name}</p>
              <p className="text-xs text-gray-500">Listing agent</p>
              <p className="text-gray-600">{listing.agent.email}</p>
            </div>
          </div>

          {listing.status === "ACTIVE" && (
            <InquiryForm listingId={listing.id} isLoggedInCustomer={session?.user?.role === "CUSTOMER"} />
          )}
        </div>
      </div>
    </article>
  );
}
