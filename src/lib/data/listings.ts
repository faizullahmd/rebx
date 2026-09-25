import "server-only";
import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function getListingsForAgent(agentId: number) {
  return prisma.listing.findMany({
    where: { agentId },
    include: { images: true },
    orderBy: { updatedAt: "desc" },
  });
}

export function getListingsForDeveloper(developerId: number) {
  return prisma.listing.findMany({
    where: { developerId },
    include: { images: true, agent: { select: { name: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export function getAllListingsAdmin() {
  return prisma.listing.findMany({
    include: {
      images: true,
      agent: { select: { name: true, email: true } },
      developer: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getListingById(id: string) {
  return prisma.listing.findUnique({
    where: { id },
    include: { images: true },
  });
}

export type PublicListingFilters = {
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  bedrooms?: number;
  transactionType?: TransactionType;
  propertyCategory?: PropertyCategory;
  propertyType?: PropertyType;
};

export function getPublicActiveListings(filters: PublicListingFilters = {}) {
  return prisma.listing.findMany({
    where: {
      status: "ACTIVE",
      ...(filters.city ? { city: { contains: filters.city } } : {}),
      ...(filters.bedrooms ? { bedrooms: { gte: filters.bedrooms } } : {}),
      ...(filters.transactionType ? { transactionType: filters.transactionType } : {}),
      ...(filters.propertyCategory ? { propertyCategory: filters.propertyCategory } : {}),
      ...(filters.propertyType ? { propertyType: filters.propertyType } : {}),
      ...(filters.minPrice || filters.maxPrice
        ? {
            price: {
              ...(filters.minPrice ? { gte: filters.minPrice } : {}),
              ...(filters.maxPrice ? { lte: filters.maxPrice } : {}),
            },
          }
        : {}),
    },
    include: { images: true },
    orderBy: { createdAt: "desc" },
  });
}

export function getRecentActiveListings(limit = 6) {
  return prisma.listing.findMany({
    where: { status: "ACTIVE" },
    include: { images: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function getListingBySlug(slug: string) {
  return prisma.listing.findUnique({
    where: { slug },
    include: {
      images: true,
      agent: { select: { id: true, name: true, email: true } },
    },
  });
}

export function getDevelopers() {
  return prisma.user.findMany({
    where: { role: "DEVELOPER" },
    select: { id: true, name: true, developerProfile: { select: { companyName: true } } },
  });
}
