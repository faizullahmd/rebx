import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { outbox, resendBehavior } from "@/test/helpers";
import type { Actor } from "@/lib/permissions";
import { invalidateTemplateCache } from "@/lib/email/cache";
import {
  ConflictError, ForbiddenError, NotFoundError, RuleError, ValidationFailure,
} from "@/lib/email/errors";
import * as svc from "@/lib/email/template-service";
import * as mail from "@/lib/email";

vi.mock("resend", async () => (await import("@/test/helpers")).resendFactory());

const admin: Actor = { id: 910001, role: "ADMIN", email: "admin-test@example.com" };
const admin2: Actor = { id: 910002, role: "ADMIN", email: "admin2-test@example.com" };
const agent: Actor = { id: 910003, role: "AGENT", email: "agent-test@example.com" };
const customerEmail = "customer-test@example.com";

const baseFields = (over: Record<string, unknown> = {}) => ({
  name: "Welcome email", description: "d", category: "Account", subject: "Welcome {{name}}",
  htmlBody: "<p>Hi {{name}}, welcome aboard.</p>", textBody: "", fromName: "", fromEmail: "",
  replyTo: "", cc: "", bcc: "", ...over,
});

async function builtIn(key: string) {
  return prisma.emailTemplate.findUniqueOrThrow({ where: { key } });
}
async function tokensFor(id: number) {
  const s = await svc.getEditorState(admin, id);
  return s.tokens;
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [910001, 910002, 910003, 910004] } } });
  for (const [id, email, role] of [
    [910001, "admin-test@example.com", "ADMIN"], [910002, "admin2-test@example.com", "ADMIN"],
    [910003, "agent-test@example.com", "AGENT"], [910004, customerEmail, "CUSTOMER"],
  ] as const) {
    await prisma.user.create({ data: { id, name: email.split("@")[0], email, passwordHash: "x", role } });
  }
});
afterAll(async () => {
  await prisma.emailTestLog.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.user.deleteMany({ where: { id: { in: [910001, 910002, 910003, 910004] } } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.emailTestLog.deleteMany();
  await prisma.emailTemplate.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  outbox.length = 0;
  resendBehavior.failWith = null;
  invalidateTemplateCache();
  vi.restoreAllMocks();
});

describe("built-in seeding", () => {
  it("creates every built-in as a system template with a v1 SEED snapshot", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const rows = await prisma.emailTemplate.findMany({ include: { versions: true } });
    expect(rows).toHaveLength(9);
    expect(rows.every((r) => r.isSystem && r.status === "ACTIVE" && r.version === 1)).toBe(true);
    expect(rows.every((r) => r.versions.length === 1 && r.versions[0].action === "SEED")).toBe(true);
  });

  it("is idempotent and never overwrites an admin's edits", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "Edited {{name}}" }), await tokensFor(t.id));
    await svc.ensureBuiltInTemplates(admin);
    await svc.ensureBuiltInTemplates(admin);
    expect(await prisma.emailTemplate.count()).toBe(9);
    expect((await builtIn("welcome")).subject).toBe("Edited {{name}}");
  });

  it("survives two concurrent seed calls", async () => {
    await Promise.all([svc.ensureBuiltInTemplates(admin), svc.ensureBuiltInTemplates(admin)]);
    expect(await prisma.emailTemplate.count()).toBe(9);
  });
});

