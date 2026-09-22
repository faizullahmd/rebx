import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";
import { ListingCard } from "@/components/listings/ListingCard";
import { ListingFilters } from "@/components/listings/ListingFilters";
import { getPublicActiveListings } from "@/lib/data/listings";
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
  const city = paramString(params.city);
  const minPrice = paramString(params.minPrice);
  const maxPrice = paramString(params.maxPrice);
  const bedrooms = paramString(params.bedrooms);

  const transactionTypeRaw = paramString(params.transactionType);
  const propertyCategoryRaw = paramString(params.propertyCategory);
  const propertyTypeRaw = paramString(params.propertyType);

  const transactionType = TRANSACTION_TYPES.includes(transactionTypeRaw as TransactionType)
    ? (transactionTypeRaw as TransactionType)
    : undefined;
  const propertyCategory = Object.keys(CATEGORY_LABELS).includes(propertyCategoryRaw ?? "")
    ? (propertyCategoryRaw as PropertyCategory)
    : undefined;
  const propertyType = Object.keys(PROPERTY_TYPE_LABELS).includes(propertyTypeRaw ?? "")
    ? (propertyTypeRaw as PropertyType)
    : undefined;

  const listings = await getPublicActiveListings({
    city: city || undefined,
    minPrice: minPrice ? Number(minPrice) : undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    bedrooms: bedrooms ? Number(bedrooms) : undefined,
    transactionType,
    propertyCategory,
    propertyType,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Browse listings</h1>
      <ListingFilters
        defaultValues={{
          city,
          minPrice,
          maxPrice,
          bedrooms,
          transactionType,
          propertyCategory,
          propertyType,
        }}
      />
      {listings.length === 0 ? (
        <p className="text-sm text-gray-500">No listings match your search.</p>
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
