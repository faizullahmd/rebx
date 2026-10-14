import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { outbox } from "@/test/helpers";
import { invalidateTemplateCache } from "@/lib/email/cache";
import * as mail from "@/lib/email";
import * as svc from "@/lib/email/template-service";
import { BUILT_IN_BY_KEY, VARIABLES } from "@/lib/email/definitions";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { renderParts } from "@/lib/email/pipeline";
import { analyseContent } from "@/lib/email/analysis";
import { propertyCardHtml } from "@/lib/email/blocks";
import { composeEmail, DEFAULT_LAYOUT } from "@/lib/email/layout";
import { getLatestPropertiesHtml } from "@/lib/email/latest-properties";
import type { Actor } from "@/lib/permissions";

vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

const SITE = "https://rebx.app";
const agentId = 920001;
const admin: Actor = { id: 920002, role: "ADMIN", email: "welcome-admin@example.com" };

let seq = 0;
async function listing(over: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.listing.create({
    data: {
      slug: `welcome-test-${seq}-${Date.now()}`,
      title: `Test Listing ${seq}`,
      description: "d",
      price: 500000,
      currency: "USD",
      addressLine: "1 Test St",
      city: "Austin",
      state: "TX",
      country: "USA",
      status: "ACTIVE",
      agentId,
      ...over,
    },
  });
}

beforeAll(async () => {
  await prisma.listing.deleteMany({ where: { agentId } });
  await prisma.user.deleteMany({ where: { id: { in: [agentId, admin.id] } } });
  await prisma.user.create({ data: { id: agentId, name: "Welcome Agent", email: "welcome-agent@example.com", passwordHash: "x", role: "AGENT" } });
  await prisma.user.create({ data: { id: admin.id, name: "Welcome Admin", email: admin.email!, passwordHash: "x", role: "ADMIN" } });
});
afterAll(async () => {
  await prisma.listing.deleteMany({ where: { agentId } });
  await prisma.emailTemplate.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.user.deleteMany({ where: { id: { in: [agentId, admin.id] } } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.listing.deleteMany({ where: { agentId } });
  await prisma.emailTemplate.deleteMany();
  outbox.length = 0;
  invalidateTemplateCache();
});

describe("redesigned Welcome email", () => {
  it("has a logo header, a get-started button, a browse button and the welcome copy", async () => {
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    const [email] = outbox;
    expect(email.subject).toBe("Welcome to REBX");
    expect(email.html).toContain('src="https://rebx.app/logo.png"');
    expect(email.html).toContain("Welcome to Rebx, Casey!");
    expect(email.html).toContain("Discover Properties");
    expect(email.html).toContain("Track Commissions");
    expect(email.html).toContain('href="https://rebx.app/dashboard"');
    expect(email.html).toContain("Get started on Rebx");
    expect(email.html).toContain('href="https://rebx.app/listings"');
    expect(email.html).toContain("Browse properties");
    expect(email.html).toContain("The Rebx Team");
  });

  it("escapes the user's name so a hostile signup name can't inject markup", async () => {
    await mail.sendWelcomeEmail("new@example.com", `<script>alert(1)</script> "Eve" & Co`, SITE);
    expect(outbox[0].html).not.toContain("<script>");
    expect(outbox[0].html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &quot;Eve&quot; &amp; Co");
  });

  it("normalises a trailing slash on the site URL", async () => {
    await mail.sendWelcomeEmail("new@example.com", "Casey", "https://rebx.app///");
    expect(outbox[0].html).toContain('href="https://rebx.app/listings"');
    expect(outbox[0].html).not.toContain("rebx.app//");
  });

  it("uses the same template for every role (it is sent from signup for agents, customers and developers)", async () => {
    for (const name of ["Alex Agent", "Casey Customer", "Devon Developer"]) await mail.sendWelcomeEmail("x@example.com", name, SITE);
    expect(outbox.map((e) => e.subject)).toEqual(["Welcome to REBX", "Welcome to REBX", "Welcome to REBX"]);
    expect(outbox[1].html).toContain("Welcome to Rebx, Casey Customer!");
  });
});

describe("latest properties block", () => {
  it("shows the newest active listings with image, title, location, price and links, plus the browse button", async () => {
    const a = await listing({ title: "Oldest", createdAt: new Date("2026-01-01") });
    await prisma.listingImage.create({ data: { listingId: a.id, url: "https://cdn.example.com/a.jpg" } });
    await listing({ title: "Newest <b>Home</b>", createdAt: new Date("2026-03-01"), priceDisplay: "2 Cr", currency: "INR" });
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    const html = outbox[0].html;
    expect(html).toContain("Latest properties");
    expect(html.indexOf("Newest")).toBeLessThan(html.indexOf("Oldest")); // newest first
    expect(html).toContain("Newest &lt;b&gt;Home&lt;/b&gt;"); // titles are escaped
    expect(html).toContain("Austin, TX");
    expect(html).toContain("₹ 2 Cr");
    expect(html).toContain("$500,000");
    expect(html).toContain('src="https://cdn.example.com/a.jpg"');
    expect(html).toContain(`href="https://rebx.app/listings/${a.slug}"`);
    expect(html).toContain("Browse properties");
  });

  it("shows at most 3, and only ACTIVE listings", async () => {
    for (let i = 0; i < 5; i++) await listing({ title: `Active ${i}`, createdAt: new Date(2026, 0, i + 1) });
    await listing({ title: "Draft one", status: "DRAFT" });
    await listing({ title: "Sold one", status: "SOLD" });
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    const html = outbox[0].html;
    expect((html.match(/Active \d/g) ?? []).filter((_, i, a) => a.indexOf(_) === i)).toHaveLength(3);
    expect(html).not.toContain("Draft one");
    expect(html).not.toContain("Sold one");
  });

  it("falls back to the site's placeholder photo when a listing has no https image", async () => {
    const l = await listing({ title: "No photo" });
    await prisma.listingImage.create({ data: { listingId: l.id, url: "/uploads/images/gone.avif" } });
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    expect(outbox[0].html).toContain('src="https://rebx.app/images/property-placeholder.jpg"');
    expect(outbox[0].html).not.toContain("/uploads/images/gone.avif");
  });

  it("shows 'Price on request' for listings without a price", async () => {
    await listing({ title: "POR", priceOnRequest: true });
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    expect(outbox[0].html).toContain("Price on request");
  });

  it("omits the section (but keeps the browse button) when there are no active listings", async () => {
    await mail.sendWelcomeEmail("new@example.com", "Casey", SITE);
    expect(outbox[0].html).not.toContain("Latest properties");
    expect(outbox[0].html).toContain("Browse properties");
  });

  it("never blocks the email: a database failure just drops the block", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({ prisma: { listing: { findMany: async () => { throw new Error("db down"); } } } }));
    try {
      const fresh = await import("@/lib/email/latest-properties");
      expect(await fresh.getLatestPropertiesHtml(SITE)).toBe("");
      expect(err).toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/prisma");
      vi.resetModules();
    }
  });

  it("builds escaped cards", () => {
    const html = propertyCardHtml({ title: `A"B<i>`, location: "X & Y", price: "$1", url: `https://x.test/a?b=1&c="2"`, imageUrl: "https://x.test/i.jpg" });
    expect(html).not.toContain("<i>");
    expect(html).toContain("&quot;");
    expect(html).toContain("&amp;");
  });
});

describe("html variables are safe", () => {
  it("are sanitized even if a caller passes unsafe markup", () => {
    const r = renderParts(
      "welcome",
      { subject: "s", htmlBody: "{{latestProperties}}" },
      { latestProperties: `<p onclick="x()">ok</p><script>alert(1)</script><img src="javascript:alert(1)"><a href="javascript:alert(1)">l</a>` },
      "preview"
    );
    expect(r.html).toBe("<p>ok</p><a>l</a>");
  });

  it("are flattened to readable text in the plain-text part", () => {
    const r = renderParts("welcome", { subject: "s", htmlBody: "<p>x</p>", textBody: "Props:\n{{latestProperties}}" }, { latestProperties: "<p><b>Home</b></p><p>Austin</p>" }, "preview");
    expect(r.text).toContain("Home");
    expect(r.text).not.toContain("<");
  });

  it("can't be used in the subject line", () => {
    const a = analyseContent({ key: "welcome", subject: "Look {{latestProperties}}", htmlBody: "<p>{{name}}</p>" });
    expect(a.hasErrors).toBe(true);
    expect(a.issues.some((i) => /can't be used in the subject/.test(i.message))).toBe(true);
  });

  it("previews and test emails ignore admin-typed HTML for them and use the sample cards", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { key: "welcome" } });
    const fields = { name: "Welcome", category: "Account", subject: "Hi {{name}}", htmlBody: "<p>{{latestProperties}}</p>" };
    const p = await svc.previewTemplate(admin, t.id, fields, { name: "A", latestProperties: "<script>alert(1)</script><b>MINE</b>" });
    expect(p.html).not.toContain("MINE");
    expect(p.html).not.toContain("<script");
    expect(p.html).toContain("Lakeside Family Home");
    const sent = await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", fields, data: { latestProperties: "<b>MINE</b>" } });
    expect(sent.status).toBe("SENT");
    expect(outbox[0].html).not.toContain("MINE");
    expect(outbox[0].html).toContain("Lakeside Family Home");
  });
});

