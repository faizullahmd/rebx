import "server-only";
import { prisma } from "@/lib/prisma";
import type { ListingStatus, Prisma, PropertyType, TransactionType } from "@prisma/client";

export type PortfolioSortOption = "newest" | "price-asc" | "price-desc";

export interface AgentPortfolioFilterOptions {
  propertyType?: PropertyType;
  transactionType?: TransactionType;
  sort?: PortfolioSortOption;
  page?: number;
  pageSize?: number;
}

export async function getAgentPortfolioByUsername(username: string) {
  const normalized = username.toLowerCase().trim();

  const user = await prisma.user.findFirst({
    where: {
      username: normalized,
      role: { in: ["AGENT", "DEVELOPER"] },
    },
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      createdAt: true,
      agentProfile: {
        select: {
          agencyName: true,
          licenseNo: true,
          phone: true,
          bio: true,
        },
      },
      developerProfile: {
        select: {
          companyName: true,
          phone: true,
          website: true,
        },
      },
    },
  });

  if (!user) return null;

  // Retrieve distinct active cities to highlight market/coverage
  const locationCondition =
    user.role === "DEVELOPER" ? { developerId: user.id } : { agentId: user.id };

  const [activeCount, sampleLocations] = await Promise.all([
    prisma.listing.count({
      where: {
        ...locationCondition,
        status: { in: ["ACTIVE", "UNDER_OFFER"] },
      },
    }),
    prisma.listing.findMany({
      where: {
        ...locationCondition,
        status: { in: ["ACTIVE", "UNDER_OFFER"] },
      },
      select: {
        city: true,
        state: true,
      },
      distinct: ["city"],
      take: 3,
    }),
  ]);

  const cities = sampleLocations
    .map((l) => [l.city, l.state].filter(Boolean).join(", "))
    .filter(Boolean);

  return {
    ...user,
    activeListingCount: activeCount,
    operatingLocations: cities,
  };
}

export async function getAgentPortfolioListings(
  userId: number,
  role: "AGENT" | "DEVELOPER",
  filters: AgentPortfolioFilterOptions = {}
) {
  const { propertyType, transactionType, sort = "newest", page = 1, pageSize = 12 } = filters;

  const roleCondition =
    role === "DEVELOPER" ? { developerId: userId } : { agentId: userId };

  const whereClause: Prisma.ListingWhereInput = {
    ...roleCondition,
    status: { in: ["ACTIVE", "UNDER_OFFER"] as ListingStatus[] },
    ...(propertyType ? { propertyType } : {}),
    ...(transactionType ? { transactionType } : {}),
  };

  const orderBy =
    sort === "price-asc"
      ? { price: "asc" as const }
      : sort === "price-desc"
        ? { price: "desc" as const }
        : { createdAt: "desc" as const };

  const [totalCount, listings] = await Promise.all([
    prisma.listing.count({ where: whereClause }),
    prisma.listing.findMany({
      where: whereClause,
      include: {
        images: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy,
      skip: Math.max(0, (page - 1) * pageSize),
      take: pageSize,
    }),
  ]);

  return {
    listings,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    currentPage: page,
  };
}
