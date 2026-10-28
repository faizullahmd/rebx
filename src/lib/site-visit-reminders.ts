import { prisma } from "@/lib/prisma";
import { deliver, type OutgoingEmail } from "@/lib/email/transport";
import { getGoogleMapsDirectionsUrl, formatDisplayAddress } from "@/lib/maps";
import {
  sendSiteVisitReminder24hAgentEmail,
  sendSiteVisitReminder1hAgentEmail,
} from "@/lib/email";

export interface ReminderProcessingResult {
  success: boolean;
  totalEvaluated: number;
  reminders24hSent: number;
  reminders1hSent: number;
  skipped: number;
  errors: Array<{ siteVisitId: number; error: string }>;
}

/**
 * Verifies cron request authentication across Bearer authorization, x-cron-secret header, or query parameter.
 */
export function verifyCronAuthHeaders(params: {
  authHeader?: string | null;
  cronHeader?: string | null;
  querySecret?: string | null;
  configuredSecret?: string;
  isProduction?: boolean;
}): boolean {
  const { authHeader, cronHeader, querySecret, configuredSecret, isProduction = false } = params;

  if (!configuredSecret && !isProduction) {
    return true;
  }

  if (!configuredSecret) {
    return false;
  }

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === configuredSecret) return true;
  }

  if (cronHeader && cronHeader === configuredSecret) {
    return true;
  }

  if (querySecret && querySecret === configuredSecret) {
    return true;
  }

  return false;
}

/**
 * Combines an appointment date and time slot (e.g. "10:00 AM - 11:00 AM")
 * into a single Date object representing the appointment start time.
 */
export function parseAppointmentStartDateTime(date: Date | string, timeSlot: string): Date {
  const d = new Date(date);
  const startPart = timeSlot.split("-")[0]?.trim(); // "10:00 AM"

  let hours = 10;
  let minutes = 0;

  if (startPart) {
    const match = startPart.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const meridian = match[3].toUpperCase();
      if (meridian === "PM" && h < 12) h += 12;
      if (meridian === "AM" && h === 12) h = 0;
      hours = h;
      minutes = m;
    }
  }

  // Use the appointment's calendar year, month, date in local application time
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hours, minutes, 0, 0);
}

/**
 * Builds HTML template for site visit reminder emails.
 */
