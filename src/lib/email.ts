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

export async function sendLeadOptedOutEmail(
  to: string,
  details: {
    agentName: string;
    contactName: string;
    contactEmail: string;
    listingTitle: string;
    dealUrl: string;
    reason?: string | null;
  }
) {
  await sendTemplatedEmail("lead_opted_out", to, {
    agentName: details.agentName,
    contactName: details.contactName,
    contactEmail: details.contactEmail,
    listingTitle: details.listingTitle,
    dealUrl: details.dealUrl,
    reason: details.reason ?? "",
  });
}

export async function sendListingSubmittedEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    listingUrl: string;
  }
) {
  await sendTemplatedEmail("listing_submitted", to, details);
}

export async function sendListingReviewDecisionEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    status: string;
    listingUrl: string;
    reviewNotes?: string | null;
  }
) {
  await sendTemplatedEmail("listing_review_decision", to, {
    agentName: details.agentName,
    listingTitle: details.listingTitle,
    status: details.status,
    listingUrl: details.listingUrl,
    reviewNotes: details.reviewNotes ?? "",
  });
}

export async function sendListingLiveEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    listingUrl: string;
  }
) {
  await sendTemplatedEmail("listing_live", to, details);
}

export async function sendListingExpiresSoonEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    expiresAt: string;
    daysRemaining?: string | null;
    listingUrl: string;
    renewUrl?: string | null;
  }
) {
  await sendTemplatedEmail("listing_expires_soon", to, {
    agentName: details.agentName,
    listingTitle: details.listingTitle,
    expiresAt: details.expiresAt,
    daysRemaining: details.daysRemaining ?? "",
    listingUrl: details.listingUrl,
    renewUrl: details.renewUrl ?? "",
  });
}

export async function sendListingExpiredEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    listingUrl: string;
    renewUrl?: string | null;
  }
) {
  await sendTemplatedEmail("listing_expired", to, {
    agentName: details.agentName,
    listingTitle: details.listingTitle,
    listingUrl: details.listingUrl,
    renewUrl: details.renewUrl ?? "",
  });
}

export async function sendSiteVisitRequestEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    contactName: string;
    contactEmail: string;
    contactPhone?: string | null;
    visitDate?: string | null;
    visitTime?: string | null;
    message?: string | null;
    dealUrl: string;
    listingUrl?: string | null;
  }
) {
  await sendTemplatedEmail("site_visit_request", to, {
    agentName: details.agentName,
    listingTitle: details.listingTitle,
    contactName: details.contactName,
    contactEmail: details.contactEmail,
    contactPhone: details.contactPhone ?? "",
    visitDate: details.visitDate ?? "",
    visitTime: details.visitTime ?? "",
    message: details.message ?? "",
    dealUrl: details.dealUrl,
    listingUrl: details.listingUrl ?? "",
  });
}

export async function sendShowingStatusEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    contactName: string;
    showingStatus: "Confirmed" | "Rescheduled" | "Cancelled" | string;
    updatedBy?: "the client" | "the seller" | string | null;
    visitDate?: string | null;
    visitTime?: string | null;
    reason?: string | null;
    dealUrl: string;
    listingUrl?: string | null;
  }
) {
  await sendTemplatedEmail("showing_status_update", to, {
    agentName: details.agentName,
    listingTitle: details.listingTitle,
    contactName: details.contactName,
    showingStatus: details.showingStatus,
    updatedBy: details.updatedBy ?? "",
    visitDate: details.visitDate ?? "",
    visitTime: details.visitTime ?? "",
    showingReason: details.showingStatus === "Confirmed" ? "" : (details.reason ?? ""),
    dealUrl: details.dealUrl,
    listingUrl: details.listingUrl ?? "",
  });
}

export async function sendShowingConfirmedEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    contactName: string;
    updatedBy?: string | null;
    visitDate?: string | null;
    visitTime?: string | null;
    notes?: string | null;
    dealUrl: string;
    listingUrl?: string | null;
  }
) {
  await sendShowingStatusEmail(to, {
    ...details,
    showingStatus: "Confirmed",
    reason: details.notes,
  });
}

export async function sendShowingRescheduledEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    contactName: string;
    updatedBy?: string | null;
    newDate?: string | null;
    newTime?: string | null;
    reason?: string | null;
    dealUrl: string;
    listingUrl?: string | null;
  }
) {
  await sendShowingStatusEmail(to, {
    ...details,
    showingStatus: "Rescheduled",
    visitDate: details.newDate,
    visitTime: details.newTime,
  });
}