describe("the built-in Welcome definition", () => {
  const def = BUILT_IN_BY_KEY.welcome;

  it("declares every variable it uses, with real definitions", () => {
    const analysis = analyseContent({ key: "welcome", subject: def.subject, htmlBody: def.html });
    expect(analysis.hasErrors).toBe(false);
    for (const name of ["name", "listingsUrl", "dashboardUrl", "latestProperties"]) expect(VARIABLES[name]).toBeDefined();
    expect(VARIABLES.latestProperties.type).toBe("html");
  });

  it("survives the sanitizer, so publishing it from the admin keeps the design intact", () => {
    const { html } = sanitizeEmailHtml(def.html);
    // The logo and container now live in the shared layout; the body keeps its own content.
    for (const keep of ['href="{{dashboardUrl}}"', 'href="{{listingsUrl}}"', "{{#if latestProperties}}", "{{latestProperties}}", "background-color:#111827", "border-radius:8px"]) {
      expect(html).toContain(keep);
    }
  });

  it("is mobile-friendly: fluid 600px container and compact property cards that fit a phone", () => {
    expect(def.html).not.toContain("<img"); // logo/container are the shared layout's job
    expect(composeEmail(def.html, DEFAULT_LAYOUT)).toContain("max-width:600px");
    expect(propertyCardHtml({ title: "t", location: "l", price: "p", url: "https://x.test", imageUrl: "https://x.test/i.jpg" })).toContain("width:130px;height:auto");
  });

  it("renders with the sample data used by previews", () => {
    const sample = Object.fromEntries(def.variables.map((v) => [v.name, VARIABLES[v.name].sample]));
    const r = renderParts("welcome", { subject: def.subject, htmlBody: def.html }, sample, "strict");
    expect(r.issues).toEqual([]);
    expect(r.html).toContain("Lakeside Family Home");
    expect(r.html).toContain("https://example.com/sample/listings");
  });
});

describe("getLatestPropertiesHtml", () => {
  it("returns an empty string with no listings", async () => {
    expect(await getLatestPropertiesHtml(SITE)).toBe("");
  });
});
