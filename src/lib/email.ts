import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL || "REBX <onboarding@resend.dev>";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Reset your REBX password",
    html: `
      <p>Click the link below to reset your REBX password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

export async function sendDeveloperRequestNotification(
  adminEmails: string[],
  details: { companyName: string; contactName: string; listingTitle: string; requestedByName: string; reviewUrl: string }
) {
  if (adminEmails.length === 0) return;
  await resend.emails.send({
    from: FROM,
    to: adminEmails,
    subject: `New developer request: ${details.companyName}`,
    html: `
      <p>${escapeHtml(details.requestedByName)} requested a new developer account while listing
      "${escapeHtml(details.listingTitle)}":</p>
      <p>Company: ${escapeHtml(details.companyName)}<br/>Contact: ${escapeHtml(details.contactName)}</p>
      <p><a href="${details.reviewUrl}">Review this request</a></p>
    `,
  });
}

export async function sendDeveloperWelcomeEmail(
  to: string,
  companyName: string,
  setPasswordUrl: string
) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "You've been added to REBX",
    html: `
      <p>An account for ${escapeHtml(companyName)} has been created on REBX. Click below to set
      your password and log in. This link expires in 7 days.</p>
      <p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
    `,
  });
}

export async function sendWelcomeEmail(to: string, name: string) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: "Welcome to REBX",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your REBX account is ready. Log in any time to get started.</p>
    `,
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
  await resend.emails.send({
    from: FROM,
    to,
    subject: `New inquiry: ${details.listingTitle}`,
    html: `
      <p>You have a new inquiry on "${escapeHtml(details.listingTitle)}":</p>
      <p>
        ${escapeHtml(details.contactName)}<br/>
        ${escapeHtml(details.contactEmail)}${details.contactPhone ? `<br/>${escapeHtml(details.contactPhone)}` : ""}
      </p>
      ${details.message ? `<p>${escapeHtml(details.message)}</p>` : ""}
      <p><a href="${details.dealUrl}">View this lead</a></p>
    `,
  });
}

export async function sendInquiryConfirmation(
  to: string,
  details: { listingTitle: string; agentName: string }
) {
  await resend.emails.send({
    from: FROM,
    to,
    subject: `We received your inquiry on ${details.listingTitle}`,
    html: `
      <p>Thanks for your interest in "${escapeHtml(details.listingTitle)}". ${escapeHtml(details.agentName)}
      has been notified and will be in touch soon.</p>
    `,
  });
}
