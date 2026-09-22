import { z } from "zod";

export const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess((val) => (val === "" || val === undefined || val === null ? undefined : val), schema.optional());

export const optionalEnum = <U extends string, T extends readonly [U, ...U[]]>(values: T) =>
  z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? undefined : val),
    z.enum(values).optional()
  );

export const ListingFormSchema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters."),
  description: z.string().trim().min(20, "Description must be at least 20 characters."),
  price: z.coerce.number().positive("Price must be a positive number."),
  currency: z.string().trim().min(1).max(8).default("USD"),
  addressLine: z.string().trim().min(3, "Address is required."),
  city: z.string().trim().min(1, "City is required."),
  state: z.string().trim().optional().or(z.literal("")),
  country: z.string().trim().min(1, "Country is required."),
  postalCode: z.string().trim().optional().or(z.literal("")),
  bedrooms: optionalNumber(z.coerce.number().int().nonnegative()),
  bathrooms: optionalNumber(z.coerce.number().int().nonnegative()),
  areaSqFt: optionalNumber(z.coerce.number().int().positive()),
  status: z.enum(["DRAFT", "ACTIVE", "UNDER_OFFER", "SOLD"]),
  developerId: z.string().trim().optional().or(z.literal("")),
  imageUrls: z.string().trim().optional().or(z.literal("")),
  requestDeveloperCompanyName: z.string().trim().optional().or(z.literal("")),
  requestDeveloperContactName: z.string().trim().optional().or(z.literal("")),
  requestDeveloperEmail: z.string().trim().optional().or(z.literal("")),
  requestDeveloperPhone: z.string().trim().optional().or(z.literal("")),
  transactionType: z.enum(["FOR_SALE", "FOR_RENT", "FOR_LEASE", "AUCTION"]),
  propertyCategory: optionalEnum(["RESIDENTIAL", "COMMERCIAL", "LAND_PLOT", "INDUSTRIAL"]),
  propertyType: optionalEnum([
    "APARTMENT",
    "VILLA",
    "INDEPENDENT_HOUSE",
    "BUILDER_FLOOR",
    "PENTHOUSE",
    "STUDIO",
    "OFFICE",
    "SHOP",
    "SHOWROOM",
    "WAREHOUSE",
    "RESIDENTIAL_PLOT",
    "COMMERCIAL_PLOT",
    "AGRICULTURAL_LAND",
    "FACTORY",
    "INDUSTRIAL_BUILDING",
    "INDUSTRIAL_LAND",
  ]),
  furnishing: optionalEnum(["UNFURNISHED", "SEMI_FURNISHED", "FURNISHED"]),
  parkingSpots: optionalNumber(z.coerce.number().int().nonnegative()),
  facing: optionalEnum(["NORTH", "SOUTH", "EAST", "WEST", "NORTH_EAST", "NORTH_WEST", "SOUTH_EAST", "SOUTH_WEST"]),
  propertyAgeYears: optionalNumber(z.coerce.number().int().nonnegative()),
  availability: optionalEnum(["READY_TO_MOVE", "UNDER_CONSTRUCTION"]),
});

export type ListingFormState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof ListingFormSchema>, string[]>>;
      message?: string;
    }
  | undefined;
