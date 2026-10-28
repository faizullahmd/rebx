import "server-only";
import { Prisma, type EmailTemplateStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { isBlocked, recordFailure } from "@/lib/rate-limit";
import {
  BUILT_IN_BY_KEY,
  BUILT_IN_TEMPLATES,
  STARTER_HTML,
  VARIABLES,
  sampleDataFor,
  variablesForTemplate,
} from "@/lib/email/definitions";
import { invalidateTemplateCache } from "@/lib/email/cache";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleError,
  ValidationFailure,
} from "@/lib/email/errors";
import { composeEmail } from "@/lib/email/layout";
import { loadLiveLayout } from "@/lib/email/layout-service";
import { renderParts } from "@/lib/email/pipeline";
import { TemplateRenderError, escapeHtml, type RenderIssue, type TemplateData } from "@/lib/email/render";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { buildFromHeader, parseEmailList } from "@/lib/email/sender";
import { htmlToText } from "@/lib/email/text";
import { deliver } from "@/lib/email/transport";
import {
  analyseContent,
  contentFieldsSchema,
  createFieldsSchema,
  flattenErrors,
  type ContentFields,
} from "@/lib/email/validate";

// ----------------------------------------------------------------------------------------
// Shared helpers
// ----------------------------------------------------------------------------------------

function assertPermission(actor: Actor, permission: Permission) {
  if (!hasPermission(actor, permission)) throw new ForbiddenError();
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const stamp = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface ConcurrencyTokens {
  /** EmailTemplate.version the editor loaded. */
  expectedVersion: number;
  /** ISO updatedAt of the draft the editor loaded, or null if there was none. */
  expectedDraftStamp: string | null;
}

const CONTENT_KEYS = [
  "name", "description", "category", "subject", "htmlBody", "textBody",
  "fromName", "fromEmail", "replyTo", "cc", "bcc",
] as const;

type SnapshotFields = Pick<ContentFields, (typeof CONTENT_KEYS)[number]>;

function pickContent<T extends Record<string, unknown>>(row: T): SnapshotFields {
  return Object.fromEntries(CONTENT_KEYS.map((k) => [k, row[k] ?? null])) as unknown as SnapshotFields;
}

export interface PreparedFields {
  fields: ContentFields;
  /** Notes about unsafe HTML that was stripped. */
  warnings: string[];
  /** Placeholder problems (unknown/misspelled variables, missing required ones...). */
  issues: RenderIssue[];
}

/** Validates, sanitizes and analyses editor input. Always run server-side, never trusted from the client. */
export function prepareFields(key: string, raw: unknown): PreparedFields {
  const parsed = contentFieldsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationFailure(flattenErrors(parsed.error));

  const sanitized = sanitizeEmailHtml(parsed.data.htmlBody);
  if (!sanitized.html.trim()) {
    throw new ValidationFailure({ htmlBody: ["Email content is empty after removing unsafe content."] });
  }
  const fields = { ...parsed.data, htmlBody: sanitized.html };
  const analysis = analyseContent({
    key,
    subject: fields.subject,
    htmlBody: fields.htmlBody,
    textBody: fields.textBody,
  });
  return { fields, warnings: sanitized.warnings, issues: analysis.issues };
}

function requireValid(prepared: PreparedFields) {
  const errors = prepared.issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new ValidationFailure(
      { content: errors.map((e) => e.message) },
      "This template has placeholder problems that must be fixed before publishing."
    );
  }
}

async function loadTemplate(id: number) {
  const template = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!template) throw new NotFoundError();
  return template;
}

// ----------------------------------------------------------------------------------------
// Seeding the built-in templates (idempotent, never overwrites admin edits)
// ----------------------------------------------------------------------------------------

