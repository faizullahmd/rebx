import { z } from "zod";

export const RESERVED_USERNAMES = new Set([
  "admin",
  "admins",
  "api",
  "login",
  "signin",
  "signup",
  "register",
  "dashboard",
  "agent",
  "agents",
  "developer",
  "developers",
  "customer",
  "customers",
  "user",
  "users",
  "listing",
  "listings",
  "portfolio",
  "portfolios",
  "settings",
  "account",
  "support",
  "help",
  "rebx",
  "deal",
  "deals",
  "commission",
  "commissions",
  "list-property",
  "join-as-agent",
  "forgot-password",
  "reset-password",
  "unauthorized",
  "auth",
  "public",
  "terms",
  "privacy",
  "contact",
  "about",
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsernameFormat(username: string): { valid: boolean; error?: string } {
  const trimmed = username.trim();
  const normalized = trimmed.toLowerCase();

  if (normalized.length < 3 || normalized.length > 30) {
    return { valid: false, error: "Username must be between 3 and 30 characters." };
  }

  if (normalized.startsWith("-")) {
    return { valid: false, error: "Username cannot start with a hyphen." };
  }

  if (normalized.endsWith("-")) {
    return { valid: false, error: "Username cannot end with a hyphen." };
  }

  if (normalized.includes("--")) {
    return { valid: false, error: "Username cannot contain consecutive hyphens." };
  }

  if (!/^[a-z0-9-]+$/.test(normalized)) {
    return {
      valid: false,
      error: "Username can only contain lowercase letters, numbers, and hyphens.",
    };
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    return { valid: false, error: "This username is reserved and cannot be used." };
  }

  return { valid: true };
}

export const UsernameSchema = z
  .string()
  .trim()
  .transform((val) => val.toLowerCase())
  .superRefine((val, ctx) => {
    const check = validateUsernameFormat(val);
    if (!check.valid && check.error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: check.error,
      });
    }
  });

export function generateUsernameFromText(text: string): string {
  let slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  if (slug.length < 3) slug = `${slug}-agent`.replace(/^-+/, "");
  if (slug.length < 3) slug = "agent";
  if (slug.length > 30) slug = slug.slice(0, 30).replace(/-+$/, "");
  return slug;
}
