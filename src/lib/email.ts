import "server-only";
import { BUILT_IN_BY_KEY } from "@/lib/email/definitions";
import { builtInTemplate, loadLiveTemplate, type LiveTemplate } from "@/lib/email/live";
import { composeEmail, type LayoutSettings } from "@/lib/email/layout";
import { loadLiveLayout } from "@/lib/email/layout-service";
import { getLatestListingsBlockHtml, getLatestPropertiesHtml, siteBaseFrom } from "@/lib/email/latest-properties";
import { renderParts } from "@/lib/email/pipeline";
import { TemplateRenderError, type TemplateData } from "@/lib/email/render";
import { buildFromHeader, parseEmailList } from "@/lib/email/sender";
import { deliver, type OutgoingEmail } from "@/lib/email/transport";

// Every transactional email goes through sendTemplatedEmail: it loads the PUBLISHED template
// (editable in Admin > Email templates), renders it with the shared engine, and sends via
// Resend. The body is placed inside the shared layout (Admin > Email layout). The exported
// send* functions keep their original signatures, so callers don't change.

function buildPayload(
  template: LiveTemplate,
  key: string,
  to: string | string[],
  data: TemplateData,
  layout: LayoutSettings
): OutgoingEmail {
  const rendered = renderParts(key, template, data, "strict");
  const payload: OutgoingEmail = {
    from: buildFromHeader(template),
    to,
    subject: rendered.subject,
    // Every email, including ones from templates created later, goes through the shared layout.
    html: composeEmail(rendered.html, layout, { subject: rendered.subject }),
  };
  if (rendered.text) payload.text = rendered.text;
  if (template.replyTo) payload.replyTo = template.replyTo;
  const cc = parseEmailList(template.cc);
  const bcc = parseEmailList(template.bcc);
  if (cc.length) payload.cc = cc;
  if (bcc.length) payload.bcc = bcc;
  return payload;
}

async function withAutomaticBlocks(template: { subject: string; htmlBody: string; textBody?: string | null }, data: TemplateData): Promise<TemplateData> {
  if (data.latestListings) return data;
  const source = `${template.subject}\n${template.htmlBody}\n${template.textBody ?? ""}`;
  if (!/\{\{\s*(#if\s+)?latestListings\s*\}\}/.test(source)) return data;
  return { ...data, latestListings: await getLatestListingsBlockHtml(siteBaseFrom(data)) };
}

async function sendTemplatedEmail(key: string, to: string | string[], data: TemplateData) {
  if (!BUILT_IN_BY_KEY[key]) throw new Error(`Unknown email template "${key}".`);

  const live = await loadLiveTemplate(key);
  if (!live) throw new Error(`Email template "${key}" is unavailable.`);
  if (!live.active) {
    console.info(`Email template "${key}" is deactivated in the admin panel; not sending.`);
    return;
  }

  // Automatic blocks (e.g. {{latestListings}}) work in every template, but their database
  // lookup only runs when the template actually uses one.
  data = await withAutomaticBlocks(live, data);

  const layout = await loadLiveLayout();
  let payload: OutgoingEmail;
  try {
    payload = buildPayload(live, key, to, data, layout);
  } catch (error) {
    // A published template that no longer renders (bad variable, missing value) must not
    // silently produce a broken email or stop it: log loudly and use the known-good default.
    if (live.source === "database" && error instanceof TemplateRenderError) {
      console.error(`Published email template "${key}" failed to render, using built-in default:`, error.message);
      payload = buildPayload(builtInTemplate(key)!, key, to, data, layout);
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