describe("create, uniqueness, duplicate, delete", () => {
  const input = { key: "promo_2026", event: "marketing.promo", name: "Promo", description: "", category: "Custom", subject: "Big news" };

  it("creates a custom template with a starter body and a CREATE version", async () => {
    const t = await svc.createTemplate(admin, input);
    expect(t).toMatchObject({ key: "promo_2026", isSystem: false, version: 1, status: "ACTIVE" });
    expect(t.htmlBody).toContain("<table");
    const versions = await prisma.emailTemplateVersion.findMany({ where: { templateId: t.id } });
    expect(versions.map((v) => v.action)).toEqual(["CREATE"]);
  });

  it("enforces unique keys (case-sensitive format, DB unique index)", async () => {
    await svc.createTemplate(admin, input);
    await expect(svc.createTemplate(admin, input)).rejects.toMatchObject({ fieldErrors: { key: [expect.stringMatching(/already exists/)] } });
    await expect(svc.createTemplate(admin, { ...input, key: "Promo_2026" })).rejects.toBeInstanceOf(ValidationFailure);
  });

  it("keeps keys unique under concurrent creation", async () => {
    const results = await Promise.allSettled([svc.createTemplate(admin, input), svc.createTemplate(admin2, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.emailTemplate.count({ where: { key: "promo_2026" } })).toBe(1);
  });

  it("reserves built-in keys", async () => {
    await expect(svc.createTemplate(admin, { ...input, key: "password_reset" })).rejects.toMatchObject({ fieldErrors: { key: [expect.stringMatching(/reserved/)] } });
  });

  it("duplicates as an inactive custom copy with a unique key, and increments on repeat", async () => {
    const t = await svc.createTemplate(admin, input);
    const a = await svc.duplicateTemplate(admin, t.id);
    const b = await svc.duplicateTemplate(admin, t.id);
    expect(a).toMatchObject({ key: "promo_2026_copy", status: "INACTIVE", isSystem: false, version: 1 });
    expect(b.key).toBe("promo_2026_copy2");
    expect(a.htmlBody).toBe(t.htmlBody);
  });

  it("duplicating a system template yields a non-system copy", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const copy = await svc.duplicateTemplate(admin, (await builtIn("welcome")).id);
    expect(copy.isSystem).toBe(false);
    expect(copy.key).toBe("welcome_copy");
  });

  it("deletes custom templates (with versions) but never system ones", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await svc.createTemplate(admin, input);
    await svc.deleteTemplate(admin, t.id);
    expect(await prisma.emailTemplate.findUnique({ where: { id: t.id } })).toBeNull();
    expect(await prisma.emailTemplateVersion.count({ where: { templateId: t.id } })).toBe(0);
    await expect(svc.deleteTemplate(admin, (await builtIn("welcome")).id)).rejects.toBeInstanceOf(RuleError);
  });
});

describe("activate / deactivate", () => {
  it("toggles status and refuses to deactivate critical built-ins", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const welcome = await builtIn("welcome");
    expect((await svc.setTemplateStatus(admin, welcome.id, "INACTIVE")).status).toBe("INACTIVE");
    expect((await svc.setTemplateStatus(admin, welcome.id, "ACTIVE")).status).toBe("ACTIVE");
    await expect(svc.setTemplateStatus(admin, (await builtIn("password_reset")).id, "INACTIVE")).rejects.toMatchObject({ name: "RuleError" });
    await expect(svc.setTemplateStatus(admin, (await builtIn("developer_welcome")).id, "INACTIVE")).rejects.toBeInstanceOf(RuleError);
  });
});

