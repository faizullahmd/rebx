import { z } from "zod";

export const SITE_VISIT_TIME_SLOTS = [
  "09:00 AM - 10:00 AM",
  "10:00 AM - 11:00 AM",
  "11:00 AM - 12:00 PM",
  "12:00 PM - 01:00 PM",
  "02:00 PM - 03:00 PM",
  "03:00 PM - 04:00 PM",
  "04:00 PM - 05:00 PM",
  "05:00 PM - 06:00 PM",
] as const;

export const TIME_SLOTS = SITE_VISIT_TIME_SLOTS;
export type SiteVisitTimeSlot = (typeof SITE_VISIT_TIME_SLOTS)[number];

export const SITE_VISIT_TYPES = ["IN_PERSON", "VIRTUAL"] as const;
export type SiteVisitTypeEnum = (typeof SITE_VISIT_TYPES)[number];

export const SITE_VISIT_STATUSES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"] as const;
export type SiteVisitStatusEnum = (typeof SITE_VISIT_STATUSES)[number];

export const SITE_VISIT_STATUS_LABELS: Record<SiteVisitStatusEnum, string> = {
  PENDING: "Pending Confirmation",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

export const BookSiteVisitSchema = z.object({
  date: z
    .string()
    .trim()
    .min(1, "Visit date is required.")
    .refine((val) => {
      const parsed = new Date(val);
      if (Number.isNaN(parsed.getTime())) return false;
      // Date must not be in the past (compare with today's midnight in local time)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const visitDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      return visitDate >= today;
    }, "Visit date cannot be in the past."),
  timeSlot: z.enum(SITE_VISIT_TIME_SLOTS, {
    message: "Please select a valid time slot.",
  }),
  visitType: z.enum(SITE_VISIT_TYPES, {
    message: "Please select a valid visit type.",
  }).default("IN_PERSON"),
  notes: z.string().trim().max(1000, "Notes cannot exceed 1000 characters.").optional().or(z.literal("")),
});

export const CancelSiteVisitSchema = z.object({
  siteVisitId: z.number().int().positive().optional(),
  reason: z.string().trim().max(500, "Reason cannot exceed 500 characters.").optional().or(z.literal("")),
});

export const RescheduleSiteVisitSchema = z.object({
  siteVisitId: z.number().int().positive().optional(),
  date: z
    .string()
    .trim()
    .min(1, "Visit date is required.")
    .refine((val) => {
      const parsed = new Date(val);
      if (Number.isNaN(parsed.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const visitDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      return visitDate >= today;
    }, "Visit date cannot be in the past."),
  timeSlot: z.enum(SITE_VISIT_TIME_SLOTS, {
    message: "Please select a valid time slot.",
  }),
  reason: z.string().trim().max(500, "Reason cannot exceed 500 characters.").optional().or(z.literal("")),
});

export type BookSiteVisitInput = z.infer<typeof BookSiteVisitSchema>;
export type CancelSiteVisitInput = z.infer<typeof CancelSiteVisitSchema>;
export type RescheduleSiteVisitInput = z.infer<typeof RescheduleSiteVisitSchema>;
