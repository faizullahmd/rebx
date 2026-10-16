import { z } from "zod";

// Shared rules for contact details typed into public forms.

export const PHONE_MESSAGE = "Enter a valid phone number, e.g. +91 98765 43210 (7 to 15 digits).";
export const EMAIL_MESSAGE = "Please enter a valid email address, e.g. name@example.com.";

/** Same rule as the browser-side `pattern`, so the form and the server agree. */
export function isValidPhone(value: string): boolean {
  if (!/^\+?[0-9\s().-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/** Optional phone: empty is fine, anything typed must look like a real number. */
export const optionalPhone = z
  .string()
  .trim()
  .max(30, PHONE_MESSAGE)
  .refine((v) => v === "" || isValidPhone(v), PHONE_MESSAGE)
  .optional();

/** Required email with a real domain and top-level domain (name@martecz is rejected). */
export const emailAddress = z
  .string()
  .trim()
  .max(254, EMAIL_MESSAGE)
  .regex(/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/, EMAIL_MESSAGE);
