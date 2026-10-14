import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { outbox } from "@/test/helpers";
import type { Actor } from "@/lib/permissions";
import { invalidateTemplateCache } from "@/lib/email/cache";
import { ConflictError, ForbiddenError, ValidationFailure } from "@/lib/email/errors";
import { DEFAULT_LAYOUT, composeEmail, normalizeLayout, safeLayout, validateLayout } from "@/lib/email/layout";
import * as layoutSvc from "@/lib/email/layout-service";
import * as svc from "@/lib/email/template-service";
import * as mail from "@/lib/email";

vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

const admin: Actor = { id: 920001, role: "ADMIN", email: "layout-admin@example.com" };
const admin2: Actor = { id: 920002, role: "ADMIN", email: "layout-admin2@example.com" };
const agent: Actor = { id: 920003, role: "AGENT", email: "layout-agent@example.com" };

describe("composeEmail (pure)", () => {
  it("wraps the body in a full document with logo, accent, card and footer", () => {
    const html = composeEmail("<p>BODY</p>", DEFAULT_LAYOUT, { subject: "Hello" });
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>Hello</title>");
    expect(html).toContain(`src="${DEFAULT_LAYOUT.logoUrl}"`);
    expect(html).toContain(`background-color:${DEFAULT_LAYOUT.accentColor}`);
    expect(html).toContain("<p>BODY</p>");
    expect(html).toContain(DEFAULT_LAYOUT.footerText.replace("&", "&amp;"));
    expect(html).toContain("max-width:600px");
    expect(html).not.toContain("mailto:"); // no support email configured by default
  });

  it("escapes every setting so an edit can't inject markup", () => {
    const html = composeEmail("<p>x</p>", {
      ...DEFAULT_LAYOUT,
      logoAlt: '"><script>alert(1)</script>',
      footerText: "<b>bold</b> & co",
      footerNote: "line1\nline2",
      supportEmail: "help@example.com",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; co");
    expect(html).toContain("line1<br>line2");
    expect(html).toContain('href="mailto:help@example.com"');
  });

  it("falls back per field when a value is invalid, never emitting it", () => {
    const html = composeEmail("<p>x</p>", { ...DEFAULT_LAYOUT, logoUrl: "javascript:alert(1)", accentColor: "red;}</style>", logoWidth: 99999 });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("red;}");
    expect(html).toContain(`src="${DEFAULT_LAYOUT.logoUrl}"`);
    expect(html).toContain(`width="${DEFAULT_LAYOUT.logoWidth}"`);
  });

  it("inserts a banner above the card and omits empty footer lines", () => {
    const html = composeEmail("<p>x</p>", { ...DEFAULT_LAYOUT, footerText: "", footerNote: "" }, { banner: "<div>TEST BANNER</div>" });
    expect(html.indexOf("TEST BANNER")).toBeLessThan(html.indexOf("<p>x</p>"));
    expect(html).not.toContain("font-size:12px;line-height:18px");
  });

  it("validates, normalizes and sanitizes untrusted input", () => {
    expect(validateLayout(DEFAULT_LAYOUT)).toEqual({});
    expect(Object.keys(validateLayout({ ...DEFAULT_LAYOUT, logoUrl: "http://x.test/a.png", logoWidth: 10, accentColor: "#12", supportEmail: "nope" })).sort())
      .toEqual(["accentColor", "logoUrl", "logoWidth", "supportEmail"]);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ logoWidth: "200", footerText: "  hi  " })).toMatchObject({ logoWidth: 200, footerText: "hi" });
    expect(safeLayout({ accentColor: "bad" }).accentColor).toBe(DEFAULT_LAYOUT.accentColor);
  });
});