export function buildReminderEmailHtml(params: {
  recipientName: string;
  recipientRole: "Customer" | "Agent";
  listingTitle: string;
  addressString: string;
  directionsUrl: string | null;
  formattedDate: string;
  timeSlot: string;
  visitType: string;
  dealUrl: string;
  counterpartName: string;
  counterpartRole: "Agent" | "Client";
  is24h: boolean;
}): string {
  const timeframeLabel = params.is24h ? "tomorrow" : "in approximately 1 hour";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Site Visit Reminder</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 24px; color: #111827;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="background-color: #0f172a; padding: 20px 24px; text-align: left;">
      <span style="color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: -0.5px;">REBX</span>
    </div>

    <div style="padding: 28px 24px;">
      <div style="display: inline-block; padding: 4px 10px; background-color: #ecfdf5; color: #065f46; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 6px; letter-spacing: 0.5px; margin-bottom: 12px;">
        Appointment Reminder
      </div>

      <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 12px 0;">
        Your site visit is scheduled ${timeframeLabel}
      </h2>

      <p style="font-size: 14px; color: #4b5563; line-height: 1.5; margin: 0 0 20px 0;">
        Hello ${params.recipientName}, this is a reminder regarding your upcoming confirmed ${params.visitType.toLowerCase()} for <strong>${params.listingTitle}</strong>.
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <div style="margin-bottom: 10px;">
          <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Date & Time</span><br>
          <strong style="font-size: 15px; color: #0f172a;">${params.formattedDate} at ${params.timeSlot}</strong>
        </div>

        <div style="margin-bottom: 10px;">
          <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">Property</span><br>
          <span style="font-size: 14px; color: #1e293b; font-weight: 600;">${params.listingTitle}</span><br>
          ${params.addressString ? `<span style="font-size: 13px; color: #64748b;">📍 ${params.addressString}</span>` : ""}
        </div>

        <div>
          <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600;">${params.counterpartRole}</span><br>
          <span style="font-size: 13px; color: #1e293b;">${params.counterpartName}</span>
        </div>
      </div>

      <div style="margin-bottom: 20px;">
        <a href="${params.dealUrl}" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-right: 10px; margin-bottom: 8px;">
          View Appointment & Chat →
        </a>

        ${
          params.directionsUrl
            ? `<a href="${params.directionsUrl}" style="display: inline-block; background-color: #ffffff; color: #2563eb; border: 1px solid #bfdbfe; text-decoration: none; padding: 12px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 8px;">
                🗺️ Get Directions on Google Maps
              </a>`
            : ""
        }
      </div>

      <p style="font-size: 12px; color: #9ca3af; line-height: 1.4; margin: 0;">
        If you need to reschedule or have any questions, please communicate directly via the REBX deal conversation.
      </p>
    </div>

    <div style="background-color: #f8fafc; border-top: 1px solid #e5e7eb; padding: 14px 24px; text-align: center; font-size: 11px; color: #9ca3af;">
      © ${new Date().getFullYear()} REBX. All rights reserved.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Scans upcoming CONFIRMED site visits, evaluates whether they need a 24h or 1h reminder,
 * sends in-app notifications and email reminders, and records delivery timestamps idempotently.
 */
export async function processSiteVisitReminders(options?: {
  now?: Date;
  siteBaseUrl?: string;
}): Promise<ReminderProcessingResult> {
  const now = options?.now || new Date();
  const siteUrl = options?.siteBaseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";

  const result: ReminderProcessingResult = {
    success: true,
    totalEvaluated: 0,
    reminders24hSent: 0,
    reminders1hSent: 0,
    skipped: 0,
    errors: [],
  };

  // Query only CONFIRMED visits where either the 24h or 1h reminder has not yet been sent
  const eligibleVisits = await prisma.siteVisit.findMany({
    where: {
      status: "CONFIRMED",
      OR: [
        { reminded24hAt: null },
        { reminded1hAt: null },
      ],
    },
    include: {
      deal: {
        select: {
          id: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          addressLine: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  result.totalEvaluated = eligibleVisits.length;

  for (const visit of eligibleVisits) {
    try {
      const apptStart = parseAppointmentStartDateTime(visit.date, visit.timeSlot);
      const diffMs = apptStart.getTime() - now.getTime();

      // Guard: do not send reminders for visits whose appointment start has already passed
      if (diffMs <= 0) {
        result.skipped++;
        continue;
      }

      const diffHours = diffMs / (1000 * 60 * 60);

      // Determine reminder type needed:
      // 1. 24h reminder: between 2 hours and 26 hours away, and not yet sent
      const needs24h = visit.reminded24hAt === null && diffHours > 2 && diffHours <= 26;

      // 2. 1h reminder: between 0 and 2 hours away, and not yet sent
      const needs1h = visit.reminded1hAt === null && diffHours > 0 && diffHours <= 2;

      console.log(`[Reminder Evaluation] Visit #${visit.id} (status=${visit.status}, date=${visit.date.toISOString()}, slot=${visit.timeSlot}): apptStart=${apptStart.toISOString()} (${apptStart.toString()}), now=${now.toISOString()} (${now.toString()}), diffMs=${diffMs}, diffHours=${diffHours.toFixed(2)}, needs24h=${needs24h}, needs1h=${needs1h}`);

      if (!needs24h && !needs1h) {
        result.skipped++;
        continue;
      }

      const is24h = needs24h;
      const timeframeText = is24h ? "tomorrow" : "in approximately 1 hour";

      const formattedDate = new Intl.DateTimeFormat("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(apptStart);

      const addressString = formatDisplayAddress(visit.listing);
      const directionsUrl = getGoogleMapsDirectionsUrl(visit.listing);
      const visitTypeLabel = visit.visitType === "VIRTUAL" ? "Virtual Tour" : "In-Person Visit";

      const customerEmail = visit.deal.contactEmail || visit.customer.email;
      const customerName = visit.deal.contactName || visit.customer.name || "Client";
      const agentEmail = visit.agent.email;
      const agentName = visit.agent.name || "Agent";

      const customerDealUrl = `${siteUrl}/customer/dashboard/chat/${visit.dealId}`;
      const agentDealUrl = `${siteUrl}/agent/dashboard/deals/${visit.dealId}`;

      // In-app thread message:
      const threadEventText = `⏰ Site Visit Reminder: Confirmed ${visitTypeLabel.toLowerCase()} for ${
        visit.listing.title
      } is scheduled ${timeframeText} on ${formattedDate} at ${visit.timeSlot}.${
        directionsUrl && visit.visitType === "IN_PERSON" ? ` Directions: ${directionsUrl}` : ""
      }`;

      // Send Customer Email
      const customerEmailHtml = buildReminderEmailHtml({
        recipientName: customerName,
        recipientRole: "Customer",
        listingTitle: visit.listing.title,
        addressString,
        directionsUrl,
        formattedDate,
        timeSlot: visit.timeSlot,
        visitType: visitTypeLabel,
        dealUrl: customerDealUrl,
        counterpartName: agentName,
        counterpartRole: "Agent",
        is24h,
      });

      const fromAddress = process.env.RESEND_FROM_EMAIL || "REBX <noreply@notify.rebx.app>";

      // Attempt email delivery if configured
      if (process.env.RESEND_API_KEY) {
        // 1. Send Customer Reminder Email
        if (customerEmail) {
          await deliver({
            from: fromAddress,
            to: customerEmail,
            subject: `Reminder: Site visit for ${visit.listing.title} is scheduled ${timeframeText} (${visit.timeSlot})`,
            html: customerEmailHtml,
          }).catch((err) => console.error(`[Reminder Email Error - Customer ${customerEmail}]:`, err));
        }

        // 2. Send Agent Reminder Email using new email templates
        if (agentEmail) {
          const agentEmailData = {
            agentName,
            listingTitle: visit.listing.title,
            propertyAddress: addressString,
            visitDate: formattedDate,
            timeSlot: visit.timeSlot,
            visitType: visitTypeLabel,
            clientName: customerName,
            clientEmail: customerEmail,
            clientPhone: visit.deal.contactPhone || null,
            dealUrl: agentDealUrl,
            directionsUrl,
          };

          if (is24h) {
            await sendSiteVisitReminder24hAgentEmail(agentEmail, agentEmailData);
          } else {
            await sendSiteVisitReminder1hAgentEmail(agentEmail, agentEmailData);
          }
        }
      }

      // Record in database inside transaction to enforce strict idempotency
      await prisma.$transaction(async (tx) => {
        await tx.siteVisit.update({
          where: { id: visit.id },
          data: {
            ...(is24h ? { reminded24hAt: now } : { reminded1hAt: now }),
          },
        });

        // Add in-app event notification in deal conversation
        await tx.dealMessage.create({
          data: {
            dealId: visit.dealId,
            senderRole: "SYSTEM",
            type: "EVENT",
            text: threadEventText,
          },
        });
      });

      if (is24h) {
        result.reminders24hSent++;
      } else {
        result.reminders1hSent++;
      }
    } catch (err) {
      console.error(`Error processing reminder for site visit ID ${visit.id}:`, err);
      result.errors.push({
        siteVisitId: visit.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
