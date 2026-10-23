// Single source of truth for the built-in (system) email templates and the dynamic variables
// they can use. Pure data, no server-only imports, so the admin editor can use it too.
//
import { SAMPLE_PROPERTY_CARDS, latestListingsBlockHtml, propertyCardsHtml } from "@/lib/email/blocks";

// Variable names deliberately match the camelCase fields the existing email functions in
// src/lib/email.ts already receive (listingTitle, dealUrl, ...). Nothing here invents a
// backend variable: each one is supplied by the calling code listed in `usedBy`.

/**
 * "html" variables carry markup built by server code (e.g. property cards). They are inserted
 * unescaped but are always sanitized first, and are never editable in sample data.
 */
export type VariableType = "text" | "url" | "email" | "html";

export interface VariableDefinition {
  name: string;
  label: string;
  description: string;
  group: string;
  type: VariableType;
  /** Realistic value used by previews and test emails. URLs point at example.com on purpose. */
  sample: string;
}

export interface TemplateVariableRef {
  name: string;
  /** Always supplied by the system for this template. A render fails loudly if it's missing. */
  required: boolean;
  /** The body must contain this placeholder (e.g. the reset link), otherwise saving is blocked. */
  mustAppear?: boolean;
}

export interface TemplateDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  /** Event/trigger identifier: where in the app this email is sent from. */
  event: string;
  recipient: string;
  /** Critical emails can't be deactivated (e.g. password reset would break account recovery). */
  critical: boolean;
  variables: TemplateVariableRef[];
  subject: string;
  html: string;
}

export const EMAIL_CATEGORIES = [
  "Account",
  "Listings",
  "Leads & inquiries",
  "Deals & bookings",
  "Commissions",
  "Developers",
  "Custom",
] as const;

export const VARIABLE_GROUPS = ["People", "Property", "Lead", "Money", "Company", "Links"] as const;

const v = (
  name: string,
  group: (typeof VARIABLE_GROUPS)[number],
  type: VariableType,
  label: string,
  description: string,
  sample: string
): VariableDefinition => ({ name, group, type, label, description, sample });

