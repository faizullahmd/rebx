import type {
  TransactionType,
  PropertyCategory,
  PropertyType,
  FurnishingStatus,
  FacingDirection,
  AvailabilityStatus,
} from "@prisma/client";

export const TRANSACTION_TYPES: TransactionType[] = [
  "FOR_SALE",
  "FOR_RENT",
  "FOR_LEASE",
  "AUCTION",
];

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  FOR_SALE: "For Sale",
  FOR_RENT: "For Rent",
  FOR_LEASE: "For Lease",
  AUCTION: "Auction",
};

export const CATEGORY_LABELS: Record<PropertyCategory, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  LAND_PLOT: "Land / Plot",
  INDUSTRIAL: "Industrial",
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  APARTMENT: "Apartment",
  VILLA: "Villa",
  INDEPENDENT_HOUSE: "Independent House",
  BUILDER_FLOOR: "Builder Floor",
  PENTHOUSE: "Penthouse",
  STUDIO: "Studio",
  OFFICE: "Office",
  SHOP: "Shop",
  SHOWROOM: "Showroom",
  WAREHOUSE: "Warehouse",
  RESIDENTIAL_PLOT: "Residential Plot",
  COMMERCIAL_PLOT: "Commercial Plot",
  AGRICULTURAL_LAND: "Agricultural Land",
  FACTORY: "Factory",
  INDUSTRIAL_BUILDING: "Industrial Building",
  INDUSTRIAL_LAND: "Industrial Land",
};

export const FURNISHING_LABELS: Record<FurnishingStatus, string> = {
  UNFURNISHED: "Unfurnished",
  SEMI_FURNISHED: "Semi-furnished",
  FURNISHED: "Furnished",
};

export const FACING_LABELS: Record<FacingDirection, string> = {
  NORTH: "North",
  SOUTH: "South",
  EAST: "East",
  WEST: "West",
  NORTH_EAST: "North-East",
  NORTH_WEST: "North-West",
  SOUTH_EAST: "South-East",
  SOUTH_WEST: "South-West",
};

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  READY_TO_MOVE: "Ready to move",
  UNDER_CONSTRUCTION: "Under construction",
};

const SALE_TREE: Partial<Record<PropertyCategory, PropertyType[]>> = {
  RESIDENTIAL: ["APARTMENT", "VILLA", "INDEPENDENT_HOUSE", "BUILDER_FLOOR", "PENTHOUSE"],
  COMMERCIAL: ["OFFICE", "SHOP", "SHOWROOM", "WAREHOUSE"],
  LAND_PLOT: ["RESIDENTIAL_PLOT", "COMMERCIAL_PLOT", "AGRICULTURAL_LAND"],
  INDUSTRIAL: ["FACTORY", "INDUSTRIAL_BUILDING", "INDUSTRIAL_LAND"],
};

const RENT_TREE: Partial<Record<PropertyCategory, PropertyType[]>> = {
  RESIDENTIAL: ["APARTMENT", "VILLA", "INDEPENDENT_HOUSE", "STUDIO"],
  COMMERCIAL: ["OFFICE", "SHOP", "SHOWROOM", "WAREHOUSE"],
  INDUSTRIAL: ["FACTORY", "INDUSTRIAL_BUILDING", "WAREHOUSE"],
};

export const CATEGORY_TYPES: Record<TransactionType, Partial<Record<PropertyCategory, PropertyType[]>>> = {
  FOR_SALE: SALE_TREE,
  AUCTION: SALE_TREE,
  FOR_RENT: RENT_TREE,
  FOR_LEASE: RENT_TREE,
};

export function categoriesFor(transactionType: TransactionType): PropertyCategory[] {
  return Object.keys(CATEGORY_TYPES[transactionType]) as PropertyCategory[];
}

export function typesFor(
  transactionType: TransactionType,
  category: PropertyCategory | ""
): PropertyType[] {
  if (!category) return [];
  return CATEGORY_TYPES[transactionType][category] ?? [];
}

/**
 * Which optional listing detail fields make sense for a given category.
 * A land plot has no "furnishing"; raw industrial land has no "age".
 */
export const FIELD_VISIBILITY: Record<
  PropertyCategory,
  { bedBath: boolean; furnishing: boolean; parking: boolean; facing: boolean; availability: boolean; age: boolean }
> = {
  RESIDENTIAL: { bedBath: true, furnishing: true, parking: true, facing: true, availability: true, age: true },
  COMMERCIAL: { bedBath: false, furnishing: true, parking: true, facing: false, availability: true, age: true },
  LAND_PLOT: { bedBath: false, furnishing: false, parking: false, facing: true, availability: false, age: false },
  INDUSTRIAL: { bedBath: false, furnishing: false, parking: true, facing: false, availability: true, age: true },
};