export async function sendShowingCancelledEmail(
  to: string,
  details: {
    agentName: string;
    listingTitle: string;
    contactName: string;
    updatedBy?: string | null;
    reason?: string | null;
    dealUrl: string;
    listingUrl?: string | null;
  }
) {
  await sendShowingStatusEmail(to, {
    ...details,
    showingStatus: "Cancelled",
  });
}

export async function sendDealNewMessageEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    message_preview: string;
    deal_link: string;
  }
) {
  try {
    await sendTemplatedEmail("deal_new_message", to, {
      recipient_name: details.recipient_name,
      sender_name: details.sender_name,
      listing_title: details.listing_title,
      message_preview: details.message_preview,
      deal_link: details.deal_link,
    });
  } catch (err) {
    console.error("Failed to send deal new message email:", err);
  }
}

export async function sendDealNewOfferEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    amount: string;
    message_preview?: string | null;
    deal_link: string;
    expires_at?: string | null;
  }
) {
  try {
    await sendTemplatedEmail("deal_new_offer", to, {
      recipient_name: details.recipient_name,
      recipientName: details.recipient_name,
      sender_name: details.sender_name,
      senderName: details.sender_name,
      listing_title: details.listing_title,
      listingTitle: details.listing_title,
      amount: details.amount,
      offerAmount: details.amount,
      offer_amount: details.amount,
      message_preview: details.message_preview || "",
      message: details.message_preview || "",
      deal_link: details.deal_link,
      dealUrl: details.deal_link,
      expires_at: details.expires_at || "",
      expiresAt: details.expires_at || "",
      offer_expiry: details.expires_at || "",
    });
  } catch (err) {
    console.error("Failed to send deal new offer email:", err);
  }
}

export async function sendDealCounterOfferEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    amount: string;
    message_preview?: string | null;
    deal_link: string;
    expires_at?: string | null;
  }
) {
  try {
    await sendTemplatedEmail("deal_counter_offer", to, {
      recipient_name: details.recipient_name,
      recipientName: details.recipient_name,
      sender_name: details.sender_name,
      senderName: details.sender_name,
      listing_title: details.listing_title,
      listingTitle: details.listing_title,
      amount: details.amount,
      offerAmount: details.amount,
      offer_amount: details.amount,
      message_preview: details.message_preview || "",
      message: details.message_preview || "",
      deal_link: details.deal_link,
      dealUrl: details.deal_link,
      expires_at: details.expires_at || "",
      expiresAt: details.expires_at || "",
      offer_expiry: details.expires_at || "",
    });
  } catch (err) {
    console.error("Failed to send deal counter-offer email:", err);
  }
}

export async function sendDealOfferAcceptedEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    amount: string;
    deal_link: string;
  }
) {
  try {
    await sendTemplatedEmail("deal_offer_accepted", to, {
      recipient_name: details.recipient_name,
      recipientName: details.recipient_name,
      sender_name: details.sender_name,
      senderName: details.sender_name,
      listing_title: details.listing_title,
      listingTitle: details.listing_title,
      amount: details.amount,
      offerAmount: details.amount,
      offer_amount: details.amount,
      deal_link: details.deal_link,
      dealUrl: details.deal_link,
    });
  } catch (err) {
    console.error("Failed to send deal offer accepted email:", err);
  }
}

export async function sendDealOfferRejectedEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    amount: string;
    message_preview?: string | null;
    deal_link: string;
  }
) {
  try {
    await sendTemplatedEmail("deal_offer_rejected", to, {
      recipient_name: details.recipient_name,
      recipientName: details.recipient_name,
      sender_name: details.sender_name,
      senderName: details.sender_name,
      listing_title: details.listing_title,
      listingTitle: details.listing_title,
      amount: details.amount,
      offerAmount: details.amount,
      offer_amount: details.amount,
      message_preview: details.message_preview || "",
      message: details.message_preview || "",
      deal_link: details.deal_link,
      dealUrl: details.deal_link,
    });
  } catch (err) {
    console.error("Failed to send deal offer rejected email:", err);
  }
}

export async function sendDealOfferExpiredEmail(
  to: string,
  details: {
    recipient_name: string;
    sender_name: string;
    listing_title: string;
    amount: string;
    deal_link: string;
  }
) {
  try {
    await sendTemplatedEmail("deal_offer_expired", to, {
      recipient_name: details.recipient_name,
      recipientName: details.recipient_name,
      sender_name: details.sender_name,
      senderName: details.sender_name,
      listing_title: details.listing_title,
      listingTitle: details.listing_title,
      amount: details.amount,
      offerAmount: details.amount,
      offer_amount: details.amount,
      deal_link: details.deal_link,
      dealUrl: details.deal_link,
    });
  } catch (err) {
    console.error("Failed to send deal offer expired email:", err);
  }
}


