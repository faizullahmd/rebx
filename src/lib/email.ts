import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM_EMAIL || "REBX <onboarding@resend.dev>";

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
      <p>${details.requestedByName} requested a new developer account while listing
      "${details.listingTitle}":</p>
      <p>Company: ${details.companyName}<br/>Contact: ${details.contactName}</p>
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
      <p>An account for ${companyName} has been created on REBX. Click below to set your
      password and log in. This link expires in 7 days.</p>
      <p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
    `,
  });
}
