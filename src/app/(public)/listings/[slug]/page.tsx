import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getListingBySlug } from "@/lib/data/listings";
import { InquiryForm } from "@/components/deals/InquiryForm";
import { BrokerCard } from "@/components/listings/BrokerCard";
import { ListingImageCarousel } from "@/components/listings/ListingImageCarousel";
import { ListingVideosSection } from "@/components/listings/ListingVideosSection";
import { PropertyVideoPlayer } from "@/components/listings/PropertyVideoPlayer";
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

  console.log("Listing in detail page:", listing.title, "videoUrl:", listing.videoUrl);

  const session = await auth();

  if (listing.status !== "ACTIVE") {
    const isOwnerOrAdmin =
      session?.user &&
      (Number(session.user.id) === listing.agentId || session.user.role === "ADMIN");
    if (!isOwnerOrAdmin) {
      notFound();
    }
  }

  const agentPhone = listing.agent.agentProfile?.phone || "+1 (512) 555-0198";

  return (
    <article className="flex flex-col gap-6">
      {listing.status !== "ACTIVE" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This listing is {listing.status.replace("_", " ").toLowerCase()} — only visible to
          you as a preview.
        </p>
      )}

      <ListingImageCarousel images={listing.images} alt={listing.title} />

      {(listing.video?.url || listing.videoUrl) && (
        <PropertyVideoPlayer
          videoUrl={listing.video?.url || listing.videoUrl!}
          title={listing.video?.title || listing.title}
        />
      )}

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
            {((listing as any).avgPricePerSqFt || (listing as any).possessionStarts || (listing as any).reraId) && (
              <p className="mt-1 text-sm text-gray-500">
                {[
                  (listing as any).avgPricePerSqFt ? `Avg: ${(listing as any).avgPricePerSqFt}` : null,
                  (listing as any).possessionStarts ? `Possession: ${(listing as any).possessionStarts}` : null,
                  (listing as any).reraId ? `RERA: ${(listing as any).reraId}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>

          <p className="whitespace-pre-wrap text-gray-700">{listing.description}</p>

          {listing.videos && listing.videos.length > 0 && (
            <ListingVideosSection videos={listing.videos} />
          )}
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
          {/* Broker Card with Mobile Number and Ratings & Reviews */}
          <BrokerCard
            agentId={listing.agent.id}
            listingId={listing.id}
            agentName={listing.agent.name}
            agentPhone={agentPhone}
            agentUsername={listing.agent.username}
          />

          {/* Interest Card */}
          {listing.status === "ACTIVE" && (
            <InquiryForm
              listingId={listing.id}
              isLoggedInCustomer={session?.user?.role === "CUSTOMER"}
            />
          )}
        </div>
      </div>
    </article>
  );
}