export const VARIABLES: Record<string, VariableDefinition> = Object.fromEntries(
  [
    v("name", "People", "text", "Recipient name", "Full name of the person receiving the email.", "Casey Customer"),
    v("agentName", "People", "text", "Agent name", "Name of the listing agent.", "Alex Agent"),
    v("requestedByName", "People", "text", "Requested by", "Agent who requested a new developer account.", "Alex Agent"),
    v("contactName", "People", "text", "Contact name", "Name of the contact person (the inquirer on a lead, or the developer's contact on a developer request).", "Taylor Prospect"),
    v("listingTitle", "Property", "text", "Listing title", "Title of the property listing the email is about.", "Lakeside Family Home"),
    v("latestProperties", "Property", "html", "Latest properties", "Ready-made cards for the newest active listings (image, title, location, price, link). Empty when there are no active listings, so wrap it in a conditional block.", propertyCardsHtml(SAMPLE_PROPERTY_CARDS)),
    v("latestListings", "Property", "html", "Latest listings block", "Heading, the newest active listings as cards, and a \"Browse all properties\" button linking to the listings page. Works in every template, anywhere in the body. Left out automatically when there are no active listings.", latestListingsBlockHtml(SAMPLE_PROPERTY_CARDS, "https://example.com/sample/listings")),
    v("contactEmail", "Lead", "email", "Contact email", "Email address the inquirer provided.", "taylor.prospect@example.com"),
    v("contactPhone", "Lead", "text", "Contact phone", "Phone number the inquirer provided. Often empty, so wrap it in a conditional block.", "+1 555 0101"),
    v("message", "Lead", "text", "Inquiry message", "Free-text message the inquirer wrote. Often empty, so wrap it in a conditional block.", "Is this still available? I'd love a weekend viewing."),
    v("visitDate", "Lead", "text", "Site visit date", "Preferred date for the requested in-person site visit.", "October 25, 2026"),
    v("visitTime", "Lead", "text", "Site visit time", "Preferred time slot for the requested in-person site visit.", "10:30 AM"),
    v("showingStatus", "Lead", "text", "Showing status", "Current status of the showing (Confirmed, Rescheduled, or Cancelled).", "Rescheduled"),
    v("updatedBy", "People", "text", "Updated by", "The party who requested or made the change (the client or seller).", "the client"),
    v("showingReason", "Lead", "text", "Showing reason / notes", "Reason or details for rescheduling or cancelling the showing.", "Client requested a later time slot due to a scheduling conflict."),
    v("reason", "Lead", "text", "Opt-out reason", "Reason the lead unsubscribed or opted out.", "Customer requested to stop receiving communications."),
    v("saleAmount", "Money", "text", "Sale amount", "Recorded sale amount, already formatted with thousands separators.", "512,000"),
    v("amount", "Money", "text", "Commission amount", "Commission amount, already formatted with thousands separators.", "15,360"),
    v("source", "Money", "text", "Commission source", "Where the commission comes from, in lower case (developer or customer).", "developer"),
    v("companyName", "Company", "text", "Developer company", "Name of the developer company.", "Northgate Developments"),
    v("developerCompanyName", "Company", "text", "Developer company", "Name of the developer company that confirmed the booking.", "Northgate Developments"),
    v("resetUrl", "Links", "url", "Password reset link", "One-time link to reset a password (valid for 1 hour).", "https://example.com/sample/reset-password/SAMPLE-TOKEN"),
    v("setPasswordUrl", "Links", "url", "Set-password link", "One-time link for a new developer to set their password (valid for 7 days).", "https://example.com/sample/set-password/SAMPLE-TOKEN"),
    v("reviewUrl", "Links", "url", "Review link", "Admin page where a developer request is reviewed.", "https://example.com/sample/admin/developer-requests"),
    v("dealUrl", "Links", "url", "Deal link", "Link to the deal or lead in the agent dashboard.", "https://example.com/sample/deals/42"),
    v("bookingUrl", "Links", "url", "Booking link", "Link to the booking to review or view.", "https://example.com/sample/bookings/42"),
    v("status", "Property", "text", "Review status", "Review outcome for the listing: Approved or Rejected.", "Approved"),
    v("reviewNotes", "Property", "text", "Review notes", "Feedback or notes provided by the admin reviewer. Often empty, so wrap it in a conditional block.", "All property details and images have been verified."),
    v("daysRemaining", "Property", "text", "Days remaining", "Number of days before the listing expires.", "7 days"),
    v("expiresAt", "Property", "text", "Expiration date", "Formatted date when the listing expires.", "November 15, 2026"),
    v("listingUrl", "Links", "url", "Listing link", "Direct link to view or manage the listing.", "https://example.com/listings/sample-listing"),
    v("renewUrl", "Links", "url", "Renew listing link", "Link for the agent to extend or renew the listing.", "https://example.com/agent/dashboard/listings/42/renew"),
    v("listingsUrl", "Links", "url", "Browse listings link", "Link to the public property listings page.", "https://example.com/listings"),
    v("dashboardUrl", "Links", "url", "Dashboard link", "Link to the recipient's dashboard (sends them to the right one for their role).", "https://example.com/sample/dashboard"),
    v("recipient_name", "People", "text", "Recipient name", "Name of the person receiving the notification.", "Alex Agent"),
    v("sender_name", "People", "text", "Sender name", "Name of the person who sent the message or offer.", "Taylor Prospect"),
    v("listing_title", "Property", "text", "Listing title", "Title of the property listing.", "Lakeside Family Home"),
    v("message_preview", "Lead", "text", "Message preview", "Snippet or preview of the message sent.", "I have submitted a revised offer of 52 Lakh."),
    v("deal_link", "Links", "url", "Deal conversation link", "Direct link to the negotiation thread.", "https://example.com/sample/deals/42"),
    v("offerAmount", "Money", "text", "Offer amount", "Formatted offer or counter-offer amount.", "₹ 52,00,000"),
    v("offer_amount", "Money", "text", "Offer amount", "Formatted offer or counter-offer amount.", "₹ 52,00,000"),
    v("expires_at", "Property", "text", "Offer expiration", "Formatted expiration date and time for the offer.", "October 24, 2026, 6:00 PM"),
    v("offer_expiry", "Property", "text", "Offer expiration", "Formatted expiration date and time for the offer.", "October 24, 2026, 6:00 PM"),
  ].map((d) => [d.name, d])
);

