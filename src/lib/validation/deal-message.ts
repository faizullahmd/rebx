 import { z } from "zod";

export const MessageTextSchema = z
  .string()
  .trim()
  .min(1, "Message cannot be empty.")
  .max(2000, "Message cannot exceed 2000 characters.");

export const ExpiryOptionSchema = z.enum(["none", "24h", "48h", "7d"]);
export type ExpiryOption = z.infer<typeof ExpiryOptionSchema>;

export const SendMessageSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  text: MessageTextSchema,
});

export const SendOfferSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive("Offer amount must be greater than zero."),
  expiry: ExpiryOptionSchema.default("none"),
  text: z.string().trim().max(2000, "Note cannot exceed 2000 characters.").optional().or(z.literal("")),
});

export const CounterOfferSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  messageId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive("Counter offer amount must be greater than zero."),
  expiry: ExpiryOptionSchema.default("none"),
  text: z.string().trim().max(2000, "Note cannot exceed 2000 characters.").optional().or(z.literal("")),
});

export const PrivateNoteSchema = z.object({
  dealId: z.coerce.number().int().positive(),
  text: MessageTextSchema,
});

export function computeExpiryDate(option: ExpiryOption): Date | null {
  const now = new Date();
  switch (option) {
    case "24h":
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    case "48h":
      return new Date(now.getTime() + 48 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "none":
    default:
      return null;
  }
}

// In-memory token bucket rate-limiter per user (resets per sliding window)
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

export function checkRateLimit(userId: number, maxRequests = 25, windowMs = 60 * 1000): boolean {
  const now = Date.now();
  const userRate = rateLimitMap.get(userId);

  if (!userRate || now > userRate.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (userRate.count >= maxRequests) {
    return false;
  }

  userRate.count += 1;
  return true;
}
