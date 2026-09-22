import { z } from "zod";

export const optionalNumber = (schema: z.ZodType<number>) =>
  z.preprocess((val) => (val === "" || val === undefined || val === null ? undefined : val), schema.optional());

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
});

export type ListingFormState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof ListingFormSchema>, string[]>>;
      message?: string;
    }
  | undefined;
