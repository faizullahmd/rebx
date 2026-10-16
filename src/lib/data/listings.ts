import "server-only";
import type { TransactionType, PropertyCategory, PropertyType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function getListingsForAgent(agentId: number) {
  return prisma.listing.findMany({
    where: { agentId },
    include: { images: true, tag: true },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
}

export function getListingsForDeveloper(developerId: number) {
  return prisma.listing.findMany({
    where: { developerId },
    include: {
      images: true,
      tag: true,
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
      tag: true,
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
  q?: string;
  tag?: string;
};

export function getPublicActiveListings(filters: PublicListingFilters = {}) {
  const andConditions: any[] = [];

  if (filters.city) {
    andConditions.push({ city: { contains: filters.city } });
  }
  if (filters.bedrooms) {
    andConditions.push({ bedrooms: { gte: filters.bedrooms } });
  }
  if (filters.transactionType) {
    andConditions.push({ transactionType: filters.transactionType });
  }
  if (filters.propertyCategory) {
    andConditions.push({ propertyCategory: filters.propertyCategory });
  }
  if (filters.propertyType) {
    andConditions.push({ propertyType: filters.propertyType });
  }
  if (filters.minPrice || filters.maxPrice) {
    andConditions.push({
      price: {
        ...(filters.minPrice ? { gte: filters.minPrice } : {}),
        ...(filters.maxPrice ? { lte: filters.maxPrice } : {}),
      },
    });
  }
  if (filters.tag) {
    const trimmedTag = filters.tag.trim();
    if (trimmedTag) {
      andConditions.push({
        tag: { is: { name: trimmedTag } },
      });
    }
  }
  if (filters.q) {
    const trimmedQ = filters.q.trim();
    if (trimmedQ) {
      andConditions.push({
        OR: [
          { title: { contains: trimmedQ } },
          { city: { contains: trimmedQ } },
          { addressLine: { contains: trimmedQ } },
          { state: { contains: trimmedQ } },
          {
            developer: {
              is: {
                OR: [
                  { name: { contains: trimmedQ } },
                  { developerProfile: { is: { companyName: { contains: trimmedQ } } } },
                ],
              },
            },
          },
        ],
      });
    }
  }

  return prisma.listing.findMany({
    where: {
      status: { in: ["ACTIVE", "UNDER_OFFER"] },
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    },
    include: { images: true, tag: true, videos: { orderBy: { sortOrder: "asc" } }, video: true },
    orderBy: { createdAt: "desc" },
  });
}

export type PopularChipItem = {
  id: string;
  label: string;
  type: "tag" | "type" | "city";
  paramKey: string;
  paramValue: string;
  tagColor?: string;
  count: number;
};

export async function getPopularChipsData(): Promise<PopularChipItem[]> {
  const [defaultTags, apartmentCount, villaCount, topCities] = await Promise.all([
    prisma.tag.findMany({
      where: {
        isDefault: true,
        name: { in: ["New", "Featured", "Few Units Left"] },
      },
      include: {
        _count: {
          select: {
            listings: {
              where: { status: { in: ["ACTIVE", "UNDER_OFFER"] } },
            },
          },
        },
      },
    }),
    prisma.listing.count({
      where: { status: { in: ["ACTIVE", "UNDER_OFFER"] }, propertyType: "APARTMENT" },
    }),
    prisma.listing.count({
      where: { status: { in: ["ACTIVE", "UNDER_OFFER"] }, propertyType: "VILLA" },
    }),
    prisma.listing.groupBy({
      by: ["city"],
      where: {
        status: { in: ["ACTIVE", "UNDER_OFFER"] },
        city: { not: "" },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    }),
  ]);

  const chips: PopularChipItem[] = [];

  // 1. Tags in strict order: New, Featured, Few Units Left
  const tagOrder = ["New", "Featured", "Few Units Left"];
  for (const name of tagOrder) {
    const found = defaultTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const count = found?._count.listings || 0;
    if (count > 0 && found) {
      chips.push({
        id: `tag-${found.name}`,
        label: found.name,
        type: "tag",
        paramKey: "tag",
        paramValue: found.name,
        tagColor: found.color,
        count,
      });
    }
  }

  // 2. Types: Apartments, Villas
  if (apartmentCount > 0) {
    chips.push({
      id: "type-apartment",
      label: "Apartments",
      type: "type",
      paramKey: "propertyType",
      paramValue: "APARTMENT",
      count: apartmentCount,
    });
  }
  if (villaCount > 0) {
    chips.push({
      id: "type-villa",
      label: "Villas",
      type: "type",
      paramKey: "propertyType",
      paramValue: "VILLA",
      count: villaCount,
    });
  }

  // 3. Location: the city with the most active listings
  if (topCities.length > 0 && topCities[0]._count.id > 0 && topCities[0].city) {
    chips.push({
      id: `city-${topCities[0].city}`,
      label: topCities[0].city,
      type: "city",
      paramKey: "city",
      paramValue: topCities[0].city,
      count: topCities[0]._count.id,
    });
  }

  return chips;
}

export function getRecentActiveListings(limit = 6) {
  return prisma.listing.findMany({
    where: { status: { in: ["ACTIVE", "UNDER_OFFER"] } },
    include: { images: true, tag: true, videos: { orderBy: { sortOrder: "asc" } }, video: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export function getListingBySlug(slug: string) {
  return prisma.listing.findUnique({
    where: { slug },
    include: {
      images: true,
      tag: true,
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

  const resolvedVideos = await Promise.all(
    videos.map(async (v) => {
      if (v.listings && v.listings.length > 0) {
        return v;
      }

      const fallbackListing = await prisma.listing.findFirst({
        where: {
          status: "ACTIVE",
          OR: [
            { videoUrl: v.url },
            { videos: { some: { url: v.url } } },
            ...(v.videoId
              ? [
                  { videoUrl: { contains: v.videoId } },
                  { videos: { some: { url: { contains: v.videoId } } } },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        include: {
          images: { take: 1 },
        },
      });

      if (fallbackListing) {
        return {
          ...v,
          listings: [fallbackListing],
        };
      }

      return v;
    })
  );

  return {
    videos: resolvedVideos,
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
