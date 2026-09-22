import "server-only";
import { prisma } from "@/lib/prisma";

export function getPendingDeveloperRequests() {
  return prisma.developerRequest.findMany({
    where: { status: "PENDING" },
    include: {
      listing: { select: { title: true, slug: true } },
      requestedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function getResolvedDeveloperRequests() {
  return prisma.developerRequest.findMany({
    where: { status: { not: "PENDING" } },
    include: {
      listing: { select: { title: true, slug: true } },
      requestedBy: { select: { name: true, email: true } },
    },
    orderBy: { reviewedAt: "desc" },
    take: 20,
  });
}