describe("draft and publish workflow", () => {
  it("production keeps sending the PUBLISHED version until the draft is published", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.saveDraft(admin, t.id, baseFields({ subject: "DRAFT subject {{name}}", htmlBody: "<p>draft {{name}}</p>" }), await tokensFor(t.id));

    await mail.sendWelcomeEmail("new@example.com", "Casey");
    expect(outbox[0].subject).toBe("Welcome to REBX"); // still the original
    expect(outbox[0].html).toContain("Your REBX account is ready");

    outbox.length = 0;
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "PUBLISHED subject {{name}}", htmlBody: "<p>live {{name}}</p>" }), await tokensFor(t.id), "Reworded");
    await mail.sendWelcomeEmail("new@example.com", "Casey");
    expect(outbox[0].subject).toBe("PUBLISHED subject Casey");
    expect(outbox[0].html).toBe("<p>live Casey</p>");
  });

  it("publishing bumps the version, records history and clears the draft", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.saveDraft(admin, t.id, baseFields(), await tokensFor(t.id));
    const res = await svc.publishTemplate(admin, t.id, baseFields({ subject: "v2 {{name}}" }), await tokensFor(t.id), "  Tweaked the subject  ");
    expect(res.template.version).toBe(2);
    expect(await prisma.emailTemplateDraft.count({ where: { templateId: t.id } })).toBe(0);
    const versions = await svc.listVersions(admin, t.id);
    expect(versions.map((v) => [v.version, v.action])).toEqual([[2, "PUBLISH"], [1, "SEED"]]);
    expect(versions[0]).toMatchObject({ changeSummary: "Tweaked the subject", subject: "v2 {{name}}" });
    expect(versions[0].createdBy?.name).toBe("admin-test");
  });

  it("blocks publishing content with unknown variables or a missing critical placeholder", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const w = await builtIn("welcome");
    await expect(svc.publishTemplate(admin, w.id, baseFields({ htmlBody: "<p>{{nmae}}</p>" }), await tokensFor(w.id))).rejects.toMatchObject({ fieldErrors: { content: [expect.stringMatching(/did you mean \{\{name\}\}/)] } });
    const r = await builtIn("password_reset");
    await expect(svc.publishTemplate(admin, r.id, baseFields({ subject: "Reset", htmlBody: "<p>no link</p>" }), await tokensFor(r.id))).rejects.toMatchObject({ fieldErrors: { content: [expect.stringMatching(/resetUrl/)] } });
    expect((await builtIn("welcome")).version).toBe(1);
  });

  it("allows saving a draft that still has placeholder problems (work in progress)", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const w = await builtIn("welcome");
    const saved = await svc.saveDraft(admin, w.id, baseFields({ htmlBody: "<p>{{nmae}}</p>" }), await tokensFor(w.id));
    expect(saved.issues.some((i) => i.code === "unknown_variable")).toBe(true);
  });

  it("sanitizes HTML on save and reports what was removed", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const w = await builtIn("welcome");
    const res = await svc.publishTemplate(admin, w.id, baseFields({ htmlBody: '<p onclick="x()">Hi {{name}}</p><script>alert(1)</script>' }), await tokensFor(w.id));
    expect(res.template.htmlBody).toBe("<p>Hi {{name}}</p>");
    expect(res.warnings.join(" ")).toMatch(/script/i);
  });

  it("applies cc, bcc, reply-to, sender name and plain text to production sends", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const w = await builtIn("welcome");
    await svc.publishTemplate(admin, w.id, baseFields({ cc: "a@x.com", bcc: "b@x.com, c@x.com", replyTo: "help@x.com", fromName: "REBX Team", textBody: "Hi {{name}} (text)" }), await tokensFor(w.id));
    await mail.sendWelcomeEmail("new@example.com", "Casey");
    expect(outbox[0]).toMatchObject({
      from: "REBX Team <onboarding@resend.dev>", cc: ["a@x.com"], bcc: ["b@x.com", "c@x.com"], replyTo: "help@x.com", text: "Hi Casey (text)",
    });
  });
});

