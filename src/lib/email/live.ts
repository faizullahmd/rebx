import "server-only";
import { prisma } from "@/lib/prisma";
import { BUILT_IN_BY_KEY } from "@/lib/email/definitions";
import { cacheGet, cacheSet } from "@/lib/email/cache";

export interface LiveTemplate {
  key: string;
  source: "database" | "built-in";
  active: boolean;
  version: number;
  subject: string;
  htmlBody: string;
  textBody: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  cc: string | null;
  bcc: string | null;
}

export function builtInTemplate(key: string): LiveTemplate | null {
  const def = BUILT_IN_BY_KEY[key];
  if (!def) return null;
  return {
    key,
    source: "built-in",
    active: true,
    version: 0,
    subject: def.subject,
    htmlBody: def.html,
    textBody: null,
    fromName: null,
    fromEmail: null,
    replyTo: null,
    cc: null,
    bcc: null,
  };
}

/**
 * The published template production emails use. If the row is missing or the database is
 * unreachable it falls back to the built-in default, so email never stops because of this module.
 */
export async function loadLiveTemplate(key: string): Promise<LiveTemplate | null> {
  const cached = cacheGet<LiveTemplate | null>(key);
  if (cached !== undefined) return cached;

  let live: LiveTemplate | null;
  try {
    const row = await prisma.emailTemplate.findUnique({ where: { key } });
    live = row
      ? {
          key,
          source: "database",
          active: row.status === "ACTIVE",
          version: row.version,
          subject: row.subject,
          htmlBody: row.htmlBody,
          textBody: row.textBody,
          fromName: row.fromName,
          fromEmail: row.fromEmail,
          replyTo: row.replyTo,
          cc: row.cc,
          bcc: row.bcc,
        }
      : builtInTemplate(key);
  } catch (error) {
    console.error(`Email template lookup failed for "${key}", using built-in default:`, error);
    return builtInTemplate(key);
  }

  cacheSet(key, live);
  return live;
}