// Welcome email BODY. The logo header, card and footer come from the shared layout
// (Admin > Email layout), so this is only the message: greeting, copy, a "get started" button,
// the newest properties and a "browse" button. Inline styles + tables for email-client support.
const F = "font-family:Arial,Helvetica,sans-serif;";
const WELCOME_HTML = `<h1 style="margin:0 0 6px 0;font-size:26px;line-height:34px;color:#18181b;">Welcome to Rebx, {{name}}!</h1>
<p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:#71717a;">Real Estate Brokerage Exchange</p>
<p style="margin:0 0 16px 0;">We're excited to have you join our growing real estate network.</p>
<p style="margin:0 0 24px 0;">Rebx brings real estate professionals together on one platform to discover opportunities, connect with the right people, manage property leads, and grow their business.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;"><tbody><tr><td style="padding:20px 22px;${F}font-size:15px;line-height:23px;color:#3f3f46;">
<p style="margin:0 0 14px 0;font-size:16px;font-weight:bold;color:#18181b;">Here's what you can do with Rebx</p>
<p style="margin:0 0 12px 0;"><strong style="color:#18181b;">Discover Properties</strong><br>Explore real estate opportunities across residential and commercial markets.</p>
<p style="margin:0 0 12px 0;"><strong style="color:#18181b;">Connect with Brokers &amp; Agents</strong><br>Build valuable professional relationships and expand your network.</p>
<p style="margin:0 0 12px 0;"><strong style="color:#18181b;">Manage Leads</strong><br>Organize enquiries and track potential clients and property opportunities.</p>
<p style="margin:0 0 12px 0;"><strong style="color:#18181b;">Collaborate on Deals</strong><br>Connect with other real estate professionals to explore partnerships and facilitate transactions.</p>
<p style="margin:0;"><strong style="color:#18181b;">Track Commissions</strong><br>Keep track of eligible deals, brokerage arrangements, and commissions through the platform, where supported.</p>
</td></tr></tbody></table>
<p style="margin:0 0 8px 0;font-size:18px;font-weight:bold;color:#18181b;">Ready to get started?</p>
<p style="margin:0 0 20px 0;">Complete your profile and start exploring opportunities on Rebx today.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px 0;"><tbody><tr><td style="background-color:#111827;border-radius:8px;"><a href="{{dashboardUrl}}" style="display:inline-block;padding:14px 28px;${F}font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Get started on Rebx</a></td></tr></tbody></table>
{{#if latestProperties}}<hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 24px 0;"><h2 style="margin:0 0 4px 0;font-size:20px;line-height:28px;color:#18181b;">Latest properties</h2><p style="margin:0 0 18px 0;font-size:14px;line-height:20px;color:#71717a;">Fresh listings from the Rebx network.</p>{{latestProperties}}{{/if}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 28px 0;"><tbody><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0"><tbody><tr><td style="background-color:#16a34a;border-radius:8px;"><a href="{{listingsUrl}}" style="display:inline-block;padding:14px 32px;${F}font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Browse properties</a></td></tr></tbody></table></td></tr></tbody></table>
<hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 20px 0;">
<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#52525b;">We're glad you're here. Whether you're an independent agent, a real estate broker, or part of a growing agency, Rebx is built to help you make meaningful connections and unlock new opportunities.</p>
<p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#52525b;">If you need any assistance, our support team is happy to help. Just reply to this email.</p>
<p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#52525b;">Here's to building better connections and closing more deals together!</p>
<p style="margin:0;font-size:14px;line-height:22px;color:#52525b;">Best regards,<br><strong style="color:#18181b;">The Rebx Team</strong></p>`;

