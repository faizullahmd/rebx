# REBX — Product Requirements Document

| | |
|---|---|
| **Product** | REBX — Real Estate Broker Exchange |
| **Live site** | https://rebx.app |
| **Document status** | Reverse-documented from the codebase (`main`, 17 Oct 2026) |
| **How to read this** | Sections describe what is **built today**. Items marked **[Confirm]** are product intent that cannot be read from code and need an owner's decision. Section 12 lists known gaps and open questions. |

---

## 1. Overview

REBX is a marketplace and CRM for real-estate brokers. Agents and developers publish property
listings; visitors browse them and send inquiries; agents work each inquiry through a sales
pipeline to a closed deal; developers confirm bookings; and the platform tracks the **commission**
owed on every sale until it is paid out. An admin panel gives the operator full visibility and
control over everything users do on the public site.

### 1.1 Problem

Brokers collaborate on the same inventory but track leads, bookings and commissions in
spreadsheets and chat. There is no single record that links a listing → a lead → a booking → the
commission each party is owed, and no neutral place where developers and agents share listings.

### 1.2 Goals

1. Give agents and developers a place to publish and promote listings (photos, video, rich property detail).
2. Capture buyer interest and move it through a trackable deal pipeline.
3. Make the sale-to-commission trail auditable (deal → booking confirmed by developer → commission → paid out).
4. Give the platform operator complete oversight and safe tools to manage users, content and outbound email.

### 1.3 Non-goals (not built today) **[Confirm]**

- Online payments or escrow (commission is *recorded*, not collected, by the platform).
- Messaging/chat between users inside the platform (contact is by email and phone).
- Native mobile apps (the web app is responsive).
- Multi-language or multi-currency UI (currency is stored per listing; the UI is English and defaults to INR).
- Fine-grained admin sub-roles (a single `ADMIN` role holds all permissions).

---

## 2. Users and roles

Four roles; a user has exactly one. Admin and Developer accounts can also be created by an admin.

| Role | Who they are | What they do on REBX |
|---|---|---|
| **Visitor** (no account) | Anyone browsing | Search listings, view listing/portfolio/video pages, send an inquiry, submit a review |
| **Customer** | A buyer/renter with an account | Everything a visitor can, plus a dashboard of their own inquiries |
| **Agent** | A broker/agent | Create and manage own listings, run the deal pipeline, log commission, maintain a public portfolio |
| **Developer** | A builder/project owner | Own project listings, confirm bookings, mark developer commission paid out, manage videos |
| **Admin** | Platform operator | Everything: users, listings, deals, bookings, commissions, reviews, videos, tags, email templates and layout |

### 2.1 Access matrix

| Capability | Visitor | Customer | Agent | Developer | Admin |
|---|:-:|:-:|:-:|:-:|:-:|
| Browse listings, portfolios, videos | ✔ | ✔ | ✔ | ✔ | ✔ |
| Send an inquiry / "I'm Interested" | ✔ | ✔ | ✔ | ✔ | ✔ |
| See own inquiries | — | ✔ | — | — | — |
| Create a listing | — | — | ✔ | ✔ | ✔ |
| Edit a listing | — | — | own | own (as developer) | any |
| Upload listing photos | — | — | ✔ | ✔ | ✔ |
| Attach a video to a listing | — | — | ✔ | ✔ | — |
| Add to the video gallery | — | — | — | ✔ | — |
| Remove videos | — | — | — | own | ✔ |
| Work deals (stage, offer, notes) | — | — | own deals | — | any |
| Create a deal manually | — | — | own listings | — | — |
| Confirm a booking | — | — | — | linked listings | any |
| Log / edit commission | — | — | own deals | — | any |
| Mark developer commission paid out | — | — | — | linked listings | any |
| Approve / reject developer requests | — | — | — | — | ✔ |
| Manage users, content, email system | — | — | — | — | ✔ |

Route protection is enforced centrally in `src/proxy.ts` (`/agent`, `/developer`, `/customer`,
`/account`, `/admin`) and **again inside every server action**, which re-authenticates and
re-authorises. Hiding a button is never the security boundary.

---

## 3. Key user journeys

