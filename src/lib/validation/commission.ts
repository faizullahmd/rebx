import { z } from "zod";

export const COMMISSION_SOURCES = ["DEVELOPER", "CUSTOMER"] as const;
export const COMMISSION_STATUSES = ["PENDING", "INVOICED", "RECEIVED"] as const;

export const CommissionFormSchema = z.object({
  source: z.enum(COMMISSION_SOURCES),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type CommissionFormState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof CommissionFormSchema>, string[]>>;
      message?: string;
    }
  | undefined;

export const UpdateCommissionStatusSchema = z.object({
  status: z.enum(COMMISSION_STATUSES),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  notes: z.string().trim().optional().or(z.literal("")),
});

export type UpdateCommissionStatusState =
  | {
      errors?: Partial<Record<keyof z.infer<typeof UpdateCommissionStatusSchema>, string[]>>;
      message?: string;
    }
  | undefined;