// The whitespace inside these strings is intentional: it reproduces the exact HTML the
// hardcoded emails sent before templates became editable (verified by the golden-fixture
// regression test), so existing production emails don't change when this module ships.
export const BUILT_IN_TEMPLATES: TemplateDefinition[] = [
  {
    key: "password_reset",
    name: "Password reset",
    description: "Sent when someone requests a password reset. Contains the one-time reset link.",
    category: "Account",
    event: "auth.password_reset_requested",
    recipient: "The user who requested the reset",
    critical: true,
    variables: [{ name: "resetUrl", required: true, mustAppear: true }],
    subject: "Reset your REBX password",
    html: `
      <p>Click the link below to reset your REBX password. This link expires in 1 hour.</p>
      <p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  },
  {
    key: "welcome",
    name: "Welcome email",
    description: "Sent right after a new account signs up (agent, customer or developer).",
    category: "Account",
    event: "auth.signup_completed",
    recipient: "The new user",
    critical: false,
    variables: [
      { name: "name", required: true },
      { name: "listingsUrl", required: true },
      { name: "dashboardUrl", required: true },
      { name: "latestProperties", required: false },
    ],
    subject: "Welcome to REBX",
    html: WELCOME_HTML,
  },
  {
    key: "developer_welcome",
    name: "Developer account created",
    description: "Sent to a developer whose account an admin approved. Contains the set-password link.",
    category: "Developers",
    event: "developer.account_created",
    recipient: "The newly created developer",
    critical: true,
    variables: [
      { name: "companyName", required: true },
      { name: "setPasswordUrl", required: true, mustAppear: true },
    ],
    subject: "You've been added to REBX",
    html: `
      <p>An account for {{companyName}} has been created on REBX. Click below to set
      your password and log in. This link expires in 7 days.</p>
      <p><a href="{{setPasswordUrl}}">{{setPasswordUrl}}</a></p>
    `,
  },
  {
    key: "developer_request_notification",
    name: "New developer request (admins)",
    description: "Sent to every admin when an agent requests a new developer account.",
    category: "Developers",
    event: "developer.request_created",
    recipient: "All admins",
    critical: false,
    variables: [
      { name: "requestedByName", required: true },
      { name: "listingTitle", required: true },
      { name: "companyName", required: true },
      { name: "contactName", required: true },
      { name: "reviewUrl", required: true },
    ],
    subject: "New developer request: {{companyName}}",
    html: `
      <p>{{requestedByName}} requested a new developer account while listing
      "{{listingTitle}}":</p>
      <p>Company: {{companyName}}<br/>Contact: {{contactName}}</p>
      <p><a href="{{reviewUrl}}">Review this request</a></p>
    `,
  },
  {
    key: "new_lead",
    name: "New inquiry (agent)",
    description: "Sent to a listing's agent when someone submits an inquiry.",
    category: "Leads & inquiries",
    event: "lead.created",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "listingTitle", required: true },
      { name: "contactName", required: true },
      { name: "contactEmail", required: true },
      { name: "contactPhone", required: false },
      { name: "message", required: false },
      { name: "dealUrl", required: true },
    ],
    subject: "New inquiry: {{listingTitle}}",
    html: `
      <p>You have a new inquiry on "{{listingTitle}}":</p>
      <p>
        {{contactName}}<br/>
        {{contactEmail}}{{#if contactPhone}}<br/>{{contactPhone}}{{/if}}
      </p>
      {{#if message}}<p>{{message}}</p>{{/if}}
      <p><a href="{{dealUrl}}">View this lead</a></p>
    `,
  },
  {
    key: "inquiry_confirmation",
    name: "Inquiry received (customer)",
    description: "Confirmation sent to the person who submitted an inquiry.",
    category: "Leads & inquiries",
    event: "lead.confirmation",
    recipient: "The person who made the inquiry",
    critical: false,
    variables: [
      { name: "listingTitle", required: true },
      { name: "agentName", required: true },
    ],
    subject: "We received your inquiry on {{listingTitle}}",
    html: `
      <p>Thanks for your interest in "{{listingTitle}}". {{agentName}}
      has been notified and will be in touch soon.</p>
    `,
  },
  {
    key: "booking_confirmation_needed",
    name: "Booking awaiting confirmation (developer)",
    description: "Sent to the developer when an agent closes a deal and records a booking.",
    category: "Deals & bookings",
    event: "booking.confirmation_needed",
    recipient: "The listing's developer",
    critical: false,
    variables: [
      { name: "listingTitle", required: true },
      { name: "agentName", required: true },
      { name: "saleAmount", required: true },
      { name: "bookingUrl", required: true },
    ],
    subject: "Booking awaiting your confirmation: {{listingTitle}}",
    html: `
      <p>{{agentName}} closed a deal on "{{listingTitle}}"
      for {{saleAmount}} and recorded a booking. Please confirm it
      so the agent can log their commission.</p>
      <p><a href="{{bookingUrl}}">Review this booking</a></p>
    `,
  },
  {
    key: "booking_confirmed",
    name: "Booking confirmed (agent)",
    description: "Sent to the agent when the developer confirms a booking.",
    category: "Deals & bookings",
    event: "booking.confirmed",
    recipient: "The deal's agent",
    critical: false,
    variables: [
      { name: "listingTitle", required: true },
      { name: "developerCompanyName", required: true },
      { name: "bookingUrl", required: true },
    ],
    subject: "Booking confirmed: {{listingTitle}}",
    html: `
      <p>{{developerCompanyName}} confirmed the booking on
      "{{listingTitle}}". You can now log your commission for this deal.</p>
      <p><a href="{{bookingUrl}}">View this deal</a></p>
    `,
  },
  {
    key: "commission_paid_out",
    name: "Commission paid out (agent)",
    description: "Sent to the agent when a commission is marked as paid out.",
    category: "Commissions",
    event: "commission.paid_out",
    recipient: "The commission's agent",
    critical: false,
    variables: [
      { name: "source", required: true },
      { name: "amount", required: true },
      { name: "listingTitle", required: true },
      { name: "dealUrl", required: true },
    ],
    subject: "Commission paid out: {{listingTitle}}",
    html: `
      <p>Your {{source}} commission of
      {{amount}} on "{{listingTitle}}" has been
      marked as paid out.</p>
      <p><a href="{{dealUrl}}">View this deal</a></p>
    `,
  },
  {
    key: "lead_opted_out",
    name: "Lead unsubscribed / opted out (agent)",
    description: "Sent to the listing agent when a lead unsubscribes or opts out of communications.",
    category: "Leads & inquiries",
    event: "lead.opted_out",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "contactName", required: true },
      { name: "contactEmail", required: true },
      { name: "dealUrl", required: true },
      { name: "reason", required: false },
    ],
    subject: "Lead opted out: {{contactName}} - {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>A lead has unsubscribed or opted out of communications regarding "{{listingTitle}}":</p>
      <p>
        <strong>Lead:</strong> {{contactName}}<br/>
        <strong>Email:</strong> {{contactEmail}}
        {{#if reason}}<br/><strong>Reason:</strong> {{reason}}{{/if}}
      </p>
      <p><a href="{{dealUrl}}">View this lead in dashboard</a></p>
    `,
  },
  {
    key: "listing_submitted",
    name: "Listing submitted for approval (agent)",
    description: "Sent to the listing agent when their property listing is submitted for admin review and approval.",
    category: "Listings",
    event: "listing.submitted",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "listingUrl", required: true },
    ],
    subject: "Listing submitted for review: {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>Your property listing <strong>"{{listingTitle}}"</strong> has been successfully submitted for review.</p>
      <p>Our moderation team is reviewing the listing details and media. We will notify you once your listing has been approved and published to the live marketplace.</p>
      <p><a href="{{listingUrl}}">View listing in dashboard</a></p>
    `,
  },
  {
    key: "listing_review_decision",
    name: "Listing approved or rejected (agent)",
    description: "Sent to the listing agent when an admin approves or rejects their property listing.",
    category: "Listings",
    event: "listing.review_decision",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "status", required: true },
      { name: "listingUrl", required: true },
      { name: "reviewNotes", required: false },
    ],
    subject: "Listing {{status}}: {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>Your property listing <strong>"{{listingTitle}}"</strong> has been reviewed by our administration team.</p>
      <p><strong>Status:</strong> {{status}}</p>
      {{#if reviewNotes}}<p><strong>Reviewer feedback:</strong> {{reviewNotes}}</p>{{/if}}
      <p><a href="{{listingUrl}}">View your listing</a></p>
    `,
  },
  {
    key: "listing_live",
    name: "Listing goes live (agent)",
    description: "Sent to the listing agent when their property listing is approved and goes live on the marketplace.",
    category: "Listings",
    event: "listing.live",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "listingUrl", required: true },
    ],
    subject: "Your listing is now live: {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>Great news! Your property listing <strong>"{{listingTitle}}"</strong> is now live on REBX.</p>
      <p>Buyers, renters, and collaborating brokers can now discover your property, view details, and send inquiries directly to you.</p>
      <p><a href="{{listingUrl}}">View your live listing</a></p>
    `,
  },
  {
    key: "listing_expires_soon",
    name: "Listing expires soon (agent)",
    description: "Sent to the listing agent when their active listing is approaching its expiration date.",
    category: "Listings",
    event: "listing.expires_soon",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "expiresAt", required: true },
      { name: "daysRemaining", required: false },
      { name: "listingUrl", required: true },
      { name: "renewUrl", required: false },
    ],
    subject: "Listing expiring soon: {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>This is a reminder that your listing <strong>"{{listingTitle}}"</strong> is scheduled to expire on <strong>{{expiresAt}}</strong>{{#if daysRemaining}} (in {{daysRemaining}}){{/if}}.</p>
      <p>Once expired, the property will no longer appear in public search results.</p>
      <p>{{#if renewUrl}}<a href="{{renewUrl}}">Renew listing</a> &nbsp;|&nbsp; {{/if}}<a href="{{listingUrl}}">View listing</a></p>
    `,
  },
  {
    key: "listing_expired",
    name: "Listing has expired (agent)",
    description: "Sent to the listing agent when their property listing has expired and is removed from public search.",
    category: "Listings",
    event: "listing.expired",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "listingUrl", required: true },
      { name: "renewUrl", required: false },
    ],
    subject: "Listing expired: {{listingTitle}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>Your property listing <strong>"{{listingTitle}}"</strong> has expired and is no longer visible to public searchers on REBX.</p>
      <p>If the property is still on the market, you can renew or update it from your agent dashboard to republish it.</p>
      <p>{{#if renewUrl}}<a href="{{renewUrl}}">Renew and republish listing</a> &nbsp;|&nbsp; {{/if}}<a href="{{listingUrl}}">Manage listing in dashboard</a></p>
    `,
  },
  {
    key: "site_visit_request",
    name: "Site visit request (agent)",
    description: "Sent to the listing agent when a prospective buyer or tenant requests an in-person site visit.",
    category: "Leads & inquiries",
    event: "lead.site_visit_requested",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "contactName", required: true },
      { name: "contactEmail", required: true },
      { name: "contactPhone", required: false },
      { name: "visitDate", required: false },
      { name: "visitTime", required: false },
      { name: "message", required: false },
      { name: "dealUrl", required: true },
      { name: "listingUrl", required: false },
    ],
    subject: "New site visit request: {{listingTitle}} - {{contactName}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>A prospective client has requested an in-person site visit for your property <strong>"{{listingTitle}}"</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Client Name:</strong> {{contactName}}</p>
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Email:</strong> {{contactEmail}}</p>
              {{#if contactPhone}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Phone:</strong> {{contactPhone}}</p>{{/if}}
              {{#if visitDate}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Preferred Date:</strong> {{visitDate}}</p>{{/if}}
              {{#if visitTime}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Preferred Time:</strong> {{visitTime}}</p>{{/if}}
              {{#if message}}<p style="margin:0;"><strong style="color:#18181b;">Notes:</strong> {{message}}</p>{{/if}}
            </td>
          </tr>
        </tbody>
      </table>
      <p><a href="{{dealUrl}}">View request in agent dashboard</a></p>
    `,
  },
  {
    key: "showing_status_update",
    name: "Showing confirmed, rescheduled or cancelled (agent)",
    description: "Sent to the listing agent when a property showing or site visit is confirmed, rescheduled, or cancelled by the client or seller.",
    category: "Leads & inquiries",
    event: "showing.status_updated",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "contactName", required: true },
      { name: "showingStatus", required: true },
      { name: "updatedBy", required: false },
      { name: "visitDate", required: false },
      { name: "visitTime", required: false },
      { name: "showingReason", required: false },
      { name: "dealUrl", required: true },
      { name: "listingUrl", required: false },
    ],
    subject: "Showing {{showingStatus}}: {{listingTitle}} - {{contactName}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>The scheduled showing for <strong>"{{listingTitle}}"</strong> has been <strong>{{showingStatus}}</strong>{{#if updatedBy}} by {{updatedBy}}{{/if}}.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Status:</strong> {{showingStatus}}</p>
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Client:</strong> {{contactName}}</p>
              {{#if updatedBy}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Action By:</strong> {{updatedBy}}</p>{{/if}}
              {{#if visitDate}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Date:</strong> {{visitDate}}</p>{{/if}}
              {{#if visitTime}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Time:</strong> {{visitTime}}</p>{{/if}}
              {{#if showingReason}}<p style="margin:0;"><strong style="color:#18181b;">Reason:</strong> {{showingReason}}</p>{{/if}}
            </td>
          </tr>
        </tbody>
      </table>
      <p><a href="{{dealUrl}}">View showing in agent dashboard</a></p>
    `,
  },
  {
    key: "deal_new_message",
    name: "New negotiation message",
    description: "Sent to the other party when a new message is posted in a deal conversation.",
    category: "Deals & bookings",
    event: "deal.new_message",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "message_preview", required: true },
      { name: "deal_link", required: true },
    ],
    subject: "New message regarding {{listing_title}} from {{sender_name}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p><strong>{{sender_name}}</strong> has sent you a new message regarding <strong>"{{listing_title}}"</strong>:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0;font-style:italic;">“{{message_preview}}”</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p><a href="{{deal_link}}">Open conversation to reply</a></p>
    `,
  },
  {
    key: "deal_new_offer",
    name: "New offer received on a listing",
    description: "Sent to the recipient (agent or customer) when a new offer is submitted on a property listing.",
    category: "Deals & bookings",
    event: "deal.new_offer",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "amount", required: true },
      { name: "message_preview", required: false },
      { name: "deal_link", required: true },
      { name: "expires_at", required: false },
    ],
    subject: "New offer received for {{listing_title}}: {{amount}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p><strong>{{sender_name}}</strong> has submitted a new offer of <strong style="color:#0f766e;font-size:16px;">{{amount}}</strong> for <strong>"{{listing_title}}"</strong>.</p>
      {{#if message_preview}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0;font-style:italic;">“{{message_preview}}”</p>
            </td>
          </tr>
        </tbody>
      </table>
      {{/if}}
      {{#if expires_at}}
      <p style="margin:12px 0;font-size:14px;color:#6b7280;">⏳ <strong>Offer valid until:</strong> {{expires_at}}</p>
      {{/if}}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
        <tbody>
          <tr>
            <td style="background-color:#111827;border-radius:8px;">
              <a href="{{deal_link}}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Review &amp; Respond to Offer</a>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  },
  {
    key: "deal_counter_offer",
    name: "Counter-offer received",
    description: "Sent to the other party (agent or customer) when a counter-offer is proposed in a deal negotiation.",
    category: "Deals & bookings",
    event: "deal.counter_offer",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "amount", required: true },
      { name: "message_preview", required: false },
      { name: "deal_link", required: true },
      { name: "expires_at", required: false },
    ],
    subject: "Counter-offer received for {{listing_title}}: {{amount}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p><strong>{{sender_name}}</strong> has proposed a counter-offer of <strong style="color:#0f766e;font-size:16px;">{{amount}}</strong> for <strong>"{{listing_title}}"</strong>.</p>
      {{#if message_preview}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0;font-style:italic;">“{{message_preview}}”</p>
            </td>
          </tr>
        </tbody>
      </table>
      {{/if}}
      {{#if expires_at}}
      <p style="margin:12px 0;font-size:14px;color:#6b7280;">⏳ <strong>Counter-offer valid until:</strong> {{expires_at}}</p>
      {{/if}}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
        <tbody>
          <tr>
            <td style="background-color:#111827;border-radius:8px;">
              <a href="{{deal_link}}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Review Counter-Offer</a>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  },
  {
    key: "offer_received",
    name: "New offer received (agent)",
    description: "Sent to the listing agent when a buyer or customer submits a new offer on their listing.",
    category: "Deals & bookings",
    event: "deal.offer_received",
    recipient: "The listing agent",
    critical: false,
    variables: [
      { name: "agentName", required: true },
      { name: "listingTitle", required: true },
      { name: "offerAmount", required: true },
      { name: "contactName", required: true },
      { name: "contactEmail", required: false },
      { name: "contactPhone", required: false },
      { name: "message", required: false },
      { name: "dealUrl", required: true },
    ],
    subject: "New offer received: {{listingTitle}} - {{offerAmount}}",
    html: `
      <p>Hello {{agentName}},</p>
      <p>A new offer has been submitted for your property listing <strong>"{{listingTitle}}"</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Offer Amount:</strong> {{offerAmount}}</p>
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Client Name:</strong> {{contactName}}</p>
              {{#if contactEmail}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Email:</strong> {{contactEmail}}</p>{{/if}}
              {{#if contactPhone}}<p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Phone:</strong> {{contactPhone}}</p>{{/if}}
              {{#if message}}<p style="margin:0;"><strong style="color:#18181b;">Offer Terms / Notes:</strong> {{message}}</p>{{/if}}
            </td>
          </tr>
        </tbody>
      </table>
      <p><a href="{{dealUrl}}">View and manage this offer in agent dashboard</a></p>
    `,
  },
  {
    key: "offer_received_customer",
    name: "Offer submitted confirmation (customer)",
    description: "Sent to the client or buyer confirming that their offer on a listing has been submitted and received.",
    category: "Deals & bookings",
    event: "deal.offer_submitted",
    recipient: "The client or customer who submitted the offer",
    critical: false,
    variables: [
      { name: "contactName", required: true },
      { name: "listingTitle", required: true },
      { name: "offerAmount", required: true },
      { name: "agentName", required: true },
      { name: "message", required: false },
      { name: "listingUrl", required: false },
    ],
    subject: "Offer confirmation: {{listingTitle}}",
    html: `
      <p>Hello {{contactName}},</p>
      <p>Thank you for submitting your offer for <strong>"{{listingTitle}}"</strong>. We have received your submission and forwarded it to the listing agent.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Offer Amount:</strong> {{offerAmount}}</p>
              <p style="margin:0 0 8px 0;"><strong style="color:#18181b;">Listing Agent:</strong> {{agentName}}</p>
              {{#if message}}<p style="margin:0;"><strong style="color:#18181b;">Your Terms / Notes:</strong> {{message}}</p>{{/if}}
            </td>
          </tr>
        </tbody>
      </table>
      <p>The listing agent <strong>{{agentName}}</strong> will review the details and follow up with you directly.</p>
      {{#if listingUrl}}<p><a href="{{listingUrl}}">View listing on REBX</a></p>{{/if}}
    `,
  },
  {
    key: "deal_offer_accepted",
    name: "Offer accepted",
    description: "Sent to the other party when an offer or counter-offer is accepted in a deal.",
    category: "Deals & bookings",
    event: "deal.offer_accepted",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "amount", required: true },
      { name: "deal_link", required: true },
    ],
    subject: "Offer accepted for {{listing_title}}: {{amount}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p>Great news! <strong>{{sender_name}}</strong> has accepted the offer of <strong style="color:#0f766e;font-size:16px;">{{amount}}</strong> for <strong>"{{listing_title}}"</strong>.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#166534;">
              <p style="margin:0 0 6px 0;">🎉 <strong style="color:#14532d;">Deal Status:</strong> Under contract</p>
              <p style="margin:0;"><strong style="color:#14532d;">Agreed Price:</strong> {{amount}}</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p>You can view the full deal details and continue coordinating next steps in your dashboard:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
        <tbody>
          <tr>
            <td style="background-color:#111827;border-radius:8px;">
              <a href="{{deal_link}}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">View Deal in Dashboard</a>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  },
  {
    key: "deal_offer_rejected",
    name: "Offer rejected",
    description: "Sent to the other party when an offer or counter-offer is declined in a deal.",
    category: "Deals & bookings",
    event: "deal.offer_rejected",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "amount", required: true },
      { name: "message_preview", required: false },
      { name: "deal_link", required: true },
    ],
    subject: "Offer declined for {{listing_title}}: {{amount}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p><strong>{{sender_name}}</strong> has declined the offer of <strong style="font-size:16px;color:#18181b;">{{amount}}</strong> for <strong>"{{listing_title}}"</strong>.</p>
      {{#if message_preview}}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
        <tbody>
          <tr>
            <td style="padding:16px;font-size:14px;line-height:22px;color:#3f3f46;">
              <p style="margin:0 0 4px 0;"><strong style="color:#18181b;">Feedback / Reason:</strong></p>
              <p style="margin:0;font-style:italic;">“{{message_preview}}”</p>
            </td>
          </tr>
        </tbody>
      </table>
      {{/if}}
      <p>You can propose a revised counter-offer or continue the conversation in your dashboard:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
        <tbody>
          <tr>
            <td style="background-color:#111827;border-radius:8px;">
              <a href="{{deal_link}}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">Open Conversation</a>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  },
  {
    key: "deal_offer_expired",
    name: "Offer expired",
    description: "Sent when an offer's validity period has ended without being accepted.",
    category: "Deals & bookings",
    event: "deal.offer_expired",
    recipient: "The deal participant (agent or customer)",
    critical: false,
    variables: [
      { name: "recipient_name", required: true },
      { name: "sender_name", required: true },
      { name: "listing_title", required: true },
      { name: "amount", required: true },
      { name: "deal_link", required: true },
    ],
    subject: "Offer expired for {{listing_title}}: {{amount}}",
    html: `
      <p>Hello {{recipient_name}},</p>
      <p>The offer of <strong style="font-size:16px;color:#18181b;">{{amount}}</strong> for <strong>"{{listing_title}}"</strong> submitted by <strong>{{sender_name}}</strong> has expired because the response deadline has passed.</p>
      <p>You can submit a new offer or continue the conversation in your dashboard:</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
        <tbody>
          <tr>
            <td style="background-color:#111827;border-radius:8px;">
              <a href="{{deal_link}}" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">View Deal in Dashboard</a>
            </td>
          </tr>
        </tbody>
      </table>
    `,
  },
];

export const BUILT_IN_BY_KEY: Record<string, TemplateDefinition> = Object.fromEntries(
  BUILT_IN_TEMPLATES.map((t) => [t.key, t])
);

/** Every known variable, for custom templates that aren't wired to a specific event. */
export const ALL_VARIABLE_REFS: TemplateVariableRef[] = Object.keys(VARIABLES).map((name) => ({
  name,
  required: false,
}));

/** Variables a template may use: its own for built-ins, the full catalogue for custom ones. */
export function variablesForTemplate(key: string): TemplateVariableRef[] {
  const own = BUILT_IN_BY_KEY[key]?.variables;
  if (!own) return ALL_VARIABLE_REFS;
  return [...own, ...AUTOMATIC_VARIABLES.filter((n) => !own.some((r) => r.name === n)).map((name) => ({ name, required: false }))];
}

/** Supplied by the system to every email, so any template can use them. */
export const AUTOMATIC_VARIABLES = ["latestListings"];

export function sampleDataFor(refs: TemplateVariableRef[]): Record<string, string> {
  return Object.fromEntries(refs.map((r) => [r.name, VARIABLES[r.name]?.sample ?? ""]));
}

/** Variables whose absence from the body makes the email useless (e.g. the reset link). */
export function mustAppearVariables(key: string): string[] {
  return (BUILT_IN_BY_KEY[key]?.variables ?? []).filter((r) => r.mustAppear).map((r) => r.name);
}

// Starter BODY for new templates. The shared layout adds the logo, card and footer around it.
export const STARTER_HTML = `<h1 style="margin:0 0 16px 0;font-size:24px;line-height:32px;color:#18181b;">Your heading</h1>
<p style="margin:0 0 16px 0;">Hi {{name}},</p>
<p style="margin:0 0 16px 0;">Write your message here.</p>`;