1. **Browse → inquire.** Visitor searches listings, opens a listing, sends the inquiry form. A lead is created for the listing's agent; the agent is emailed; the visitor gets a confirmation.
2. **Return visitor.** After sending one inquiry, the visitor sees a one-click **I'm Interested** button on other listings for the rest of the browser session.
3. **Agent lists a property.** Agent signs up (username required for the public portfolio) → creates a listing with photos, video and detail → publishes it (status `ACTIVE`).
4. **Lead to sale.** Agent moves a lead through the stages to `CLOSED_WON` → a booking is created → the developer confirms it → the agent logs commission → the developer marks it paid out → the agent is emailed.
5. **Unknown developer.** When listing a project whose developer has no account, the agent files a developer request; an admin approves it, which creates the developer account, links the listing, and emails the developer a set-password link.
6. **Admin operations.** Admin manages everything from `/admin`, including editing every outbound email and the shared email layout.

---

## 4. Functional requirements

### 4.1 Accounts and authentication — *Implemented*

- Sign-up as **Agent**, **Customer** or **Developer**. Agents and developers must choose a unique **username** (public portfolio URL); developers also give a company name.
- Password: at least 8 characters with a letter and a number. Hashed with bcrypt.
- Login with email + password (NextAuth v5, credentials provider, JWT sessions). Failed logins are rate-limited (8 failures per 15-minute window per key).
- Separate **admin login** at `/admin/login`; non-admins are redirected to `/unauthorized`.
- Password reset by emailed one-time token (hashed at rest, expiring, single-use). Developers created by approval receive a set-password invite using the same mechanism.
- Account settings: profile (name, phone, agency, licence, bio), username, change password.
- A welcome email is sent on sign-up.
- Numeric user IDs by range: Admin 10+, Developer 100+, Agent/Customer 10000+.

### 4.2 Listings — *Implemented*

- **Detail captured:** title, description, price (numeric and/or free-text display such as "10.58 Cr – 11.96 Cr"), currency (default INR), "price on request", address, city, state, country, postcode, coordinates, bedrooms, bathrooms, area, project units/area, RERA id, average price per sq ft, possession date.
- **Taxonomy:** transaction type (sale / rent / lease / auction); category (residential, commercial, land/plot, industrial); property type (apartment, villa, independent house, builder floor, penthouse, studio, office, shop, showroom, warehouse, …); furnishing; facing direction; parking; property age; availability.
- **Status:** `DRAFT` → `ACTIVE` → `UNDER_OFFER` → `SOLD`. Only `ACTIVE` listings accept inquiries and appear for sale to the public. Moving a deal to *Under contract* sets the listing `UNDER_OFFER`; *Closed won* sets it `SOLD`.
- **Media:** multiple photos (direct upload to DigitalOcean Spaces via short-lived signed URLs; images only), a main video (agents and developers), and a gallery of additional videos (developers) using YouTube and Vimeo URLs; metadata and thumbnails are resolved and de-duplicated in a shared video library.
- **Tags:** coloured tags (admin-defined defaults plus per-user tags) for grouping and filtering.
- **Ownership:** each listing has an agent and an optional developer. A developer user owns their own listings; an agent may link a developer or file a request for a new one.
- **Prerequisite:** a user must set a portfolio username before creating a listing.

### 4.3 Public site — *Implemented*

- **Home** page and marketing entry points (Join as agent, List your property).
- **Listings search** with filters: keyword, tag, city, min/max price, bedrooms, transaction type, property category, property type; a search hero and an active-filters bar.
- **Listing page:** gallery/carousel, details, videos, broker card (agent, rating, reviews), and the inquiry card.
- **Agent portfolio** pages at `/portfolio/<username>` with the agent's listings, ratings and reviews.
- **Videos** page listing the video library.
- **Reviews:** a visitor can submit a rating (overall plus communication, local knowledge, negotiation) and comment for an agent.
- SEO basics: sitemap, canonical URLs for portfolios.

### 4.4 Inquiries — *Implemented*

- Inquiry form: name, email, phone (optional), message (optional), and a consent checkbox. Logged-in customers only add phone and message (name/email come from their account).
- **Validation:** phone is optional but, if given, must be 7–15 digits using only digits, spaces and `+ ( ) . -`; email needs a real domain with a top-level domain. The same rules run in the browser and on the server (public, customer and agent-entered forms). Typed values survive a server-side error.
- **"I'm Interested":** after a visitor has sent one inquiry, a session cookie (httpOnly, expires when the browser closes, never used for login) lets other listings offer a one-click button that reuses their details. A listing already contacted shows "Interest sent ✓"; "Not you?" clears the saved details.
- Each inquiry creates a **Deal** (lead) for the listing's agent, emails the agent a new-lead notification, and emails the inquirer a confirmation.

