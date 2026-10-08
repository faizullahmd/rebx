import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://rebx.app";

  // Static routes
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/listings`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/videos`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/join-as-agent`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];

  // Dynamic portfolio routes
  const agents = await prisma.user.findMany({
    where: {
      username: { not: null },
      role: { in: ["AGENT", "DEVELOPER"] },
    },
    select: {
      username: true,
      updatedAt: true,
    },
  });

  const portfolioRoutes: MetadataRoute.Sitemap = agents
    .filter((a) => a.username)
    .map((agent) => ({
      url: `${baseUrl}/portfolio/${agent.username}`,
      lastModified: agent.updatedAt,
      changeFrequency: "daily",
      priority: 0.8,
    }));

  return [...staticRoutes, ...portfolioRoutes];
}
