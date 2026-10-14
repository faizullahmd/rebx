import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { outbox } from "@/test/helpers";
import type { Actor } from "@/lib/permissions";
import { invalidateTemplateCache } from "@/lib/email/cache";
import * as mail from "@/lib/email";
import * as svc from "@/lib/email/template-service";
import { BUILT_IN_BY_KEY, VARIABLES, variablesForTemplate } from "@/lib/email/definitions";
import { analyseContent } from "@/lib/email/analysis";
import { latestListingsBlockHtml, SAMPLE_PROPERTY_CARDS } from "@/lib/email/blocks";
import { siteBaseFrom } from "@/lib/email/latest-properties";

vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

const agentId = 930001;
const admin: Actor = { id: 930002, role: "ADMIN", email: "block-admin@example.com" };

let seq = 0;
async function listing(over: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.listing.create({
    data: {
      slug: `block-test-${seq}-${Date.now()}`, title: `Block Listing ${seq}`, description: "d", price: 500000, currency: "USD",
      addressLine: "1 Test St", city: "Austin", state: "TX", country: "USA", status: "ACTIVE", agentId, ...over,
    },
  });
}

async function publishResetBody(htmlBody: string) {
  await svc.ensureBuiltInTemplates(admin);
  const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { key: "password_reset" } });
  const { tokens } = await svc.getEditorState(admin, t.id);
  await svc.publishTemplate(admin, t.id, {
    name: t.name, description: "", category: "Account", subject: "Reset", htmlBody, textBody: "", fromName: "", fromEmail: "", replyTo: "", cc: "", bcc: "",
  }, tokens, "use the listings block");
}

beforeAll(async () => {
  await prisma.listing.deleteMany({ where: { agentId } });
  await prisma.user.deleteMany({ where: { id: { in: [agentId, admin.id] } } });
  await prisma.user.create({ data: { id: agentId, name: "Block Agent", email: "block-agent@example.com", passwordHash: "x", role: "AGENT" } });
  await prisma.user.create({ data: { id: admin.id, name: "Block Admin", email: admin.email!, passwordHash: "x", role: "ADMIN" } });
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

describe("{{latestListings}} block", () => {
  it("builds heading, cards and a Browse button, and is empty without cards", () => {
    const html = latestListingsBlockHtml(SAMPLE_PROPERTY_CARDS, "https://example.com/a?x=1&y=2");
    expect(html).toContain("Latest properties");
    expect(html).toContain("Lakeside Family Home");
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html).toContain("Browse all properties");
    expect(latestListingsBlockHtml([], "https://example.com/listings")).toBe("");
  });

  it("is a system-supplied html variable available in every template, built-in or custom", () => {
    expect(VARIABLES.latestListings.type).toBe("html");
    for (const key of [...Object.keys(BUILT_IN_BY_KEY), "my_custom_key"]) {
      expect(variablesForTemplate(key).map((r) => r.name)).toContain("latestListings");
    }
    expect(variablesForTemplate("password_reset").find((r) => r.name === "latestListings")?.required).toBe(false);
  });

  it("is accepted in any body position but rejected in the subject", () => {
    const body = analyseContent({ key: "password_reset", subject: "Reset", htmlBody: '<p><a href="{{resetUrl}}">x</a></p>{{latestListings}}' });
    expect(body.issues).toEqual([]);
    const subject = analyseContent({ key: "password_reset", subject: "{{latestListings}}", htmlBody: '<a href="{{resetUrl}}">x</a>' });
    expect(subject.hasErrors).toBe(true);
  });

  it("is sent with the newest active listings and a working Browse link in an email that never had it", async () => {
    await listing({ title: "Older Home", createdAt: new Date("2026-01-01") });
    await listing({ title: "Newest Home", createdAt: new Date("2026-03-01") });
    await listing({ title: "Hidden Draft", status: "DRAFT" });
    await publishResetBody('<p>Before</p>{{latestListings}}<p><a href="{{resetUrl}}">Reset</a></p>');

    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/tok");
    const html = String(outbox[0].html);
    expect(html).toContain("Newest Home");
    expect(html).toContain("Older Home");
    expect(html).not.toContain("Hidden Draft");
    expect(html).toContain('href="https://rebx.app/listings"');
    expect(html).toContain("Browse all properties");
    expect(html.indexOf("Before")).toBeLessThan(html.indexOf("Newest Home"));
    expect(html.indexOf("Newest Home")).toBeLessThan(html.indexOf("Reset</a>"));
  });

  it("is simply left out when there are no active listings", async () => {
    await publishResetBody('<p>Hi</p>{{latestListings}}<p><a href="{{resetUrl}}">Reset</a></p>');
    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/tok");
    const html = String(outbox[0].html);
    expect(html).not.toContain("Latest properties");
    expect(html).not.toContain("Browse all properties");
    expect(html).toContain("Reset</a>");
  });

  it("works inside a conditional and does not query listings for templates that don't use it", async () => {
    await listing({ title: "Cond Home" });
    await publishResetBody('{{#if latestListings}}<p>NEW:</p>{{latestListings}}{{/if}}<a href="{{resetUrl}}">Reset</a>');
    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/tok");
    expect(String(outbox[0].html)).toContain("NEW:");

    outbox.length = 0;
    const spy = vi.spyOn(prisma.listing, "findMany");
    await prisma.emailTemplate.deleteMany();
    invalidateTemplateCache();
    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/tok");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("previews with example.com sample links", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await prisma.emailTemplate.findUniqueOrThrow({ where: { key: "password_reset" } });
    const p = await svc.previewTemplate(admin, t.id, {
      name: t.name, description: "", category: "Account", subject: "Reset", htmlBody: '{{latestListings}}<a href="{{resetUrl}}">x</a>', textBody: "", fromName: "", fromEmail: "", replyTo: "", cc: "", bcc: "",
    }, { resetUrl: "https://example.com/r", latestListings: VARIABLES.latestListings.sample });
    expect(p.html).toContain("Lakeside Family Home");
    expect(p.html).toContain("https://example.com/sample/listings");
  });

  it("takes the site address from a link the email already carries, else the live site", () => {
    expect(siteBaseFrom({ resetUrl: "http://localhost:3000/reset-password/x" })).toBe("http://localhost:3000");
    expect(siteBaseFrom({ name: "Casey" })).toBe("https://rebx.app");
  });
});

describe("validation", () => {
  it("no longer warns about always-available variables that the body doesn't use", () => {
    const welcome = BUILT_IN_BY_KEY.welcome;
    const a = analyseContent({ key: "welcome", subject: welcome.subject, htmlBody: "<p>Hi {{name}}</p>" });
    expect(a.issues).toEqual([]);
  });
});