### 4.5 Deal pipeline (agent) — *Implemented*

Stages: `NEW` → `CONTACTED` → `VIEWING_SCHEDULED` → `OFFER_MADE` → `NEGOTIATION` → `UNDER_CONTRACT` → `CLOSED_WON` | `CLOSED_LOST`.

- **Deals page** (`/agent/dashboard/deals`): stage count boxes that fit the screen and filter the list; search; paginated list of every inquiry with contact details, property and enquiry message, status (stage, booking, offer), inline manage form (stage, offer amount, notes) and an *Open* link. No delete here.
- **Deal page:** full contact details, edit form, booking panel and commission panel once won. Deleting a deal (with its booking and commissions) is available only from the deal page.
- **Manual deals:** an agent can add a lead for their own listing (walk-ins, phone enquiries).
- Closing a deal stamps `closedAt`. `CLOSED_WON` creates a **Booking** (see 4.6) and marks the listing sold.

### 4.6 Bookings — *Implemented*

- A won deal gets one booking with the sale amount (offer amount, else listing price).
- If the listing has a **developer**, the booking starts `PENDING_CONFIRMATION` and the developer is emailed to confirm; if there is no developer it is `CONFIRMED` immediately.
- The developer (or admin) confirms it; the agent is notified. Agents can edit booking details (booking number, unit number, sale amount, date, notes).

### 4.7 Commissions — *Implemented*

- A commission can be logged **only** when the deal is `CLOSED_WON` **and** the booking is `CONFIRMED`.
- At most one commission per **source** per deal: `DEVELOPER` (paid by the developer) and `CUSTOMER` (paid by the customer).
- Status flow: `PENDING` → `INVOICED` → `RECEIVED`, with timestamps. The agent can edit amount, status and notes.
- **Payout:** for developer-source commission, the linked developer (or admin) marks it **paid out**, recording who and when, and the agent is emailed.
- Agents see their own commissions at `/agent/dashboard/commissions`. Developers see commissions on their listings on their dashboard overview (where they mark them paid out); admin sees all at `/admin/dashboard/commissions`.

### 4.8 Developer requests — *Implemented*

- An agent listing a project whose developer is not on the platform submits the developer's company, contact and phone with the listing.
- Admin **approves** (creates the developer account, links the listing, sends a set-password invite; refuses if the email already has an account) or **rejects with a reason**. The admin is emailed when a request arrives.

### 4.9 Developer workspace — *Implemented*

Dashboard overview (including developer-source commissions to mark as paid out), own listings (create/edit), the videos library and per-listing video management, and the **Bookings** view where bookings are confirmed.

### 4.10 Admin panel (`/admin`) — *Implemented*

Overview dashboard and management of: **Users** (create, change role, reset password, delete), **Listings** (status, edit, delete), **Deals & inquiries** (stage, offer, notes, delete), **Bookings**, **Commissions**, **Developer requests**, **Reviews** (verify toggle, delete), **Videos**, **Tags**, **Email templates**, **Email layout**. Accessible with its own login and a dedicated sidebar.

### 4.11 Email system — *Implemented*

All transactional email is template-driven and editable by admins without a deploy.

**Emails sent today (9 built-in templates):** welcome, password reset, developer welcome / set-password, developer-request notification (to admins), new lead (to agent), inquiry confirmation (to visitor), booking confirmation needed (to developer), booking confirmed (to agent), commission paid out (to agent).

