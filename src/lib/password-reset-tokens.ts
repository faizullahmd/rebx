import "server-only";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(userId: string, ttlMs: number) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashToken(rawToken),
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return rawToken;
}

export function buildResetUrl(host: string, token: string) {
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}/reset-password/${token}`;
}
