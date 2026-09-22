import { z } from "zod";
import { optionalNumber } from "@/lib/validation/listing";

export const DEAL_STAGES = [
  "NEW",
  "CONTACTED",
  "VIEWING_SCHEDULED",
  "OFFER_MADE",
  "NEGOTIATION",
  "UNDER_CONTRACT",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

export const InquiryFormSchema = z.object({
  contactName: z.string().trim().min(2, "Name must be at least 2 characters."),
  contactEmail: z.string().trim().email("Please enter a valid email."),
  contactPhone: z.string().trim().optional().or(z.literal("")),
  message: z.string().trim().optional().or(z.literal("")),
});

export const CustomerInquirySchema = z.object({
  contactPhone: z.string().trim().optional().or(z.literal("")),
  message: z.string().trim().optional().or(z.literal("")),
});

export type InquiryFormState =
  | {
      errors?: Partial<Record<string, string[]>>;
      message?: string;
    }
  | undefined;

export const ManualDealSchema = InquiryFormSchema.extend({
  listingId: z.string().trim().min(1, "Please select a listing."),
});

export const UpdateDealSchema = z.object({
  stage: z.enum(DEAL_STAGES),
  offerAmount: optionalNumber(z.coerce.number().positive()),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type UpdateDealState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof UpdateDealSchema>, string[]>>;
      message?: string;
    }
  | undefined;
