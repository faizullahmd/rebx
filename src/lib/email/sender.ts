// Sender helpers. The platform's verified sender comes from RESEND_FROM_EMAIL; templates may
// customise the display name and use another address only on the SAME domain, so an admin
// can't make email appear to come from a domain Resend hasn't verified.

const DEFAULT_FROM = "REBX <onboarding@resend.dev>";

export function configuredFromRaw() {
  return process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
}

export function parseAddress(value: string): { name: string | null; email: string } {
  const match = value.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (match) return { name: match[1]?.trim() || null, email: match[2].trim() };
  return { name: null, email: value.trim() };
}

export function configuredSender() {
  return parseAddress(configuredFromRaw());
}

export function senderDomain() {
  return configuredSender().email.split("@")[1]?.toLowerCase() ?? "";
}

export function isAllowedSenderEmail(email: string) {
  return email.toLowerCase().endsWith(`@${senderDomain()}`);
}

const SAFE_NAME = /[<>"\r\n]/g;

/** Builds the `from` header. With no overrides it returns the configured value untouched. */
export function buildFromHeader(overrides: { fromName?: string | null; fromEmail?: string | null }) {
  if (!overrides.fromName && !overrides.fromEmail) return configuredFromRaw();
  const base = configuredSender();
  const email = overrides.fromEmail || base.email;
  const name = (overrides.fromName ?? base.name ?? "").replace(SAFE_NAME, "").trim();
  return name ? `${name} <${email}>` : email;
}

export function parseEmailList(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}