**Template management**
- Create, duplicate, activate/deactivate and delete custom templates; built-in templates cannot be deleted, and critical ones (e.g. password reset) cannot be deactivated.
- **Draft → publish** workflow with version history, restore (as a new version) and optimistic locking so two admins can't silently overwrite each other.
- Rich-text and HTML-source editing; the HTML is sanitised on save (no scripts, forms, event handlers or unsafe URLs).
- **Variables:** `{{name}}` placeholders (HTML-escaped) and `{{#if x}}…{{/if}}` conditionals, with a catalogue of variables per template and live validation of unknown or missing ones. Production falls back to the built-in version if a published template fails to render.
- **Preview** (desktop/mobile, HTML/plain text) using the exact production renderer, and **test emails** with safeguards (clearly labelled `[TEST]`, sample data only, links restricted to example.com, rate-limited, and a confirmation before sending to a real user's address).
- Full **audit log** of administrative changes.
- **`{{latestListings}}`** — an automatic block (heading, the three newest active listings as cards, and a "Browse all properties" button) usable anywhere in any template; omitted when there are no active listings.

**Shared layout (one for all emails):** logo, accent bar, content card and footer are applied automatically to every email, including templates created later. Admins edit logo, colours, footer text and support email on one page with a live preview; saving is versioned, conflict-checked and audited. Templates contain only their message body.

**Sending:** Resend, from a verified sender on `notify.rebx.app`.

---

## 5. Domain model (summary)

| Entity | Purpose / key fields |
|---|---|
| **User** | `id` (numeric, role-ranged), name, email, username, role, password hash; one of Agent/Developer/Customer profile |
| **Listing** | Property detail, taxonomy, price, status, `agentId`, optional `developerId`, tag, main video |
| **ListingImage / ListingVideo / Video** | Photos with order; gallery videos; shared deduplicated video library |
| **Deal** | Lead/deal: listing, agent, optional customer, contact fields, message, stage, offer, notes, `closedAt` |
| **Booking** | One per won deal: status, sale amount, booking/unit number, dates |
| **Commission** | Per deal and source (`DEVELOPER` / `CUSTOMER`): amount, status, invoiced/received/paid-out timestamps and who paid out |
| **DeveloperRequest** | Pending/approved/rejected request to onboard a developer for a listing |
| **Review** | Rating and comment about an agent (optionally a listing) |
| **Tag** | Coloured label, default or per-user |
| **PasswordResetToken** | Hashed, expiring, single-use |
| **EmailTemplate / Draft / Version / TestLog** | Published content, staged edits, history, test-send log |
| **EmailLayout** | The single shared layout settings, versioned |
| **AdminAuditLog** | Who changed what, and when |
| **IdCounter** | Per-range counters for numeric user IDs |

Relationships that matter: a Listing has many Deals; a Deal has at most one Booking and up to two
Commissions; deleting a Listing or Deal cascades to its dependants.

---

## 6. Business rules (quick reference)

1. Only `ACTIVE` listings accept inquiries.
2. Deal stage `UNDER_CONTRACT` → listing `UNDER_OFFER`; `CLOSED_WON` → listing `SOLD` and a booking is created.
3. Booking is `CONFIRMED` automatically if the listing has no developer; otherwise the developer must confirm.
4. Commission requires `CLOSED_WON` **and** a `CONFIRMED` booking; one commission per source per deal.
5. Only the linked developer (or an admin) may confirm a booking or mark developer commission paid out; only the deal's agent (or an admin) may edit the deal, booking or commission.
6. An agent or developer needs a unique username before creating a listing.
7. Developer approval fails if the contact email already has an account.
8. Email test sends never use real action links and are limited per admin.

---

## 7. Non-functional requirements

**Security**
- Server actions authenticate and authorise independently of route gating; Next.js's built-in origin check protects form posts.
- Passwords hashed with bcrypt; reset tokens stored hashed; user content is escaped on render; email HTML is sanitised against an allow-list.
- Secrets live in environment variables only and are never committed.
- Login throttling is in-memory (single instance) — see 12.

**Privacy**
- The inquiry-session cookie is httpOnly, lasts for the browser session and holds only the visitor's own contact details and the IDs of properties they contacted.

**Reliability**
- Email lookups and layout/template failures fall back to built-in defaults; sending never blocks on the admin layer.
- Database changes ship as additive migrations; production was rebuilt with `db push` and migrations baselined (see section 10).

**Performance / delivery**
- Listing images are served from DigitalOcean Spaces (optional CDN endpoint).
- Template and layout lookups are cached in memory for ~30 seconds and invalidated on publish.

**Accessibility and responsiveness**
- Responsive layouts for public pages, dashboards and the admin panel; form fields use semantic labels and native validation.

**Quality**
- Automated tests (Vitest) cover the email system (rendering, sanitiser, templates, layout, regression against the original emails), validation rules and the inquiry-session cookie. They run against an isolated `rebx_test` database.

---

## 8. Integrations

| Service | Use |
|---|---|
| **MySQL** (DigitalOcean managed in production; Docker locally) via **Prisma 6** | Primary datastore |
| **DigitalOcean Spaces** (S3 API) | Listing photos |
| **Resend** | Transactional email from `notify.rebx.app` (API key scoped to that domain) |
| **YouTube / Vimeo** | Video URLs, metadata and thumbnails |
| **NextAuth.js v5** | Authentication (credentials, JWT sessions) |

---

## 9. Architecture and stack

- **Next.js 16** (App Router, React Server Components, server actions, `proxy.ts` route gating), **TypeScript**, **Tailwind CSS**, **Zod** validation.
- Pages that read the session or database are dynamic; the production build runs without runtime secrets, so database access and the email client must stay lazy.
- Next.js 16 differs from earlier versions; consult `node_modules/next/dist/docs/` (per `AGENTS.md`) before changing framework-level code.

---

## 10. Environments and operations

- **Local:** `docker compose up -d`, `npm install`, `npx prisma migrate dev`, `npm run db:seed`, `npm run dev` (webpack; `npm run dev:turbo` for Turbopack). See `README.md`.
- **Production:** DigitalOcean App Platform (web service) + managed MySQL, domain `rebx.app` with `www` redirecting to the apex. App Platform deploys from `main` **[Confirm]**.
- **Required configuration:** `DATABASE_URL`, `AUTH_SECRET`, Spaces credentials (`SPACES_KEY`, `SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_REGION`, optional `SPACES_CDN_ENDPOINT`), `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`REBX <noreply@notify.rebx.app>`, unquoted). Quotes or stray whitespace in these values cause hard-to-diagnose failures.
- **Database migrations:** the production database was rebuilt with `prisma db push` and every existing migration was baselined with `migrate resolve --applied`; it cannot replay the full migration chain (managed MySQL enforces primary keys during the ID-conversion migrations). New schema changes should be **additive**, previewed with `prisma migrate diff`, applied, and then marked applied.
- **Workflow:** feature branches and pull requests into `main`; credentials are never committed.

---

## 11. Success metrics **[Confirm]**

The code does not define targets. Suggested measures to agree:

- Active listings and new listings per week.
- Inquiries per active listing; inquiry → *Contacted* time; *Viewing → Closed won* conversion.
- Bookings confirmed within N days of being created; time from confirmation to payout.
- Share of emails delivered successfully (needs a delivery log — see 12).
- Agent and developer activation (published a listing within 7 days of sign-up).

---

## 12. Known gaps, risks and open questions

**Product decisions needed**
1. **Developer sign-up.** The sign-up form offers *Developer*, but `README.md` says developers are only created by an admin. Which is intended?
2. **Reviews are open.** Anyone can submit a review for an agent, they default to "verified", and the submit action does not require login. Decide whether reviews need an account, a completed deal, or moderation before display.
3. **Deal ↔ customer link.** Guest inquiries are not linked to a customer account even if the email later registers.
4. **Commission model.** Only fixed amounts are recorded; there is no commission rate, split between agents, or invoice document.
5. **First-name variable.** A requested email variable `{{first_name}}` does not exist (the catalogue uses `{{name}}`); decide whether to add it.
6. **Email delivery log.** There is no record of production sends and failures beyond provider logs.

**Technical debt and risks**
- Login/test-send rate limiters are in-memory and per-instance; they need a shared store before scaling beyond one instance.
- `requireUser` signs the user out during render, which can surface as a 500 when a session's user row has been deleted.
- `README.md` is out of date (it says commissions are "a later pass"); this PRD supersedes its feature list.
- Phone numbers on the account/profile and developer-request forms are not yet validated with the shared rule used by the inquiry form.
- Production hygiene: rotate the production database password that was shared during setup, and change the generated admin password.
- There are no end-to-end browser tests; UI flows are verified manually.

---

## 13. Glossary

- **Deal / lead / inquiry** — a buyer's interest in a listing, tracked through stages by the agent. The terms are used interchangeably in the UI.
- **Booking** — the record of a sale created when a deal is won; confirmed by the developer.
- **Commission** — the fee owed to the agent on a sale, from the developer and/or the customer.
- **Developer** — builder or project owner whose projects are listed; confirms bookings and pays developer commission.
- **Portfolio** — an agent's or developer's public page at `/portfolio/<username>`.
- **Shared layout** — the logo/footer wrapper applied to every outbound email.
