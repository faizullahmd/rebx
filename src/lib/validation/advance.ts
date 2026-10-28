import { z } from "zod";

export const SaveAdvanceSchema = z.object({
  amount: z.coerce.number().positive("Advance amount must be greater than 0."),
  markAsPaid: z.preprocess(
    (val) => val === true || val === "true" || val === "on" || val === "1",
    z.boolean()
  ).optional().default(false),
  paidAt: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(1000, "Notes cannot exceed 1000 characters.").optional().or(z.literal("")),
  editReason: z.string().trim().max(500, "Reason cannot exceed 500 characters.").optional().or(z.literal("")),
});

export const UnmarkAdvanceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Reason must be at least 5 characters.")
    .max(500, "Reason cannot exceed 500 characters."),
});

export const MarkAdvancePaidSchema = z.object({
  paidAt: z.string().trim().optional().or(z.literal("")),
});

export type SaveAdvanceInput = z.infer<typeof SaveAdvanceSchema>;
export type UnmarkAdvanceInput = z.infer<typeof UnmarkAdvanceSchema>;