describe("concurrency", () => {
  it("rejects a publish based on a stale version instead of overwriting", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const stale = await tokensFor(t.id);
    await svc.publishTemplate(admin2, t.id, baseFields({ subject: "from admin2 {{name}}" }), stale);
    await expect(svc.publishTemplate(admin, t.id, baseFields({ subject: "from admin1 {{name}}" }), stale)).rejects.toBeInstanceOf(ConflictError);
    expect((await builtIn("welcome")).subject).toBe("from admin2 {{name}}");
  });

  it("only one of two simultaneous publishes wins", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const tokens = await tokensFor(t.id);
    const results = await Promise.allSettled([
      svc.publishTemplate(admin, t.id, baseFields({ subject: "A {{name}}" }), tokens),
      svc.publishTemplate(admin2, t.id, baseFields({ subject: "B {{name}}" }), tokens),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await builtIn("welcome")).version).toBe(2);
    expect(await prisma.emailTemplateVersion.count({ where: { templateId: t.id } })).toBe(2);
  });

  it("rejects saving over a draft another admin saved in the meantime", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const before = await tokensFor(t.id);
    await svc.saveDraft(admin2, t.id, baseFields({ subject: "theirs {{name}}" }), before);
    await expect(svc.saveDraft(admin, t.id, baseFields({ subject: "mine {{name}}" }), before)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.publishTemplate(admin, t.id, baseFields({ subject: "mine {{name}}" }), before)).rejects.toBeInstanceOf(ConflictError);
    expect((await prisma.emailTemplateDraft.findUniqueOrThrow({ where: { templateId: t.id } })).subject).toBe("theirs {{name}}");
  });

  it("invalidates the production cache on publish, status change and restore", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await mail.sendWelcomeEmail("a@example.com", "A"); // primes the cache with v1
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "fresh {{name}}" }), await tokensFor(t.id));
    await mail.sendWelcomeEmail("a@example.com", "A");
    expect(outbox[1].subject).toBe("fresh A");
    await svc.setTemplateStatus(admin, t.id, "INACTIVE");
    outbox.length = 0;
    await mail.sendWelcomeEmail("a@example.com", "A");
    expect(outbox).toHaveLength(0); // deactivated: not sent
  });
});

describe("version history and restore", () => {
  it("restores an earlier version as a NEW version and clears any draft", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const original = t.htmlBody;
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "v2 {{name}}", htmlBody: "<p>v2 {{name}}</p>" }), await tokensFor(t.id));
    await svc.saveDraft(admin, t.id, baseFields({ subject: "wip {{name}}" }), await tokensFor(t.id));

    const restored = await svc.restoreVersion(admin, t.id, 1, 2);
    expect(restored.version).toBe(3);
    expect(restored.subject).toBe("Welcome to REBX");
    expect(restored.htmlBody).toBe(original);
    expect(await prisma.emailTemplateDraft.count({ where: { templateId: t.id } })).toBe(0);
    const v3 = await prisma.emailTemplateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: t.id, version: 3 } } });
    expect(v3).toMatchObject({ action: "RESTORE", restoredFromVersion: 1 });

    outbox.length = 0;
    await mail.sendWelcomeEmail("a@example.com", "Casey");
    expect(outbox[0].subject).toBe("Welcome to REBX");
  });

  it("refuses to restore with a stale version or a missing version", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "v2 {{name}}" }), await tokensFor(t.id));
    await expect(svc.restoreVersion(admin, t.id, 1, 1)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.restoreVersion(admin, t.id, 99, 2)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("preview", () => {
  it("renders with sample data and the same engine, flagging missing and unknown variables", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("new_lead");
    const ok = await svc.previewTemplate(admin, t.id, baseFields({ subject: "New inquiry: {{listingTitle}}", htmlBody: "<p>{{contactName}} {{#if message}}says {{message}}{{/if}}</p>" }), { contactName: "Taylor", listingTitle: "Condo", contactEmail: "t@x.com", dealUrl: "https://example.com/d", message: "hello <b>x</b>" });
    expect(ok.subject).toBe("New inquiry: Condo");
    expect(ok.html).toBe("<p>Taylor says hello &lt;b&gt;x&lt;/b&gt;</p>");

    const broken = await svc.previewTemplate(admin, t.id, baseFields({ htmlBody: "<p>{{contactName}} {{nope}}</p>" }), {});
    expect(broken.html).toContain("missing: contactName");
    expect(broken.html).toContain("unknown: nope");
    expect(broken.issues.length).toBeGreaterThan(0);
  });

  it("strips unsafe HTML from the preview exactly as it will be stripped on save", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const p = await svc.previewTemplate(admin, t.id, baseFields({ htmlBody: '<p>x</p><script>alert(1)</script><img src="javascript:alert(1)">' }), { name: "A" });
    expect(p.html).toBe("<p>x</p>");
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it("generates a plain-text version when none is set and says so", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const p = await svc.previewTemplate(admin, t.id, baseFields({ htmlBody: "<p>Hi {{name}}</p>" }), { name: "Casey" });
    expect(p).toMatchObject({ text: "Hi Casey", textIsGenerated: true });
  });
});

