import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | number;
  summary: string;
  /** Keep this free of secrets and personal data: ids, keys, versions and field names only. */
  metadata?: Prisma.InputJsonValue;
}

export async function recordAudit(db: Db, actor: Actor | null, entry: AuditEntry) {
  await db.adminAuditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      summary: entry.summary.slice(0, 500),
      metadata: entry.metadata,
    },
  });
}
