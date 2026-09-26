import "server-only";
import { prisma } from "@/lib/prisma";

export function getDealsForAgent(agentId: number) {
  return prisma.deal.findMany({
    where: { agentId },
    include: { listing: { select: { id: true, title: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export function getDealById(id: number) {
  return prisma.deal.findUnique({
    where: { id },
    include: {
      listing: {
        select: { id: true, title: true, slug: true, agentId: true, developerId: true },
      },
      commissions: true,
      booking: true,
    },
  });
}

export function getDealsForCustomer(customerId: number) {
  return prisma.deal.findMany({
    where: { customerId },
    include: { listing: { select: { id: true, title: true, slug: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export function getAllDealsAdmin() {
  return prisma.deal.findMany({
    include: {
      listing: { select: { id: true, title: true, slug: true } },
      agent: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}
