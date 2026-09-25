// No "server-only" guard here (unlike most of src/lib): this module is also imported
// directly by the one-off scripts/backfill-user-ids.ts, which runs outside Next.js.
import type { Prisma, Role } from "@prisma/client";

const RANGE_START: Record<"ADMIN" | "DEVELOPER" | "AGENT_CUSTOMER", number> = {
  ADMIN: 10,
  DEVELOPER: 100,
  AGENT_CUSTOMER: 10000,
};

function counterKey(role: Role): keyof typeof RANGE_START {
  if (role === "ADMIN") return "ADMIN";
  if (role === "DEVELOPER") return "DEVELOPER";
  return "AGENT_CUSTOMER";
}

/**
 * Assigns the next numeric User id for a role's range (Admin 10+, Developer 100+,
 * Agent/Customer share 10000+). Self-initializing: the first call for a range creates
 * the counter at the range's start value and returns it directly, so no pre-seeding is
 * needed. Must be called inside the same transaction as the User row it's assigned to,
 * so a failed create doesn't burn a number.
 */
export async function nextUserId(tx: Prisma.TransactionClient, role: Role): Promise<number> {
  const key = counterKey(role);
  const counter = await tx.idCounter.upsert({
    where: { key },
    create: { key, value: RANGE_START[key] },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}
