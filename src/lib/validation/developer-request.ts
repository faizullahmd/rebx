import { z } from "zod";

export const REQUEST_NEW_DEVELOPER_VALUE = "__request_new__";

export const DeveloperRequestFieldsSchema = z.object({
  requestDeveloperCompanyName: z.string().trim().min(1, "Company name is required."),
  requestDeveloperContactName: z.string().trim().min(1, "Contact name is required."),
  requestDeveloperEmail: z.string().trim().email("Please enter a valid email."),
  requestDeveloperPhone: z.string().trim().optional().or(z.literal("")),
});

export const RejectDeveloperRequestSchema = z.object({
  rejectionReason: z.string().trim().optional().or(z.literal("")),
});
