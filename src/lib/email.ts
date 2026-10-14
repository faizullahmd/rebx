import "server-only";
import { BUILT_IN_BY_KEY } from "@/lib/email/definitions";
import { builtInTemplate, loadLiveTemplate, type LiveTemplate } from "@/lib/email/live";
import { getLatestPropertiesHtml } from "@/lib/email/latest-properties";
import { renderParts } from "@/lib/email/pipeline";
import { TemplateRenderError, type TemplateData } from "@/lib/email/render";
import { buildFromHeader, parseEmailList } from "@/lib/email/sender";
import { deliver, type OutgoingEmail } from "@/lib/email/transport";

// Every transactional email goes through sendTemplatedEmail: it loads the PUBLISHED template
// (editable in Admin > Email templates), renders it with the shared engine, and sends via
// Resend. The exported send* functions keep their original signatures, so callers don't change.

function buildPayload(
  template: LiveTemplate,
  key: string,
  to: string | string[],
  data: TemplateData
): OutgoingEmail {
  const rendered = renderParts(key, template, data, "strict");
  const payload: OutgoingEmail = {
    from: buildFromHeader(template),
    to,
    subject: rendered.subject,
    html: rendered.html,
  };
  if (rendered.text) payload.text = rendered.text;
  if (template.replyTo) payload.replyTo = template.replyTo;
  const cc = parseEmailList(template.cc);
  const bcc = parseEmailList(template.bcc);
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  return payload;
}

async function sendTemplatedEmail(key: string, to: string | string[], data: TemplateData) {
  if (!BUILT_IN_BY_KEY[key]) throw new Error(`Unknown email template "${key}".`);

  const live = await loadLiveTemplate(key);
  if (!live) throw new Error(`Email template "${key}" is unavailable.`);
  if (!live.active) {
    console.info(`Email template "${key}" is deactivated in the admin panel; not sending.`);
    return;
  }

  let payload: OutgoingEmail;
  try {
    payload = buildPayload(live, key, to, data);
  } catch (error) {
    // A published template that no longer renders (bad variable, missing value) must not
    // silently produce a broken email or stop it: log loudly and use the known-good default.
    if (live.source === "database" && error instanceof TemplateRenderError) {
      console.error(`Published email template "${key}" failed to render, using built-in default:`, error.message);
      payload = buildPayload(builtInTemplate(key)!, key, to, data);
    } else {
      throw error;
    }
  }

  await deliver(payload);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await sendTemplatedEmail("password_reset", to, { resetUrl });
}

export async function sendDeveloperRequestNotification(
  adminEmails: string[],
  details: { companyName: string; contactName: string; listingTitle: string; requestedByName: string; reviewUrl: string }
) {
  if (adminEmails.length === 0) return;
  await sendTemplatedEmail("developer_request_notification", adminEmails, details);
}

export async function sendDeveloperWelcomeEmail(
  to: string,
  companyName: string,
  setPasswordUrl: string
) {
  await sendTemplatedEmail("developer_welcome", to, { companyName, setPasswordUrl });
}

export async function sendWelcomeEmail(to: string, name: string, siteUrl: string) {
  const base = siteUrl.replace(/\/+$/, "");
  await sendTemplatedEmail("welcome", to, {
    name,
    listingsUrl: `${base}/listings`,
    dashboardUrl: `${base}/dashboard`,
    latestProperties: await getLatestPropertiesHtml(base),
  });
}

export async function sendNewLeadNotification(
  to: string,
  details: {
    listingTitle: string;
    contactName: string;
    contactEmail: string;
    contactPhone?: string | null;
    message?: string | null;
    dealUrl: string;
  }
) {
  await sendTemplatedEmail("new_lead", to, {
    listingTitle: details.listingTitle,
    contactName: details.contactName,
    contactEmail: details.contactEmail,
    contactPhone: details.contactPhone ?? "",
    message: details.message ?? "",
    dealUrl: details.dealUrl,
  });
}

export async function sendInquiryConfirmation(
  to: string,
  details: { listingTitle: string; agentName: string }
) {
  await sendTemplatedEmail("inquiry_confirmation", to, details);
}

export async function sendBookingConfirmationNeededEmail(
  to: string,
  details: { listingTitle: string; agentName: string; saleAmount: number; bookingUrl: string }
) {
  await sendTemplatedEmail("booking_confirmation_needed", to, {
    listingTitle: details.listingTitle,
    agentName: details.agentName,
    saleAmount: details.saleAmount.toLocaleString("en-US"),
    bookingUrl: details.bookingUrl,
  });
}

export async function sendBookingConfirmedEmail(
  to: string,
  details: { listingTitle: string; developerCompanyName: string; bookingUrl: string }
) {
  await sendTemplatedEmail("booking_confirmed", to, details);
}

export async function sendCommissionPaidOutEmail(
  to: string,
  details: { listingTitle: string; amount: number; source: string; dealUrl: string }
) {
  await sendTemplatedEmail("commission_paid_out", to, {
    listingTitle: details.listingTitle,
    amount: details.amount.toLocaleString("en-US"),
    source: details.source.toLowerCase(),
    dealUrl: details.dealUrl,
  });
}
