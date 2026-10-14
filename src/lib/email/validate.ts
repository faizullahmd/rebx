import { z } from "zod";
import { EMAIL_CATEGORIES } from "@/lib/email/definitions";
import { isAllowedSenderEmail, parseEmailList, senderDomain } from "@/lib/email/sender";

export const KEY_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
export const EVENT_PATTERN = /^[a-z][a-z0-9_.]{2,79}$/;
const MAX_HTML = 200_000;
const MAX_TEXT = 100_000;

const emailSchema = z.string().email();
// Optional text fields arrive as undefined, "" (forms) or null (database rows); all mean "unset".
const optional = (schema: z.ZodString) =>
  z
    .union([schema, z.literal("")])
    .nullish()
    .transform((v) => (v ? v : null));

const emailList = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v ?? "")
  .superRefine((value, ctx) => {
    const list = parseEmailList(value);
    if (list.length > 5) ctx.addIssue({ code: "custom", message: "Use at most 5 addresses." });
    for (const address of list) {
      if (!emailSchema.safeParse(address).success) {
        ctx.addIssue({ code: "custom", message: `"${address}" is not a valid email address.` });
      }
    }
  })
  .transform((v) => {
    const list = parseEmailList(v);
    return list.length ? list.join(", ") : null;
  });

/** Fields an admin can change on a template (staged in the draft, applied on publish). */
export const contentFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120, "Name is too long."),
  description: optional(z.string().trim().max(500, "Description must be 500 characters or fewer.")),
  category: z.enum(EMAIL_CATEGORIES, { message: "Choose a category." }),
  subject: z
    .string()
    .trim()
    .min(1, "Subject is required.")
    .max(200, "Subject must be 200 characters or fewer.")
    .refine((v) => !/[\r\n]/.test(v), "Subject can't contain line breaks."),
  htmlBody: z
    .string()
    .min(1, "Email content is required.")
    .max(MAX_HTML, "Email content is too large."),
  textBody: optional(z.string().max(MAX_TEXT, "Plain-text content is too large.")),
  fromName: optional(
    z
      .string()
      .trim()
      .max(100, "Sender name is too long.")
      .refine((v) => !/[<>"\r\n]/.test(v), "Sender name can't contain < > \" or line breaks.")
  ),
  fromEmail: optional(
    z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid sender email.")
      .superRefine((v, ctx) => {
        if (!isAllowedSenderEmail(v)) {
          ctx.addIssue({
            code: "custom",
            message: `Sender email must be on the verified domain @${senderDomain()}.`,
          });
        }
      })
  ),
  replyTo: optional(z.string().trim().toLowerCase().email("Enter a valid reply-to email.")),
  cc: emailList,
  bcc: emailList,
});

export type ContentFields = z.output<typeof contentFieldsSchema>;

export const createFieldsSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(KEY_PATTERN, "Key must be 3-64 characters: lowercase letters, numbers and underscores, starting with a letter."),
  event: z
    .string()
    .trim()
    .regex(EVENT_PATTERN, "Event must look like area.action (lowercase letters, numbers, underscores, dots)."),
  name: contentFieldsSchema.shape.name,
  description: contentFieldsSchema.shape.description,
  category: contentFieldsSchema.shape.category,
  subject: contentFieldsSchema.shape.subject,
});

export function flattenErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    (out[field] ??= []).push(issue.message);
  }
  return out;
}

export { analyseContent, suggestVariable } from "@/lib/email/analysis";
export type { ContentAnalysis } from "@/lib/email/analysis";