export async function ensureBuiltInTemplates(actor?: Actor | null) {
  // Clean up any obsolete system templates no longer present in BUILT_IN_TEMPLATES (e.g. showing_status_update)
  const obsoleteSystem = await prisma.emailTemplate.findMany({
    where: {
      isSystem: true,
      key: { notIn: BUILT_IN_TEMPLATES.map((t) => t.key) },
    },
    select: { id: true },
  });
  if (obsoleteSystem.length > 0) {
    const obsoleteIds = obsoleteSystem.map((t) => t.id);
    await prisma.emailTemplateVersion.deleteMany({
      where: { templateId: { in: obsoleteIds } },
    });
    await prisma.emailTemplate.deleteMany({
      where: { id: { in: obsoleteIds } },
    });
    invalidateTemplateCache();
  }

  const existing = new Set(
    (await prisma.emailTemplate.findMany({ where: { isSystem: true }, select: { key: true } })).map((t) => t.key)
  );
  for (const def of BUILT_IN_TEMPLATES) {
    if (existing.has(def.key)) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.emailTemplate.create({
          data: {
            key: def.key,
            name: def.name,
            description: def.description,
            category: def.category,
            event: def.event,
            isSystem: true,
            subject: def.subject,
            htmlBody: def.html,
            version: 1,
            createdById: actor?.id ?? null,
            updatedById: actor?.id ?? null,
          },
        });
        await tx.emailTemplateVersion.create({
          data: {
            templateId: created.id,
            version: 1,
            action: "SEED",
            name: def.name,
            description: def.description,
            category: def.category,
            subject: def.subject,
            htmlBody: def.html,
            changeSummary: "Initial built-in template (matches the previous hardcoded email).",
            createdById: actor?.id ?? null,
          },
        });
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // another request seeded it first
    }
  }
}

// ----------------------------------------------------------------------------------------
// Listing
// ----------------------------------------------------------------------------------------

