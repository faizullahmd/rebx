// The shared email layout: ONE wrapper (accent bar, logo header, content card, footer) applied
// to every email, so templates only hold their message. Pure and dependency-free so the same
// code builds production emails, previews and test emails. Settings are structured (not raw
// HTML) and every value is validated and escaped here, so an edit can't break the markup.
import { escapeHtml } from "@/lib/email/escape";

export interface LayoutSettings {
  logoUrl: string;
  logoWidth: number;
  logoAlt: string;
  accentColor: string;
  backgroundColor: string;
  footerText: string;
  footerNote: string;
  supportEmail: string;
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  logoUrl: "https://rebx.app/logo.png",
  logoWidth: 150,
  logoAlt: "REBX",
  accentColor: "#16a34a",
  backgroundColor: "#f4f4f5",
  footerText: "REBX · Real Estate Broker Exchange",
  footerNote: "You are receiving this email because of activity on your REBX account.",
  supportEmail: "",
};

export const LAYOUT_KEY = "default";

const HEX = /^#[0-9a-fA-F]{6}$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;

export type LayoutErrors = Partial<Record<keyof LayoutSettings, string>>;

/** Validates a full settings object. Returns field errors (empty object = valid). */
export function validateLayout(s: LayoutSettings): LayoutErrors {
  const e: LayoutErrors = {};
  if (!HTTPS.test(s.logoUrl) || s.logoUrl.length > 500) e.logoUrl = "Logo URL must be a full https:// address.";
  if (!Number.isInteger(s.logoWidth) || s.logoWidth < 60 || s.logoWidth > 300) e.logoWidth = "Logo width must be a whole number from 60 to 300.";
  if (!s.logoAlt.trim() || s.logoAlt.length > 80) e.logoAlt = "Enter alt text (up to 80 characters).";
  if (!HEX.test(s.accentColor)) e.accentColor = "Use a 6-digit hex colour like #16a34a.";
  if (!HEX.test(s.backgroundColor)) e.backgroundColor = "Use a 6-digit hex colour like #f4f4f5.";
  if (s.footerText.length > 300) e.footerText = "Footer text must be 300 characters or fewer.";
  if (s.footerNote.length > 300) e.footerNote = "Footer note must be 300 characters or fewer.";
  if (s.supportEmail && !EMAIL.test(s.supportEmail)) e.supportEmail = "Enter a valid email address, or leave it empty.";
  return e;
}

/** Coerces untrusted/partial input (form data, stored JSON) into a complete settings object. */
export function normalizeLayout(raw: unknown): LayoutSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof LayoutSettings) => (typeof r[k] === "string" ? (r[k] as string).trim() : String(DEFAULT_LAYOUT[k]));
  const width = Number(r.logoWidth);
  return {
    logoUrl: str("logoUrl"),
    logoWidth: Number.isFinite(width) ? Math.round(width) : DEFAULT_LAYOUT.logoWidth,
    logoAlt: str("logoAlt"),
    accentColor: str("accentColor"),
    backgroundColor: str("backgroundColor"),
    footerText: typeof r.footerText === "string" ? r.footerText.trim() : DEFAULT_LAYOUT.footerText,
    footerNote: typeof r.footerNote === "string" ? r.footerNote.trim() : DEFAULT_LAYOUT.footerNote,
    supportEmail: typeof r.supportEmail === "string" ? r.supportEmail.trim() : "",
  };
}

/**
 * Settings read back from storage are re-validated at send time: a bad stored value falls back
 * to the default for that field, so a corrupted row can never produce a broken or unsafe email.
 */
export function safeLayout(raw: unknown): LayoutSettings {
  const s = normalizeLayout(raw);
  const errors = validateLayout(s);
  const out = { ...s };
  for (const key of Object.keys(errors) as (keyof LayoutSettings)[]) {
    (out as Record<string, unknown>)[key] = DEFAULT_LAYOUT[key];
  }
  return out;
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";
const nl2br = (v: string) => escapeHtml(v).replace(/\r?\n/g, "<br>");

export interface ComposeOptions {
  /** Used for the document <title> and the hidden inbox preview. */
  subject?: string;
  /** Extra HTML shown above the card (e.g. the TEST EMAIL banner). Trusted, caller-built. */
  banner?: string;
}

/** Wraps rendered body HTML in the shared layout and returns a complete HTML document. */
export function composeEmail(bodyHtml: string, settings: LayoutSettings, options: ComposeOptions = {}): string {
  const s = safeLayout(settings);
  const footerLines: string[] = [];
  if (s.footerText) footerLines.push(`<p style="margin:0 0 6px 0;font-weight:bold;color:#52525b;">${nl2br(s.footerText)}</p>`);
  if (s.footerNote) footerLines.push(`<p style="margin:0 0 6px 0;">${nl2br(s.footerNote)}</p>`);
  if (s.supportEmail) {
    const mail = escapeHtml(s.supportEmail);
    footerLines.push(`<p style="margin:0;">Questions? <a href="mailto:${mail}" style="color:#52525b;text-decoration:underline;">${mail}</a></p>`);
  }
  const footer = footerLines.length
    ? `<tr><td align="center" style="padding:20px 24px 28px 24px;${FONT}font-size:12px;line-height:18px;color:#a1a1aa;">${footerLines.join("")}</td></tr>`
    : "";

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="x-apple-disable-message-reformatting">` +
    `<title>${escapeHtml(options.subject ?? "")}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${s.backgroundColor};">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${s.backgroundColor};"><tbody><tr><td align="center" style="padding:24px 12px;">` +
    (options.banner ?? "") +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;"><tbody>` +
    `<tr><td style="height:4px;line-height:4px;font-size:1px;background-color:${s.accentColor};border-radius:12px 12px 0 0;">&nbsp;</td></tr>` +
    `<tr><td style="background-color:#ffffff;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tbody>` +
    `<tr><td align="center" style="padding:26px 24px 20px 24px;border-bottom:1px solid #e4e4e7;"><img src="${escapeHtml(s.logoUrl)}" alt="${escapeHtml(s.logoAlt)}" width="${s.logoWidth}" style="width:${s.logoWidth}px;max-width:100%;height:auto;"></td></tr>` +
    `<tr><td style="padding:32px;${FONT}font-size:16px;line-height:26px;color:#3f3f46;">${bodyHtml}</td></tr>` +
    `</tbody></table></td></tr>` +
    `<tr><td style="height:12px;line-height:12px;font-size:1px;background-color:#ffffff;border-radius:0 0 12px 12px;">&nbsp;</td></tr>` +
    footer +
    `</tbody></table></td></tr></tbody></table></body></html>`
  );
}
