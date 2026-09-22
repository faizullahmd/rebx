import "server-only";
import { prisma } from "@/lib/prisma";

export function getAllUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
}

export function getUserCounts() {
  return prisma.user.groupBy({ by: ["role"], _count: true });
}
