import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import type { PropertyType, TransactionType } from "@prisma/client";
import {
  getAgentPortfolioByUsername,
  getAgentPortfolioListings,
  type PortfolioSortOption,
} from "@/lib/data/portfolio";
import { AgentProfileHeader } from "@/components/portfolio/AgentProfileHeader";
import { PortfolioFilters } from "@/components/portfolio/PortfolioFilters";
import { PortfolioPagination } from "@/components/portfolio/PortfolioPagination";
import { ListingCard } from "@/components/listings/ListingCard";

export const dynamic = "force-dynamic";

interface PortfolioPageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: PortfolioPageProps): Promise<Metadata> {
  const { username } = await params;
  const decodedUsername = decodeURIComponent(username).trim();
  const normalized = decodedUsername.toLowerCase();

  if (decodedUsername !== normalized) {
    redirect(`/portfolio/${normalized}`);
  }

  const agent = await getAgentPortfolioByUsername(normalized);

  if (!agent) {
    return {
      title: "Agent Not Found | REBX",
      description: "The requested agent portfolio could not be found.",
    };
  }

  const roleLabel = agent.role === "DEVELOPER" ? "Developer" : "Real Estate Agent";
  const agencyText = agent.agentProfile?.agencyName
    ? ` with ${agent.agentProfile.agencyName}`
    : agent.developerProfile?.companyName
      ? ` at ${agent.developerProfile.companyName}`
      : "";

  const title = `${agent.name} - Properties on REBX`;
  const description =
    agent.agentProfile?.bio ||
    `Browse ${agent.name}'s active real estate listings and portfolio on REBX. Certified ${roleLabel}${agencyText}.`;

  const canonicalUrl = `https://rebx.app/portfolio/${agent.username}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: "profile",
      siteName: "REBX Real Estate Exchange",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

function parseParamString(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export default async function PortfolioPage({ params, searchParams }: PortfolioPageProps) {
  const { username: rawUsername } = await params;
  const decodedUsername = decodeURIComponent(rawUsername);
  const normalizedUsername = decodedUsername.toLowerCase().trim();

  // Redirect non-lowercase to canonical lowercase URL while preserving query params
  if (decodedUsername !== normalizedUsername) {
    const sp = await searchParams;
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === "string") {
        query.set(key, value);
      }
    }
    const qs = query.toString();
    redirect(`/portfolio/${normalizedUsername}${qs ? `?${qs}` : ""}`);
  }

  const agent = await getAgentPortfolioByUsername(normalizedUsername);

  if (!agent) {
    notFound();
  }

  const sp = await searchParams;
  const transactionType = parseParamString(sp.transactionType) as TransactionType | undefined;
  const propertyType = parseParamString(sp.propertyType) as PropertyType | undefined;
  const sort = (parseParamString(sp.sort) as PortfolioSortOption) || "newest";
  const pageRaw = parseParamString(sp.page);
  const page = pageRaw && !Number.isNaN(Number(pageRaw)) ? Math.max(1, parseInt(pageRaw, 10)) : 1;

  const { listings, totalCount, totalPages, currentPage } = await getAgentPortfolioListings(
    agent.id,
    agent.role as "AGENT" | "DEVELOPER",
    {
      transactionType,
      propertyType,
      sort,
      page,
      pageSize: 12,
    }
  );

  const agencyName = agent.agentProfile?.agencyName || agent.developerProfile?.companyName || null;
  const licenseNo = agent.agentProfile?.licenseNo || null;
  const phone = agent.agentProfile?.phone || agent.developerProfile?.phone || null;
  const bio = agent.agentProfile?.bio || null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 space-y-6">
      {/* Agent Profile Header */}
      <AgentProfileHeader
        name={agent.name}
        username={agent.username!}
        role={agent.role as "AGENT" | "DEVELOPER"}
        createdAt={agent.createdAt}
        agencyName={agencyName}
        licenseNo={licenseNo}
        phone={phone}
        bio={bio}
        activeListingCount={agent.activeListingCount}
        operatingLocations={agent.operatingLocations}
      />

      {/* Properties Section */}
      <section className="space-y-6">
        <PortfolioFilters
          currentTransactionType={transactionType || ""}
          currentPropertyType={propertyType || ""}
          currentSort={sort}
          totalResults={totalCount}
        />

        {listings.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50/50 p-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h3 className="mt-4 text-base font-semibold text-neutral-900">
              {totalCount === 0 && !transactionType && !propertyType
                ? "This agent hasn't listed any properties yet."
                : "No matching properties found"}
            </h3>
            <p className="mt-1 text-sm text-neutral-500 max-w-sm">
              {totalCount === 0 && !transactionType && !propertyType
                ? "Check back later or contact the agent directly for upcoming off-market opportunities."
                : "Try adjusting your filters to see more properties from this agent."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}

        {/* Server-side Pagination */}
        <PortfolioPagination currentPage={currentPage} totalPages={totalPages} />
      </section>
    </div>
  );
}
