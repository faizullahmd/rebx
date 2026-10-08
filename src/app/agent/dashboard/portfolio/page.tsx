import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getListingsForAgent } from "@/lib/data/listings";
import { getAgentPortfolioByUsername } from "@/lib/data/portfolio";
import { AgentPortfolioManager } from "@/components/portfolio/AgentPortfolioManager";

export const metadata = {
  title: "Agent Portfolio | REBX Dashboard",
};

export default async function AgentPortfolioPage() {
  const user = await requireRole("AGENT");
  if (!user.username) {
    redirect("/account?required=username");
  }

  const [agentProfile, listings] = await Promise.all([
    getAgentPortfolioByUsername(user.username),
    getListingsForAgent(user.id),
  ]);

  if (!agentProfile) {
    notFound();
  }

  const serializedListings = listings.map((listing) => ({
    ...listing,
    price: Number(listing.price),
  }));

  return (
    <AgentPortfolioManager
      agentProfile={{
        name: agentProfile.name,
        username: agentProfile.username!,
        role: agentProfile.role as "AGENT" | "DEVELOPER",
        createdAt: agentProfile.createdAt,
        agencyName: agentProfile.agentProfile?.agencyName,
        licenseNo: agentProfile.agentProfile?.licenseNo,
        phone: agentProfile.agentProfile?.phone,
        bio: agentProfile.agentProfile?.bio,
        operatingLocations: agentProfile.operatingLocations,
      }}
      initialListings={serializedListings}
    />
  );
}