describe("test emails", () => {
  const fields = () => baseFields();

  it("sends a clearly labelled test using sample data and logs it", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const res = await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", fields: fields() });
    expect(res.status).toBe("SENT");
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe("me@example.com");
    expect(outbox[0].subject).toBe("[TEST] Welcome Casey Customer");
    expect(outbox[0].html).toContain("TEST EMAIL");
    const log = await prisma.emailTestLog.findFirstOrThrow({ where: { templateId: t.id } });
    expect(log).toMatchObject({ status: "SENT", recipient: "me@example.com", templateVersion: 1, templateKey: "welcome", usedDraft: true });
    expect(log.sentById).toBe(admin.id);
    expect(await prisma.adminAuditLog.count({ where: { action: "email_template.test_sent" } })).toBe(1);
  });

  it("records provider failures and never throws them to the admin as a crash", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    resendBehavior.failWith = "Invalid `to` field. key re_abcdefghij123456 rejected";
    const res = await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", fields: fields() });
    expect(res.status).toBe("FAILED");
    expect(res.error).not.toContain("re_abcdefghij123456"); // API key-looking strings are scrubbed
    expect((await prisma.emailTestLog.findFirstOrThrow()).status).toBe("FAILED");
    expect(outbox).toHaveLength(0);
  });

  it("handles a thrown transport error", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const transport = await import("@/lib/email/transport");
    vi.spyOn(transport, "deliver").mockRejectedValueOnce(new Error("network down"));
    const res = await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com" });
    expect(res).toMatchObject({ status: "FAILED", error: "network down" });
  });

  it("validates the recipient", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    for (const recipient of ["", "nope", "a@b", "a@b.com, c@d.com", "<a@b.com>"]) {
      await expect(svc.sendTestEmail(admin, t.id, { recipient })).rejects.toBeInstanceOf(ValidationFailure);
    }
  });

  it("won't email an existing customer/agent account without explicit confirmation", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await expect(svc.sendTestEmail(admin, t.id, { recipient: customerEmail })).rejects.toMatchObject({ name: "RuleError" });
    expect(outbox).toHaveLength(0);
    expect((await svc.sendTestEmail(admin, t.id, { recipient: customerEmail, confirmAccountRecipient: true })).status).toBe("SENT");
    // an admin's own address needs no confirmation
    expect((await svc.sendTestEmail(admin, t.id, { recipient: admin.email! })).status).toBe("SENT");
  });

  it("only allows example.com links in test data so a test can't trigger a real action", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("password_reset");
    await expect(svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", data: { resetUrl: "https://rebx.app/reset-password/REAL" } })).rejects.toMatchObject({ fieldErrors: { data: [expect.stringMatching(/example\.com/)] } });
    expect(outbox).toHaveLength(0);
    expect((await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com" })).status).toBe("SENT");
    expect(outbox[0].html).toContain("https://example.com/sample/reset-password/SAMPLE-TOKEN");
  });

  it("refuses to send when the template can't render, instead of sending a broken email", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await expect(svc.sendTestEmail(admin, t.id, { recipient: "me@example.com", fields: baseFields({ htmlBody: "<p>{{nmae}}</p>" }) })).rejects.toBeInstanceOf(ValidationFailure);
    expect(outbox).toHaveLength(0);
  });

  it("rate-limits test sends per admin", async () => {
    await svc.ensureBuiltInTemplates(admin2);
    const t = await builtIn("welcome");
    for (let i = 0; i < 10; i++) await svc.sendTestEmail(admin2, t.id, { recipient: "me@example.com" });
    await expect(svc.sendTestEmail(admin2, t.id, { recipient: "me@example.com" })).rejects.toThrow(/limit/i);
  });

  it("does not touch any business data (no users, deals or tokens are created)", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("password_reset");
    const before = [await prisma.user.count(), await prisma.passwordResetToken.count(), await prisma.deal.count()];
    await svc.sendTestEmail(admin, t.id, { recipient: "me@example.com" });
    expect([await prisma.user.count(), await prisma.passwordResetToken.count(), await prisma.deal.count()]).toEqual(before);
  });
});

