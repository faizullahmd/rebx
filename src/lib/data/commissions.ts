import "server-only";
import { prisma } from "@/lib/prisma";

export function getCommissionsForAgent(agentId: string) {
  return prisma.commission.findMany({
    where: { agentId },
    include: {
      deal: { include: { listing: { select: { title: true, slug: true } } } },
      paidOutBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getCommissionsForDeveloper(developerId: string) {
  return prisma.commission.findMany({
    where: { source: "DEVELOPER", deal: { listing: { developerId } } },
    include: {
      agent: { select: { name: true, email: true } },
      deal: { include: { listing: { select: { title: true, slug: true } } } },
      paidOutBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getAllCommissionsAdmin() {
  return prisma.commission.findMany({
    include: {
      agent: { select: { name: true, email: true } },
      deal: { include: { listing: { select: { title: true, slug: true } } } },
      paidOutBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}
