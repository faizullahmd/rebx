import "server-only";
import { prisma } from "@/lib/prisma";
import type { SiteVisitStatus } from "@prisma/client";

export async function getSiteVisitsForAgent(agentId: number, statusFilter?: SiteVisitStatus) {
  return prisma.siteVisit.findMany({
    where: {
      agentId,
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          addressLine: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          latitude: true,
          longitude: true,
          price: true,
          currency: true,
          images: {
            take: 1,
            orderBy: { sortOrder: "asc" },
            select: { url: true },
          },
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          customerProfile: {
            select: { phone: true },
          },
        },
      },
      deal: {
        select: {
          id: true,
          stage: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
        },
      },
    },
    orderBy: [
      { date: "asc" },
      { createdAt: "desc" },
    ],
  });
}

export async function getSiteVisitStatsForAgent(agentId: number) {
  const [total, pending, confirmed, cancelled, completed] = await Promise.all([
    prisma.siteVisit.count({ where: { agentId } }),
    prisma.siteVisit.count({ where: { agentId, status: "PENDING" } }),
    prisma.siteVisit.count({ where: { agentId, status: "CONFIRMED" } }),
    prisma.siteVisit.count({ where: { agentId, status: "CANCELLED" } }),
    prisma.siteVisit.count({ where: { agentId, status: "COMPLETED" } }),
  ]);

  return { total, pending, confirmed, cancelled, completed };
}

export async function getLatestSiteVisitForDeal(dealId: number) {
  return prisma.siteVisit.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          addressLine: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          latitude: true,
          longitude: true,
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function getSiteVisitsForDeal(dealId: number) {
  return prisma.siteVisit.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          addressLine: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          latitude: true,
          longitude: true,
        },
      },
      agent: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export interface SerializedDealSiteVisit {
  id: number;
  dealId: number;
  listingId: number;
  customerId: number;
  agentId: number;
  date: string;
  timeSlot: string;
  visitType: "IN_PERSON" | "VIRTUAL";
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  notes: string | null;
  reminded24hAt?: string | null;
  reminded1hAt?: string | null;
  createdAt: string;
  updatedAt: string;
  listing: {
    id?: number;
    title: string;
    slug?: string;
    addressLine: string;
    city: string;
    state?: string | null;
    country?: string | null;
    postalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  agent?: {
    id?: number;
    name: string;
    email: string;
  } | null;
  customer?: {
    id?: number;
    name: string;
    email: string;
  } | null;
}