describe("permissions", () => {
  it("denies every operation to non-admin roles", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    const tokens = await tokensFor(t.id);
    const calls: Array<() => Promise<unknown>> = [
      () => svc.listTemplates(agent),
      () => svc.getEditorState(agent, t.id),
      () => svc.listVersions(agent, t.id),
      () => svc.createTemplate(agent, { key: "abc_def", event: "a.b", name: "Name", category: "Custom", subject: "s" }),
      () => svc.duplicateTemplate(agent, t.id),
      () => svc.deleteTemplate(agent, t.id),
      () => svc.setTemplateStatus(agent, t.id, "INACTIVE"),
      () => svc.saveDraft(agent, t.id, baseFields(), tokens),
      () => svc.publishTemplate(agent, t.id, baseFields(), tokens),
      () => svc.restoreVersion(agent, t.id, 1, 1),
      () => svc.previewTemplate(agent, t.id, baseFields(), {}),
      () => svc.sendTestEmail(agent, t.id, { recipient: "me@example.com" }),
    ];
    for (const call of calls) await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    expect(outbox).toHaveLength(0);
    expect((await builtIn("welcome")).version).toBe(1);
  });
});

describe("audit log", () => {
  it("records who did what for every administrative change", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.saveDraft(admin, t.id, baseFields(), await tokensFor(t.id));
    await svc.publishTemplate(admin, t.id, baseFields({ subject: "x {{name}}" }), await tokensFor(t.id));
    await svc.setTemplateStatus(admin, t.id, "INACTIVE");
    await svc.restoreVersion(admin, t.id, 1, 2);
    const copy = await svc.duplicateTemplate(admin, t.id);
    await svc.deleteTemplate(admin, copy.id);
    const actions = (await prisma.adminAuditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      "email_template.draft_saved", "email_template.published", "email_template.deactivated",
      "email_template.restored", "email_template.duplicated", "email_template.deleted",
    ]));
    const entry = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "email_template.published" } });
    expect(entry).toMatchObject({ actorId: admin.id, actorEmail: admin.email, entityType: "EmailTemplate", entityId: String(t.id) });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/htmlBody|password|secret|re_/);
  });
});