describe("layout service", () => {
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [920001, 920002, 920003] } } });
    for (const [id, email, role] of [[920001, "layout-admin@example.com", "ADMIN"], [920002, "layout-admin2@example.com", "ADMIN"], [920003, "layout-agent@example.com", "AGENT"]] as const) {
      await prisma.user.create({ data: { id, name: email.split("@")[0], email, passwordHash: "x", role } });
    }
  });
  afterAll(async () => {
    await prisma.emailLayout.deleteMany();
    await prisma.emailTemplate.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    await prisma.user.deleteMany({ where: { id: { in: [920001, 920002, 920003] } } });
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.emailLayout.deleteMany();
    await prisma.emailTemplate.deleteMany();
    await prisma.adminAuditLog.deleteMany();
    outbox.length = 0;
    invalidateTemplateCache();
    vi.restoreAllMocks();
  });

  it("uses the default layout until something is saved", async () => {
    expect(await layoutSvc.loadLiveLayout()).toEqual(DEFAULT_LAYOUT);
    expect(await layoutSvc.getLayoutState(admin)).toMatchObject({ version: 0, isDefault: true });
  });

  it("saves, versions, audits and invalidates the cache so sends pick it up immediately", async () => {
    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/x"); // warms the cache
    expect(String(outbox[0].html)).toContain(DEFAULT_LAYOUT.accentColor);

    const saved = await layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, accentColor: "#1d4ed8", footerText: "Acme Realty" }, 0);
    expect(saved.version).toBe(1);

    outbox.length = 0;
    await mail.sendPasswordResetEmail("u@example.com", "https://rebx.app/reset-password/x");
    expect(String(outbox[0].html)).toContain("background-color:#1d4ed8");
    expect(String(outbox[0].html)).toContain("Acme Realty");

    const again = await layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, accentColor: "#1d4ed8" }, 1);
    expect(again.version).toBe(2);

    const audit = await prisma.adminAuditLog.findMany({ where: { action: "email_layout.updated" }, orderBy: { id: "asc" } });
    expect(audit).toHaveLength(2);
    expect(audit[0].actorId).toBe(admin.id);
    expect(JSON.stringify(audit[0].metadata)).toContain("#1d4ed8");
  });

  it("rejects invalid settings with field errors and saves nothing", async () => {
    await expect(layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, logoUrl: "http://insecure.test/x.png", accentColor: "blue" }, 0))
      .rejects.toMatchObject({ fieldErrors: { logoUrl: [expect.any(String)], accentColor: [expect.any(String)] } });
    await expect(layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, logoWidth: 5 }, 0)).rejects.toBeInstanceOf(ValidationFailure);
    expect(await prisma.emailLayout.count()).toBe(0);
  });

  it("refuses a stale save instead of overwriting another admin's change", async () => {
    await layoutSvc.saveLayout(admin, DEFAULT_LAYOUT, 0);
    await layoutSvc.saveLayout(admin2, { ...DEFAULT_LAYOUT, footerText: "Admin 2" }, 1);
    await expect(layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, footerText: "Admin 1" }, 1)).rejects.toBeInstanceOf(ConflictError);
    expect((await layoutSvc.getLayoutState(admin)).settings.footerText).toBe("Admin 2");
  });

  it("only lets one of two simultaneous first saves win", async () => {
    const results = await Promise.allSettled([
      layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, footerText: "A" }, 0),
      layoutSvc.saveLayout(admin2, { ...DEFAULT_LAYOUT, footerText: "B" }, 0),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.emailLayout.count()).toBe(1);
  });

  it("denies non-admins", async () => {
    await expect(layoutSvc.saveLayout(agent, DEFAULT_LAYOUT, 0)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(layoutSvc.getLayoutState(agent)).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => layoutSvc.previewLayout(agent, DEFAULT_LAYOUT)).toThrow(ForbiddenError);
  });

  it("previews with field errors instead of throwing on bad input", () => {
    const p = layoutSvc.previewLayout(admin, { ...DEFAULT_LAYOUT, accentColor: "nope" });
    expect(p.fieldErrors.accentColor).toBeDefined();
    expect(p.html).toContain("<!DOCTYPE html>");
    expect(p.html).not.toContain("nope");
  });

  it("falls back to the default when the stored row is corrupted", async () => {
    await prisma.emailLayout.create({ data: { key: "default", settings: { accentColor: "<script>", logoUrl: 5 }, version: 1 } });
    const live = await layoutSvc.loadLiveLayout();
    expect(live.accentColor).toBe(DEFAULT_LAYOUT.accentColor);
    expect(live.logoUrl).toBe(DEFAULT_LAYOUT.logoUrl);
  });

  it("applies to newly created templates in production sends, previews and test emails", async () => {
    await layoutSvc.saveLayout(admin, { ...DEFAULT_LAYOUT, footerText: "Layout Footer Marker" }, 0);
    await svc.ensureBuiltInTemplates(admin);
    const t = await svc.createTemplate(admin, { key: "promo_2026", event: "marketing.promo", name: "Promo", description: "", category: "Custom", subject: "Big news {{name}}" });

    const fields = { name: t.name, description: "", category: "Custom", subject: "Big news {{name}}", htmlBody: "<p>Hello {{name}} NEWBODY</p>", textBody: "", fromName: "", fromEmail: "", replyTo: "", cc: "", bcc: "" };
    const preview = await svc.previewTemplate(admin, t.id, fields, { name: "Casey" });
    expect(preview.html).toContain("Layout Footer Marker");
    expect(preview.html).toContain("NEWBODY");

    // Test emails (the only way a custom template is sent today) use the same layout, plus the banner.
    const res = await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", fields });
    expect(res.status).toBe("SENT");
    const html = String(outbox.at(-1)!.html);
    expect(html).toContain("Layout Footer Marker");
    expect(html).toContain("NEWBODY");
    expect(html).toContain(`src="${DEFAULT_LAYOUT.logoUrl}"`);
    expect(html).toMatch(/test email/i);
    // The text version is derived from the body only (no logo/footer noise).
    expect(String(outbox.at(-1)!.text ?? "")).not.toContain("Layout Footer Marker");
  });

  it("still sends the email with the default layout if the layout lookup fails", async () => {
    const m = await import("@/lib/email");
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const orig = prisma.emailLayout.findUnique;
    (prisma.emailLayout as { findUnique: unknown }).findUnique = () => { throw new Error("db down"); };
    try {
      expect(await layoutSvc.loadLiveLayout()).toEqual(DEFAULT_LAYOUT);
    } finally {
      (prisma.emailLayout as { findUnique: unknown }).findUnique = orig;
    }
    void m;
  });
});
