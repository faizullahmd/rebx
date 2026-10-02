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
    include: {
      images: true,
      videos: { orderBy: { sortOrder: "asc" } },
      agent: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getAllListingsAdmin() {
  return prisma.listing.findMany({
    include: {
      images: true,
      videos: { orderBy: { sortOrder: "asc" } },
      agent: { select: { name: true, email: true } },
      developer: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export function getListingById(id: number) {
  return prisma.listing.findUnique({
    where: { id },
    include: {
      images: true,
      videos: { orderBy: { sortOrder: "asc" } },
      video: true,
    },
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
    include: { images: true, videos: { orderBy: { sortOrder: "asc" } }, video: true },
    orderBy: { createdAt: "desc" },
  });
}

export function getRecentActiveListings(limit = 6) {
  return prisma.listing.findMany({
    where: { status: "ACTIVE" },
    include: { images: true, videos: { orderBy: { sortOrder: "asc" } }, video: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function getListingBySlug(slug: string) {
  return prisma.listing.findUnique({
    where: { slug },
    include: {
      images: true,
      videos: { orderBy: { sortOrder: "asc" } },
      video: true,
      agent: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          agentProfile: { select: { phone: true, agencyName: true } },
        },
      },
    },
  });
}

export function getDevelopers() {
  return prisma.user.findMany({
    where: { role: "DEVELOPER" },
    select: { id: true, name: true, developerProfile: { select: { companyName: true } } },
  });
}

export type VideoGalleryFilters = {
  search?: string;
  propertyType?: PropertyType;
  transactionType?: TransactionType;
  sort?: "newest" | "price_asc" | "price_desc";
  page?: number;
  limit?: number;
};

export async function getVideoGalleryListings(filters: VideoGalleryFilters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Number(filters.limit) || 12);
  const skip = (page - 1) * limit;

  const search = filters.search?.trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];

  if (filters.transactionType) {
    conditions.push({
      listings: {
        some: {
          status: "ACTIVE",
          transactionType: filters.transactionType,
        },
      },
    });
  }

  if (filters.propertyType) {
    conditions.push({
      listings: {
        some: {
          status: "ACTIVE",
          propertyType: filters.propertyType,
        },
      },
    });
  }

  if (search) {
    conditions.push({
      OR: [
        { title: { contains: search } },
        {
          listings: {
            some: {
              status: "ACTIVE",
              OR: [
                { title: { contains: search } },
                { city: { contains: search } },
                { state: { contains: search } },
                { locality: { contains: search } },
                { addressLine: { contains: search } },
              ],
            },
          },
        },
      ],
    });
  }

  if (conditions.length > 0) {
    where.AND = conditions;
  }

  const [videos, totalCount] = await Promise.all([
    prisma.video.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        listings: {
          where: { status: "ACTIVE" },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            images: { take: 1 },
          },
        },
      },
    }),
    prisma.video.count({ where }),
  ]);

  return {
    videos,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    currentPage: page,
    limit,
  };
}

export async function hasActivePropertyVideos(): Promise<boolean> {
  const count = await prisma.video.count();
  return count > 0;
}