describe("listing", () => {
  it("searches, filters, sorts and paginates", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const custom = await svc.createTemplate(admin, { key: "promo_2026", event: "marketing.promo", name: "Zebra Promo", category: "Custom", subject: "Sale now" });
    await svc.setTemplateStatus(admin, (await builtIn("welcome")).id, "INACTIVE");

    expect((await svc.listTemplates(admin, { q: "sale now" })).items.map((i) => i.key)).toEqual(["promo_2026"]);
    expect((await svc.listTemplates(admin, { q: "password_reset" })).total).toBe(1);
    expect((await svc.listTemplates(admin, { q: "Reset your REBX" })).total).toBe(1); // by subject
    expect((await svc.listTemplates(admin, { category: "Account" })).items.every((i) => i.category === "Account")).toBe(true);
    expect((await svc.listTemplates(admin, { status: "INACTIVE" })).items.map((i) => i.key)).toEqual(["welcome"]);
    expect((await svc.listTemplates(admin, { event: "marketing.promo" })).items[0].id).toBe(custom.id);

    const byName = (await svc.listTemplates(admin, { sort: "name", dir: "desc" })).items.map((i) => i.name);
    expect(byName).toEqual([...byName].sort().reverse());

    const p1 = await svc.listTemplates(admin, { pageSize: 4, page: 1 });
    const p3 = await svc.listTemplates(admin, { pageSize: 4, page: 3 });
    expect([p1.total, p1.pageCount, p1.items.length, p3.items.length]).toEqual([10, 3, 4, 2]);
  });

  it("surfaces who last updated a template and whether it has a draft", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    await svc.saveDraft(admin2, t.id, baseFields(), await tokensFor(t.id));
    await svc.publishTemplate(admin2, t.id, baseFields({ subject: "z {{name}}" }), await tokensFor(t.id));
    await svc.saveDraft(admin, t.id, baseFields(), await tokensFor(t.id));
    const row = (await svc.listTemplates(admin, { q: "welcome" })).items.find((i) => i.key === "welcome")!;
    expect(row.updatedBy?.name).toBe("admin2-test");
    expect(row.draft).not.toBeNull();
  });
});

describe("production sends", () => {
  it("falls back to the built-in default if a published template can't render", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const t = await builtIn("welcome");
    // Simulate bad data that slipped past validation (e.g. a manual database edit).
    await prisma.emailTemplate.update({ where: { id: t.id }, data: { htmlBody: "<p>{{totallyUnknown}}</p>" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await mail.sendWelcomeEmail("a@example.com", "Casey");
    expect(outbox[0].html).toContain("Your REBX account is ready");
    expect(err).toHaveBeenCalled();
  });

  it("falls back to the built-in default if the database is unavailable", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Simulate the outage in an isolated module graph so the shared Prisma client is never touched.
    vi.resetModules();
    vi.doMock("@/lib/prisma", () => ({
      prisma: { emailTemplate: { findUnique: async () => { throw new Error("db down"); } } },
    }));
    try {
      const freshMail = await import("@/lib/email");
      const freshHelpers = await import("@/test/helpers");
      freshHelpers.outbox.length = 0;
      await freshMail.sendWelcomeEmail("a@example.com", "Casey");
      // The mocked Resend may be shared with the original graph, so look in both outboxes.
      const sent = [...freshHelpers.outbox, ...outbox];
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toBe("Welcome to REBX");
      expect(sent[0].html).toContain("Your REBX account is ready");
      expect(err).toHaveBeenCalledWith(expect.stringContaining("lookup failed"), expect.any(Error));
    } finally {
      vi.doUnmock("@/lib/prisma");
      vi.resetModules();
    }
  });

  it("fails loudly (rather than send a broken email) when the caller omits a required value", async () => {
    await svc.ensureBuiltInTemplates(admin);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(mail.sendPasswordResetEmail("a@example.com", "")).rejects.toThrow(/resetUrl/);
    expect(outbox).toHaveLength(0);
    expect(err).toHaveBeenCalled(); // the database template failed, then the default failed too
  });

  it("matches the legacy output when templates come from the database too", async () => {
    await svc.ensureBuiltInTemplates(admin);
    // Prove this really exercises the database path, not the built-in fallback.
    const { loadLiveTemplate } = await import("@/lib/email/live");
    expect((await loadLiveTemplate("new_lead"))?.source).toBe("database");
    await mail.sendNewLeadNotification("agent@example.com", { listingTitle: "Downtown 2BR Condo", contactName: "Taylor Prospect", contactEmail: "taylor@example.com", contactPhone: "555-0101", message: "Is this still available? <b>Please</b> reply & call.", dealUrl: "https://rebx.app/agent/dashboard/deals/7" });
    const golden = (await import("../__fixtures__/legacy-email-payloads.json")).default as { label: string; payload: unknown }[];
    expect(outbox[0]).toEqual(golden.find((g) => g.label === "new_lead_full")!.payload);
  });
});