export interface ListParams {
  q?: string;
  category?: string;
  status?: string;
  event?: string;
  sort?: "name" | "updatedAt" | "category";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export async function listTemplates(actor: Actor, params: ListParams = {}) {
  assertPermission(actor, "email.view");
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

  const where: Prisma.EmailTemplateWhereInput = {
    ...(params.category ? { category: params.category } : {}),
    ...(params.status === "ACTIVE" || params.status === "INACTIVE" ? { status: params.status } : {}),
    ...(params.event ? { event: params.event } : {}),
    ...(params.q
      ? { OR: [{ name: { contains: params.q } }, { key: { contains: params.q } }, { subject: { contains: params.q } }] }
      : {}),
  };
  const sort = params.sort ?? "updatedAt";
  const dir = params.dir ?? (sort === "updatedAt" ? "desc" : "asc");

  const [total, items, categories, events] = await Promise.all([
    prisma.emailTemplate.count({ where }),
    prisma.emailTemplate.findMany({
      where,
      orderBy: [{ [sort]: dir }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        updatedBy: { select: { name: true } },
        draft: { select: { id: true } },
      },
    }),
    prisma.emailTemplate.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.emailTemplate.findMany({ distinct: ["event"], select: { event: true }, orderBy: { event: "asc" } }),
  ]);

  return {
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    categories: categories.map((c) => c.category),
    events: events.map((e) => e.event),
    items,
  };
}

// ----------------------------------------------------------------------------------------
// Reading one template
// ----------------------------------------------------------------------------------------

export async function getEditorState(actor: Actor, id: number) {
  assertPermission(actor, "email.view");
  const template = await prisma.emailTemplate.findUnique({
    where: { id },
    include: {
      updatedBy: { select: { name: true } },
      draft: { include: { updatedBy: { select: { name: true } } } },
    },
  });
  if (!template) throw new NotFoundError();

  const source = template.draft ?? template;
  return {
    template,
    draft: template.draft,
    working: pickContent(source as unknown as Record<string, unknown>),
    tokens: {
      expectedVersion: template.version,
      expectedDraftStamp: stamp(template.draft?.updatedAt),
    } satisfies ConcurrencyTokens,
    definition: BUILT_IN_BY_KEY[template.key] ?? null,
  };
}

export async function listVersions(actor: Actor, id: number) {
  assertPermission(actor, "email.view");
  await loadTemplate(id);
  return prisma.emailTemplateVersion.findMany({
    where: { templateId: id },
    orderBy: { version: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
}

export async function listTemplateAudit(actor: Actor, id: number, take = 25) {
  assertPermission(actor, "email.view");
  return prisma.adminAuditLog.findMany({
    where: { entityType: "EmailTemplate", entityId: String(id) },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { name: true } } },
  });
}

export async function listTestLogs(actor: Actor, id: number, take = 15) {
  assertPermission(actor, "email.view");
  return prisma.emailTestLog.findMany({
    where: { templateId: id },
    orderBy: { createdAt: "desc" },
    take,
    include: { sentBy: { select: { name: true } } },
  });
}

// ----------------------------------------------------------------------------------------
// Create / duplicate / delete / status
// ----------------------------------------------------------------------------------------

export async function createTemplate(actor: Actor, raw: unknown) {
  assertPermission(actor, "email.manage");
  const parsed = createFieldsSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationFailure(flattenErrors(parsed.error));
  const input = parsed.data;

  if (BUILT_IN_BY_KEY[input.key]) {
    throw new ValidationFailure({ key: ["That key is reserved for a built-in template."] });
  }
  const analysis = analyseContent({ key: input.key, subject: input.subject, htmlBody: STARTER_HTML });
  if (analysis.hasErrors) {
    throw new ValidationFailure({ subject: analysis.issues.filter((i) => i.severity === "error").map((i) => i.message) });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.emailTemplate.create({
        data: {
          key: input.key,
          event: input.event,
          name: input.name,
          description: input.description,
          category: input.category,
          subject: input.subject,
          htmlBody: STARTER_HTML,
          isSystem: false,
          version: 1,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await tx.emailTemplateVersion.create({
        data: {
          templateId: created.id,
          version: 1,
          action: "CREATE",
          name: created.name,
          description: created.description,
          category: created.category,
          subject: created.subject,
          htmlBody: created.htmlBody,
          changeSummary: "Template created.",
          createdById: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: "email_template.created",
        entityType: "EmailTemplate",
        entityId: created.id,
        summary: `Created email template "${created.key}".`,
        metadata: { key: created.key },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ValidationFailure({ key: ["A template with this key already exists."] });
    }
    throw error;
  }
}

export async function duplicateTemplate(actor: Actor, id: number) {
  assertPermission(actor, "email.manage");
  const source = await loadTemplate(id);

  for (let attempt = 1; attempt <= 20; attempt++) {
    const suffix = attempt === 1 ? "_copy" : `_copy${attempt}`;
    const key = `${source.key}${suffix}`.slice(0, 64);
    if (BUILT_IN_BY_KEY[key] || (await prisma.emailTemplate.findUnique({ where: { key }, select: { id: true } }))) {
      continue;
    }
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.emailTemplate.create({
          data: {
            key,
            event: source.event,
            name: `${source.name} (copy)`.slice(0, 120),
            description: source.description,
            category: source.category,
            subject: source.subject,
            htmlBody: source.htmlBody,
            textBody: source.textBody,
            fromName: source.fromName,
            fromEmail: source.fromEmail,
            replyTo: source.replyTo,
            cc: source.cc,
            bcc: source.bcc,
            isSystem: false,
            // A copy is never live by accident: it starts inactive.
            status: "INACTIVE",
            version: 1,
            createdById: actor.id,
            updatedById: actor.id,
          },
        });
        await tx.emailTemplateVersion.create({
          data: {
            templateId: created.id,
            version: 1,
            action: "CREATE",
            ...pickContent(created as unknown as Record<string, unknown>),
            changeSummary: `Duplicated from "${source.key}" (v${source.version}).`,
            createdById: actor.id,
          },
        });
        await recordAudit(tx, actor, {
          action: "email_template.duplicated",
          entityType: "EmailTemplate",
          entityId: created.id,
          summary: `Duplicated "${source.key}" as "${created.key}".`,
          metadata: { sourceId: source.id, key: created.key },
        });
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new RuleError("Couldn't find a free key for the copy. Rename an existing copy first.");
}

export async function deleteTemplate(actor: Actor, id: number) {
  assertPermission(actor, "email.manage");
  const template = await loadTemplate(id);
  if (template.isSystem) {
    throw new RuleError("Built-in templates can't be deleted. Deactivate it instead (if allowed).");
  }
  await prisma.$transaction(async (tx) => {
    await tx.emailTemplate.delete({ where: { id } });
    await recordAudit(tx, actor, {
      action: "email_template.deleted",
      entityType: "EmailTemplate",
      entityId: id,
      summary: `Deleted email template "${template.key}".`,
      metadata: { key: template.key, version: template.version },
    });
  });
  invalidateTemplateCache(template.key);
}

export async function setTemplateStatus(actor: Actor, id: number, status: EmailTemplateStatus) {
  assertPermission(actor, "email.manage");
  const template = await loadTemplate(id);
  if (template.status === status) return template;
  if (status === "INACTIVE" && BUILT_IN_BY_KEY[template.key]?.critical) {
    throw new RuleError(
      `"${template.name}" is critical (people can't sign in or get access without it) and can't be deactivated.`
    );
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.emailTemplate.update({ where: { id }, data: { status, updatedById: actor.id } });
    await recordAudit(tx, actor, {
      action: status === "ACTIVE" ? "email_template.activated" : "email_template.deactivated",
      entityType: "EmailTemplate",
      entityId: id,
      summary: `${status === "ACTIVE" ? "Activated" : "Deactivated"} email template "${template.key}".`,
      metadata: { key: template.key },
    });
    return row;
  });
  invalidateTemplateCache(template.key);
  return updated;
}

// ----------------------------------------------------------------------------------------
// Drafts, publishing, restoring
// ----------------------------------------------------------------------------------------

async function assertTokens(
  tx: Prisma.TransactionClient,
  id: number,
  tokens: ConcurrencyTokens
) {
  const template = await tx.emailTemplate.findUnique({
    where: { id },
    include: { draft: true, updatedBy: { select: { name: true } } },
  });
  if (!template) throw new NotFoundError();
  if (template.version !== tokens.expectedVersion) {
    throw new ConflictError(
      `This template was published by ${template.updatedBy?.name ?? "another admin"} (now v${template.version}) while you were editing. Reload to see their changes before publishing yours.`
    );
  }
  if (stamp(template.draft?.updatedAt) !== tokens.expectedDraftStamp) {
    throw new ConflictError(
      "Another admin saved a draft of this template while you were editing. Reload to review it before saving yours."
    );
  }
  return template;
}

export async function saveDraft(actor: Actor, id: number, raw: unknown, tokens: ConcurrencyTokens) {
  assertPermission(actor, "email.edit");
  const template = await loadTemplate(id);
  const prepared = prepareFields(template.key, raw);

  try {
    const draft = await prisma.$transaction(async (tx) => {
      await assertTokens(tx, id, tokens);
      const data = { ...prepared.fields, baseVersion: template.version, updatedById: actor.id };
      const saved = await tx.emailTemplateDraft.upsert({
        where: { templateId: id },
        create: { templateId: id, ...data },
        update: data,
      });
      await recordAudit(tx, actor, {
        action: "email_template.draft_saved",
        entityType: "EmailTemplate",
        entityId: id,
        summary: `Saved a draft of "${template.key}".`,
        metadata: { key: template.key, baseVersion: template.version },
      });
      return saved;
    });
    return { draft, tokens: { expectedVersion: template.version, expectedDraftStamp: stamp(draft.updatedAt) }, ...prepared };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError("Another admin saved a draft of this template at the same time. Reload and try again.");
    }
    throw error;
  }
}

export async function discardDraft(actor: Actor, id: number) {
  assertPermission(actor, "email.edit");
  const template = await loadTemplate(id);
  await prisma.$transaction(async (tx) => {
    const result = await tx.emailTemplateDraft.deleteMany({ where: { templateId: id } });
    if (result.count) {
      await recordAudit(tx, actor, {
        action: "email_template.draft_discarded",
        entityType: "EmailTemplate",
        entityId: id,
        summary: `Discarded the draft of "${template.key}".`,
        metadata: { key: template.key },
      });
    }
  });
}

export async function publishTemplate(
  actor: Actor,
  id: number,
  raw: unknown,
  tokens: ConcurrencyTokens,
  changeSummary?: string | null
) {
  assertPermission(actor, "email.publish");
  const template = await loadTemplate(id);
  const prepared = prepareFields(template.key, raw);
  requireValid(prepared);
  const summary = changeSummary?.trim().slice(0, 300) || null;

  const published = await prisma.$transaction(async (tx) => {
    await assertTokens(tx, id, tokens);

    // Atomic compare-and-set: succeeds only if nobody bumped the version since we checked.
    const updated = await tx.emailTemplate.updateMany({
      where: { id, version: tokens.expectedVersion },
      data: { ...prepared.fields, version: { increment: 1 }, updatedById: actor.id },
    });
    if (updated.count !== 1) {
      throw new ConflictError("This template was changed by someone else while publishing. Reload and try again.");
    }
    const row = await tx.emailTemplate.findUniqueOrThrow({ where: { id } });
    await tx.emailTemplateVersion.create({
      data: {
        templateId: id,
        version: row.version,
        action: "PUBLISH",
        ...pickContent(row as unknown as Record<string, unknown>),
        changeSummary: summary,
        createdById: actor.id,
      },
    });
    await tx.emailTemplateDraft.deleteMany({ where: { templateId: id } });
    await recordAudit(tx, actor, {
      action: "email_template.published",
      entityType: "EmailTemplate",
      entityId: id,
      summary: `Published "${row.key}" as v${row.version}.`,
      metadata: { key: row.key, version: row.version, previousVersion: tokens.expectedVersion },
    });
    return row;
  });

  invalidateTemplateCache(template.key);
  return { template: published, ...prepared };
}

export async function restoreVersion(
  actor: Actor,
  id: number,
  version: number,
  expectedVersion: number,
  changeSummary?: string | null
) {
  assertPermission(actor, "email.restore");
  const template = await loadTemplate(id);
  const snapshot = await prisma.emailTemplateVersion.findUnique({
    where: { templateId_version: { templateId: id, version } },
  });
  if (!snapshot) throw new NotFoundError(`Version ${version} doesn't exist.`);

  const summary = changeSummary?.trim().slice(0, 300) || `Restored version ${version}.`;
  const restored = await prisma.$transaction(async (tx) => {
    const updated = await tx.emailTemplate.updateMany({
      where: { id, version: expectedVersion },
      data: {
        ...pickContent(snapshot as unknown as Record<string, unknown>),
        version: { increment: 1 },
        updatedById: actor.id,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictError("This template changed while you were restoring. Reload and try again.");
    }
    const row = await tx.emailTemplateDraft.deleteMany({ where: { templateId: id } }).then(() =>
      tx.emailTemplate.findUniqueOrThrow({ where: { id } })
    );
    await tx.emailTemplateVersion.create({
      data: {
        templateId: id,
        version: row.version,
        action: "RESTORE",
        ...pickContent(row as unknown as Record<string, unknown>),
        changeSummary: summary,
        restoredFromVersion: version,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "email_template.restored",
      entityType: "EmailTemplate",
      entityId: id,
      summary: `Restored "${row.key}" to the content of v${version} (now v${row.version}).`,
      metadata: { key: row.key, restoredFrom: version, version: row.version },
    });
    return row;
  });

  invalidateTemplateCache(template.key);
  return restored;
}

// ----------------------------------------------------------------------------------------
// Preview and test email
// ----------------------------------------------------------------------------------------

export interface PreviewResult {
  subject: string;
  html: string;
  text: string | null;
  /** The complete email document: the rendered body inside the shared layout. */
  /** True when no plain-text part is set; `text` is then generated from the HTML for reference only. */
  textIsGenerated: boolean;
  from: string;
  replyTo: string | null;
  cc: string[];
  bcc: string[];
  issues: RenderIssue[];
  warnings: string[];
}

export function sampleDataForKey(key: string): Record<string, string> {
  return sampleDataFor(variablesForTemplate(key));
}

/** "html" variables always use the built-in sample block; admin-typed HTML never reaches a preview or test email. */
function lockHtmlSamples(key: string, data: TemplateData): TemplateData {
  const out: TemplateData = { ...data };
  for (const ref of variablesForTemplate(key)) {
    if (VARIABLES[ref.name]?.type === "html") out[ref.name] = VARIABLES[ref.name].sample;
  }
  return out;
}

export async function previewTemplate(
  actor: Actor,
  id: number,
  raw: unknown,
  data: TemplateData
): Promise<PreviewResult> {
  assertPermission(actor, "email.view");
  const template = await loadTemplate(id);

  // Preview never throws on bad content: it parses leniently so the admin sees problems live.
  const parsed = contentFieldsSchema.safeParse(raw);
  const source = parsed.success
    ? { ...parsed.data, htmlBody: parsed.data.htmlBody }
    : {
        subject: String((raw as Record<string, unknown>)?.subject ?? ""),
        htmlBody: String((raw as Record<string, unknown>)?.htmlBody ?? ""),
        textBody: ((raw as Record<string, unknown>)?.textBody as string) || null,
        fromName: null,
        fromEmail: null,
        replyTo: null,
        cc: null,
        bcc: null,
      };

  const sanitized = sanitizeEmailHtml(source.htmlBody);
  const rendered = renderParts(
    template.key,
    { subject: source.subject, htmlBody: sanitized.html, textBody: source.textBody },
    lockHtmlSamples(template.key, data),
    "preview"
  );
  const analysis = analyseContent({
    key: template.key,
    subject: source.subject,
    htmlBody: sanitized.html,
    textBody: source.textBody,
  });

  const issues = [...analysis.issues];
  for (const i of rendered.issues) {
    if (!issues.some((x) => x.code === i.code && x.variable === i.variable)) issues.push(i);
  }
  if (!parsed.success) {
    for (const [field, messages] of Object.entries(flattenErrors(parsed.error))) {
      for (const message of messages) issues.push({ severity: "error", code: "syntax", message: `${field}: ${message}` });
    }
  }

  const layout = await loadLiveLayout();
  return {
    subject: rendered.subject,
    html: composeEmail(rendered.html, layout, { subject: rendered.subject }),
    text: rendered.text ?? htmlToText(rendered.html),
    textIsGenerated: rendered.text === null,
    from: buildFromHeader(source),
    replyTo: source.replyTo,
    cc: parseEmailList(source.cc),
    bcc: parseEmailList(source.bcc),
    issues,
    warnings: sanitized.warnings,
  };
}

const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 60 * 60 * 1000;
const SAFE_TEST_HOST = /(^|\.)(example\.com|example\.org|example\.net)$/i;

function scrubError(message: string) {
  return message.replace(/re_[A-Za-z0-9_]{8,}/g, "[redacted]").slice(0, 300);
}

export interface TestEmailInput {
  recipient: string;
  /** Current editor content (unsaved edits included). Falls back to the draft, then the published version. */
  fields?: unknown;
  data?: TemplateData;
  /** Needed to send to an address that belongs to a non-admin user account. */
  confirmAccountRecipient?: boolean;
}

export async function sendTestEmail(actor: Actor, id: number, input: TestEmailInput) {
  assertPermission(actor, "email.test");
  const template = await prisma.emailTemplate.findUnique({ where: { id }, include: { draft: true } });
  if (!template) throw new NotFoundError();

  const recipient = String(input.recipient ?? "").trim().toLowerCase();
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(recipient)) {
    throw new ValidationFailure({ recipient: ["Enter one valid email address."] });
  }

  const rateKey = `email-test:${actor.id}`;
  if (isBlocked(rateKey, TEST_LIMIT)) {
    throw new RuleError(`Test email limit reached (${TEST_LIMIT} per hour). Try again later.`);
  }

  // Never email a real customer by accident: sending to an existing non-admin account
  // needs an explicit confirmation.
  const account = await prisma.user.findUnique({ where: { email: recipient }, select: { role: true } });
  if (account && account.role !== "ADMIN" && !input.confirmAccountRecipient) {
    throw new RuleError(
      `${recipient} belongs to a ${account.role.toLowerCase()} account. Confirm you really want to send a test there.`
    );
  }

  const prepared = input.fields
    ? prepareFields(template.key, input.fields)
    : { fields: pickContent((template.draft ?? template) as unknown as Record<string, unknown>) as ContentFields, warnings: [], issues: [] };

  // Test data may only contain example.com links, so a test can never point at a real
  // action URL (password reset, booking confirmation, ...).
  const data: Record<string, string> = { ...sampleDataForKey(template.key) };
  for (const [name, value] of Object.entries(input.data ?? {})) {
    if (value !== null && value !== undefined) data[name] = String(value);
  }
  for (const [name, value] of Object.entries(data)) {
    if (VARIABLES[name]?.type === "url" && value) {
      let host = "";
      try { host = new URL(value).hostname; } catch { /* reported by the renderer */ }
      if (host && !SAFE_TEST_HOST.test(host)) {
        throw new ValidationFailure({
          data: [`{{${name}}} must link to an example.com address in test emails, so a test can't trigger a real action.`],
        });
      }
    }
  }

  let rendered;
  try {
    rendered = renderParts(
      template.key,
      { subject: prepared.fields.subject, htmlBody: prepared.fields.htmlBody, textBody: prepared.fields.textBody },
      lockHtmlSamples(template.key, data),
      "strict"
    );
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      throw new ValidationFailure(
        { content: error.issues.map((i) => i.message) },
        "The test data or template has problems. Fix them to send a test."
      );
    }
    throw error;
  }

  const banner =
    '<div style="max-width:600px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:10px 14px;margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:13px;text-align:left;">' +
    "<strong>TEST EMAIL</strong> — sent from the REBX admin panel with sample data. No real action was taken.</div>";
  const subject = `[TEST] ${rendered.subject}`;

  recordFailure(rateKey, TEST_WINDOW_MS); // counts every attempt toward the hourly limit

  let status: "SENT" | "FAILED" = "SENT";
  let error: string | null = null;
  try {
    const result = await deliver({
      from: buildFromHeader(prepared.fields),
      to: recipient,
      subject,
      html: composeEmail(rendered.html, await loadLiveLayout(), { subject, banner }),
      ...(rendered.text ? { text: `[TEST EMAIL - sample data, no real action taken]\n\n${rendered.text}` } : {}),
      ...(prepared.fields.replyTo ? { replyTo: prepared.fields.replyTo } : {}),
    });
    if (result.error) {
      status = "FAILED";
      error = scrubError(result.error.message ?? "The email provider rejected the message.");
    }
  } catch (e) {
    status = "FAILED";
    error = scrubError(e instanceof Error ? e.message : "Unknown delivery error.");
  }

  const usedDraft = Boolean(input.fields) || Boolean(template.draft);
  await prisma.$transaction(async (tx) => {
    await tx.emailTestLog.create({
      data: {
        templateId: id,
        templateKey: template.key,
        templateVersion: template.version,
        usedDraft,
        recipient,
        subject,
        status,
        error,
        sentById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "email_template.test_sent",
      entityType: "EmailTemplate",
      entityId: id,
      summary: `Test email for "${template.key}" ${status === "SENT" ? "sent" : "failed"}.`,
      metadata: { key: template.key, version: template.version, status },
    });
  });

  return { status, error, subject };
}

export { escapeHtml };
