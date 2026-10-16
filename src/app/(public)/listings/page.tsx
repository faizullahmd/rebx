import Link from "next/link";
import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";
import { ListingCard } from "@/components/listings/ListingCard";
import { ListingFilters } from "@/components/listings/ListingFilters";
import { SearchHero } from "@/components/listings/SearchHero";
import { ActiveFiltersBar } from "@/components/listings/ActiveFiltersBar";
import { getPublicActiveListings, getPopularChipsData } from "@/lib/data/listings";
import { TRANSACTION_TYPES, CATEGORY_LABELS, PROPERTY_TYPE_LABELS } from "@/lib/property-taxonomy";

function paramString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = paramString(params.q);
  const tag = paramString(params.tag);
  const city = paramString(params.city);
  const minPrice = paramString(params.minPrice);
  const maxPrice = paramString(params.maxPrice);
  const bedrooms = paramString(params.bedrooms);

  const transactionTypeRaw = paramString(params.transactionType);
  const propertyCategoryRaw = paramString(params.propertyCategory);
  const propertyTypeRaw = paramString(params.propertyType) ?? paramString(params.type);

  const transactionType = TRANSACTION_TYPES.includes(transactionTypeRaw as TransactionType)
    ? (transactionTypeRaw as TransactionType)
    : undefined;
  const propertyCategory = Object.keys(CATEGORY_LABELS).includes(propertyCategoryRaw ?? "")
    ? (propertyCategoryRaw as PropertyCategory)
    : undefined;
  const propertyType = Object.keys(PROPERTY_TYPE_LABELS).includes(propertyTypeRaw ?? "")
    ? (propertyTypeRaw as PropertyType)
    : undefined;

  const [popularChips, listings] = await Promise.all([
    getPopularChipsData(),
    getPublicActiveListings({
      city: city || undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      bedrooms: bedrooms ? Number(bedrooms) : undefined,
      transactionType,
      propertyCategory,
      propertyType,
      q: q?.trim() || undefined,
      tag: tag?.trim() || undefined,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      {/* Search Hero above the filter card */}
      <SearchHero popularChips={popularChips} />

      {/* Existing filter card */}
      <ListingFilters
        key={`filters-${city ?? ""}-${minPrice ?? ""}-${maxPrice ?? ""}-${bedrooms ?? ""}-${transactionType ?? ""}-${propertyCategory ?? ""}-${propertyType ?? ""}-${q ?? ""}-${tag ?? ""}`}
        defaultValues={{
          city,
          minPrice,
          maxPrice,
          bedrooms,
          transactionType,
          propertyCategory,
          propertyType,
          q,
          tag,
        }}
      />

      {/* Result feedback and active filter pills */}
      <ActiveFiltersBar count={listings.length} />

      {/* Listing Cards or Empty State */}
      {listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white p-8 sm:p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 mb-3">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h2 className="text-base sm:text-lg font-semibold text-neutral-900">No properties found</h2>
          <p className="mt-1 text-xs sm:text-sm text-neutral-500 max-w-md">
            We couldn&apos;t find any listings matching your search criteria. Try clearing some filters or searching for another location.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/listings"
              className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-xs sm:text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              Clear all filters
            </Link>
          </div>
          {popularChips.length > 0 && (
            <div className="mt-6 border-t border-neutral-100 pt-4 w-full max-w-md">
              <p className="text-xs font-medium text-neutral-400 mb-2">Suggested searches:</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {popularChips.slice(0, 4).map((chip) => (
                  <Link
                    key={chip.id}
                    href={`/listings?${chip.paramKey}=${encodeURIComponent(chip.paramValue)}`}
                    className="inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 transition-colors"
                  >
                    {chip.label}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </div>
  );
}
