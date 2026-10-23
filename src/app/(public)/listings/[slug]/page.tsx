import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getListingBySlug } from "@/lib/data/listings";
import { InquiryForm } from "@/components/deals/InquiryForm";
import { MakeDealCard } from "@/components/deals/MakeDealCard";
import { getOrCreateCustomerDeal } from "@/lib/actions/deals";
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
import { getListingTag } from "@/lib/tags";
import { ListingTagBadge } from "@/components/listings/ListingTagBadge";

import { formatListingPrice } from "@/lib/price";

function formatListingAddress(listing: {
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}) {
  const parts: string[] = [];
  const raw = listing.addressLine?.trim() || "";
  const lower = raw.toLowerCase();
  if (raw) parts.push(raw);
  if (listing.city && !lower.includes(listing.city.toLowerCase())) {
    parts.push(listing.city);
  }
  if (listing.state && !lower.includes(listing.state.toLowerCase())) {
    parts.push(listing.state);
  }
  if (listing.country && !lower.includes(listing.country.toLowerCase())) {
    parts.push(listing.country);
  }
  return parts.join(", ");
}

export default async function ListingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ startDeal?: string }>;
}) {
  const { slug } = await params;
  const sp = searchParams ? await searchParams : {};
  const listing = await getListingBySlug(slug);

  if (!listing) {
    notFound();
  }

  console.log("Listing in detail page:", listing.title, "videoUrl:", listing.videoUrl);

  const session = await auth();
  const isCustomer = session?.user?.role === "CUSTOMER";
  let alreadyInterested = false;
  let customerDeal: { id: number } | null = null;

  if (isCustomer && session?.user?.id) {
    customerDeal = await prisma.deal.findFirst({
      where: {
        listingId: listing.id,
        OR: [
          { customerId: Number(session.user.id) },
          ...(session.user.email ? [{ contactEmail: session.user.email }] : []),
        ],
      },
      select: { id: true },
    });
    alreadyInterested = Boolean(customerDeal);

    if (sp.startDeal === "true") {
      const res = await getOrCreateCustomerDeal(listing.id);
      if (res.success && res.dealUrl) {
        redirect(res.dealUrl);
      }
    }
  } else if (session?.user && sp.startDeal === "true") {
    const res = await getOrCreateCustomerDeal(listing.id);
    if (res.success && res.dealUrl) {
      redirect(res.dealUrl);
    }
  }

  if (listing.status !== "ACTIVE" && listing.status !== "UNDER_OFFER") {
    const isOwnerOrAdmin =
      session?.user &&
      (Number(session.user.id) === listing.agentId || session.user.role === "ADMIN");
    if (!isOwnerOrAdmin) {
      notFound();
    }
  }

  const agentPhone = listing.agent.agentProfile?.phone || "+1 (512) 555-0198";
  const tag = (listing as any).tag || getListingTag(listing.tags);

  return (
    <article className="flex flex-col gap-6">
      {listing.status === "UNDER_OFFER" ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          This property is currently under offer.
        </p>
      ) : listing.status !== "ACTIVE" ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This listing is {listing.status.replace("_", " ").toLowerCase()} — only visible to
          you as a preview.
        </p>
      ) : null}

      <ListingImageCarousel images={listing.images} alt={listing.title} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div>
            <p className="text-sm text-gray-500">
              {formatListingAddress(listing)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-semibold">{listing.title}</h1>
              {tag && <ListingTagBadge tag={tag} className="text-xs px-2.5 py-1" />}
            </div>
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
              {formatListingPrice(
                listing.price,
                listing.currency,
                listing.priceDisplay,
                (listing as any).priceOnRequest
              )}
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
            {((listing as any).avgPricePerSqFt ||
              (listing as any).possessionStarts ||
              (listing as any).reraId ||
              (listing as any).projectUnits ||
              (listing as any).projectArea) && (
              <p className="mt-1 text-sm text-gray-500">
                {[
                  (listing as any).projectUnits ? `Project Units: ${(listing as any).projectUnits}` : null,
                  (listing as any).projectArea ? `Project Size: ${(listing as any).projectArea} Acres` : null,
                  (listing as any).avgPricePerSqFt ? `Avg Price: ${(listing as any).avgPricePerSqFt}` : null,
                  (listing as any).possessionStarts ? `Possession: ${(listing as any).possessionStarts}` : null,
                  (listing as any).reraId ? `RERA: ${(listing as any).reraId}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>

          <p className="whitespace-pre-wrap text-gray-700">{listing.description}</p>

          {(listing.video?.url || listing.videoUrl) &&
            (!listing.videos?.length ||
              !listing.videos.some(
                (v) => v.url === (listing.video?.url || listing.videoUrl)
              )) && (
              <PropertyVideoPlayer
                videoUrl={listing.video?.url || listing.videoUrl!}
                title={listing.video?.title || listing.title}
              />
            )}

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
              isLoggedInCustomer={isCustomer}
              returningName={isCustomer ? session?.user?.name || null : null}
              alreadyInterested={alreadyInterested}
            />
          )}

          {/* Make a Deal Card */}
          {listing.status === "ACTIVE" && (
            <MakeDealCard
              listingId={listing.id}
              listingSlug={listing.slug}
              isLoggedIn={Boolean(session?.user)}
              isCustomer={isCustomer}
              existingDealId={customerDeal?.id || null}
            />
          )}
        </div>
      </div>
    </article>
  );
}
