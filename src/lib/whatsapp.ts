import "server-only";

// WhatsApp Business Cloud API sender (Meta). Notifications are always sent as pre-approved
// TEMPLATE messages, because business-initiated messages outside a 24-hour customer window are
// not allowed to be free text. Sending never throws: a WhatsApp outage or a bad number must
// never break the inquiry, deal or email that triggered it.
//
// Configuration (environment variables, never committed):
//   WHATSAPP_ACCESS_TOKEN        permanent System User token (whatsapp_business_messaging)
//   WHATSAPP_PHONE_NUMBER_ID     the sending number's Phone number ID (not the phone number)
//   WHATSAPP_API_VERSION         optional, default v25.0
//   WHATSAPP_DEFAULT_COUNTRY_CODE optional, default 91 (for numbers typed without a country code)
//   WHATSAPP_TEMPLATE_NEW_LEAD   optional, default new_lead_alert
//   WHATSAPP_TEMPLATE_LANGUAGE   optional, default en_US

const DEFAULT_API_VERSION = "v25.0";
const SEND_TIMEOUT_MS = 8000;

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/**
 * Turns a number as people type it into the digits-only international format WhatsApp needs
 * (e.g. "+91 98765-43210" or "098765 43210" or "9876543210" -> "919876543210"). Returns null when
 * it can't be a valid number. Numbers without a country code get WHATSAPP_DEFAULT_COUNTRY_CODE.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined, defaultCountryCode = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91"): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!/^\+?[0-9\s().-]+$/.test(value)) return null;

  let digits = value.replace(/\D/g, "");
  if (value.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2); // 00 91 ... international dialling prefix
  } else if (digits.startsWith("0")) {
    digits = defaultCountryCode + digits.slice(1); // national trunk prefix
  } else if (digits.length <= 10) {
    digits = defaultCountryCode + digits; // local number without a country code
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** Template parameters can't be empty, contain line breaks/tabs or runs of spaces, or be huge. */
export function cleanTemplateParam(value: string | null | undefined, max = 120): string {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "-";
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

export type WhatsAppResult =
  | { ok: true; messageId: string | null }
  | { ok: false; skipped?: boolean; error: string };

export async function sendWhatsAppTemplate(
  to: string | null | undefined,
  template: string,
  params: (string | null | undefined)[],
  options: { language?: string } = {}
): Promise<WhatsAppResult> {
  if (!isWhatsAppConfigured()) return { ok: false, skipped: true, error: "WhatsApp is not configured." };

  const number = normalizeWhatsAppNumber(to);
  if (!number) return { ok: false, skipped: true, error: "No valid WhatsApp number." };

  const token = process.env.WHATSAPP_ACCESS_TOKEN!.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!.trim();
  const version = process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION;

  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: number,
        type: "template",
        template: {
          name: template,
          language: { code: options.language || process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
          ...(params.length
            ? { components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: cleanTemplateParam(p) })) }] }
            : {}),
        },
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    const body = (await response.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } }
      | null;

    if (!response.ok || body?.error) {
      const detail = body?.error?.error_data?.details || body?.error?.message || `HTTP ${response.status}`;
      const error = `${detail}${body?.error?.code ? ` (code ${body.error.code})` : ""}`;
      console.error(`WhatsApp template "${template}" was not sent:`, error);
      return { ok: false, error };
    }
    return { ok: true, messageId: body?.messages?.[0]?.id ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`WhatsApp template "${template}" could not be sent:`, message);
    return { ok: false, error: message };
  }
}

/**
 * New-lead alert to a listing's agent. Only sends if the agent switched WhatsApp alerts on
 * (their consent) and saved a phone number. Template body expected by Meta:
 *   "New enquiry on {{1}} from {{2}}. Open it here: {{3}}"
 */
export async function notifyAgentNewLead(
  agent: { phone?: string | null; whatsappOptIn?: boolean | null } | null | undefined,
  details: { listingTitle: string; contactName: string; dealUrl: string }
): Promise<WhatsAppResult> {
  if (!agent?.whatsappOptIn) return { ok: false, skipped: true, error: "Agent has not opted in to WhatsApp alerts." };
  return sendWhatsAppTemplate(agent.phone, process.env.WHATSAPP_TEMPLATE_NEW_LEAD?.trim() || "new_lead_alert", [
    cleanTemplateParam(details.listingTitle, 80),
    cleanTemplateParam(details.contactName, 60),
    details.dealUrl,
  ]);
}
