import { z } from "zod";

export const BookingFormSchema = z.object({
  bookingNumber: z.string().trim().optional().or(z.literal("")),
  unitNumber: z.string().trim().optional().or(z.literal("")),
  saleAmount: z.coerce.number().positive("Sale amount must be a positive number."),
  bookingDate: z.coerce.date({ error: "Please enter a valid date." }),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type BookingFormState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof BookingFormSchema>, string[]>>;
      message?: string;
    }
  | undefined;
