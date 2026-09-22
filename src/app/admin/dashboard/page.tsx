import { getUserCounts } from "@/lib/data/users";
import { prisma } from "@/lib/prisma";

export default async function AdminOverviewPage() {
  const [userCounts, listingCount] = await Promise.all([
    getUserCounts(),
    prisma.listing.count(),
  ]);

  const countFor = (role: string) =>
    userCounts.find((c) => c.role === role)?._count ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Platform overview</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Agents" value={countFor("AGENT")} />
        <Stat label="Developers" value={countFor("DEVELOPER")} />
        <Stat label="Customers" value={countFor("CUSTOMER")} />
        <Stat label="Admins" value={countFor("ADMIN")} />
        <Stat label="Listings" value={listingCount} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
