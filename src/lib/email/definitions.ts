// Single source of truth for the built-in (system) email templates and the dynamic variables
// they can use. Pure data, no server-only imports, so the admin editor can use it too.
//
// Variable names deliberately match the camelCase fields the existing email functions in
// src/lib/email.ts already receive (listingTitle, dealUrl, ...). Nothing here invents a
// backend variable: each one is supplied by the calling code listed in `usedBy`.

export type VariableType = "text" | "url" | "email";

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
    v("contactEmail", "Lead", "email", "Contact email", "Email address the inquirer provided.", "taylor.prospect@example.com"),
    v("contactPhone", "Lead", "text", "Contact phone", "Phone number the inquirer provided. Often empty, so wrap it in a conditional block.", "+1 555 0101"),
    v("message", "Lead", "text", "Inquiry message", "Free-text message the inquirer wrote. Often empty, so wrap it in a conditional block.", "Is this still available? I'd love a weekend viewing."),
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
  ].map((d) => [d.name, d])
);

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
    description: "Sent right after a new account signs up.",
    category: "Account",
    event: "auth.signup_completed",
    recipient: "The new user",
    critical: false,
    variables: [{ name: "name", required: true }],
    subject: "Welcome to REBX",
    html: `
      <p>Hi {{name}},</p>
      <p>Your REBX account is ready. Log in any time to get started.</p>
    `,
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
  return BUILT_IN_BY_KEY[key]?.variables ?? ALL_VARIABLE_REFS;
}

export function sampleDataFor(refs: TemplateVariableRef[]): Record<string, string> {
  return Object.fromEntries(refs.map((r) => [r.name, VARIABLES[r.name]?.sample ?? ""]));
}

/** Variables whose absence from the body makes the email useless (e.g. the reset link). */
export function mustAppearVariables(key: string): string[] {
  return (BUILT_IN_BY_KEY[key]?.variables ?? []).filter((r) => r.mustAppear).map((r) => r.name);
}

export const STARTER_HTML = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
  <tbody>
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;padding:32px;">
          <tbody>
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:24px;color:#18181b;">
                <h1 style="font-size:22px;margin:0 0 16px 0;">Your heading</h1>
                <p style="margin:0 0 16px 0;">Hi {{name}},</p>
                <p style="margin:0 0 16px 0;">Write your message here.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>`;
