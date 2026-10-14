import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { hasPermission, type Actor, type Permission } from "@/lib/permissions";
import { cacheGet, cacheSet, invalidateTemplateCache } from "@/lib/email/cache";
import { ConflictError, ForbiddenError, ValidationFailure } from "@/lib/email/errors";
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  composeEmail,
  normalizeLayout,
  safeLayout,
  validateLayout,
  type LayoutSettings,
} from "@/lib/email/layout";

const CACHE_KEY = "__layout__";

function assertPermission(actor: Actor, permission: Permission) {
  if (!hasPermission(actor, permission)) throw new ForbiddenError();
}

/**
 * The layout production emails use. Cached briefly; falls back to the built-in default if the
 * row is missing or the database is unreachable, so email never stops because of the layout.
 */
export async function loadLiveLayout(): Promise<LayoutSettings> {
  const cached = cacheGet<LayoutSettings>(CACHE_KEY);
  if (cached) return cached;
  let settings: LayoutSettings;
  try {
    const row = await prisma.emailLayout.findUnique({ where: { key: LAYOUT_KEY } });
    settings = row ? safeLayout(row.settings) : DEFAULT_LAYOUT;
  } catch (error) {
    console.error("Email layout lookup failed, using the default layout:", error);
    return DEFAULT_LAYOUT;
  }
  cacheSet(CACHE_KEY, settings);
  return settings;
}

export async function getLayoutState(actor: Actor) {
  assertPermission(actor, "email.view");
  const row = await prisma.emailLayout.findUnique({
    where: { key: LAYOUT_KEY },
    include: { updatedBy: { select: { name: true } } },
  });
  return {
    settings: row ? safeLayout(row.settings) : DEFAULT_LAYOUT,
    version: row?.version ?? 0,
    isDefault: !row,
    updatedBy: row?.updatedBy?.name ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function prepare(raw: unknown): LayoutSettings {
  const settings = normalizeLayout(raw);
  const errors = validateLayout(settings);
  if (Object.keys(errors).length) {
    throw new ValidationFailure(
      Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v as string]])),
      "Please fix the highlighted fields."
    );
  }
  return settings;
}

/**
 * Saves the shared layout. `expectedVersion` is the version the editor loaded (0 = no row yet);
 * a mismatch means another admin saved in the meantime, and nothing is overwritten.
 */
export async function saveLayout(actor: Actor, raw: unknown, expectedVersion: number) {
  assertPermission(actor, "email.layout");
  const settings = prepare(raw);

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.emailLayout.findUnique({ where: { key: LAYOUT_KEY } });
      const before = existing ? safeLayout(existing.settings) : DEFAULT_LAYOUT;

      let row;
      if (!existing) {
        if (expectedVersion !== 0) throw new ConflictError("The email layout was reset while you were editing. Reload and try again.");
        row = await tx.emailLayout.create({
          data: { key: LAYOUT_KEY, settings: settings as unknown as Prisma.InputJsonValue, version: 1, updatedById: actor.id },
        });
      } else {
        const updated = await tx.emailLayout.updateMany({
          where: { key: LAYOUT_KEY, version: expectedVersion },
          data: { settings: settings as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedById: actor.id },
        });
        if (updated.count !== 1) {
          throw new ConflictError(
            "Another admin changed the email layout while you were editing. Reload to see their changes before saving yours."
          );
        }
        row = await tx.emailLayout.findUniqueOrThrow({ where: { key: LAYOUT_KEY } });
      }

      await recordAudit(tx, actor, {
        action: "email_layout.updated",
        entityType: "EmailLayout",
        entityId: row.id,
        summary: `Updated the shared email layout (now v${row.version}).`,
        metadata: { version: row.version, before: before as unknown as Prisma.InputJsonValue, after: settings as unknown as Prisma.InputJsonValue },
      });
      return row;
    });
    invalidateTemplateCache(CACHE_KEY);
    return { version: saved.version, settings, updatedAt: saved.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("Another admin created the email layout at the same time. Reload and try again.");
    }
    throw error;
  }
}

/** Sample message shown inside the layout when previewing it on its own. */
export const LAYOUT_SAMPLE_BODY =
  '<h1 style="margin:0 0 12px 0;font-size:24px;line-height:32px;color:#18181b;">Your email heading</h1>' +
  "<p>Hi Casey, this is how the body of an email looks inside the shared layout. Every email the platform sends, including new templates, is placed here automatically.</p>" +
  '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;"><tbody><tr><td style="background-color:#111827;border-radius:8px;"><a href="https://example.com/sample" style="display:inline-block;padding:12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Call to action</a></td></tr></tbody></table>';

/** Renders the layout around the sample body for the admin preview. Never throws on bad input. */
export function previewLayout(actor: Actor, raw: unknown) {
  assertPermission(actor, "email.view");
  const settings = normalizeLayout(raw);
  const errors = validateLayout(settings);
  return {
    html: composeEmail(LAYOUT_SAMPLE_BODY, settings, { subject: "Layout preview" }),
    fieldErrors: Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, [v as string]])) as Record<string, string[]>,
  };
}
