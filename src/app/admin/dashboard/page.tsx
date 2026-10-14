import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Badge, Card, Empty, PageHeader, Stat, formatDate } from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

const OPEN_STAGES = ["NEW", "CONTACTED", "VIEWING_SCHEDULED", "OFFER_MADE", "NEGOTIATION", "UNDER_CONTRACT"] as const;

const roleTone = { ADMIN: "purple", DEVELOPER: "blue", AGENT: "green", CUSTOMER: "gray" } as const;

export default async function AdminOverviewPage() {
  const [
    usersByRole,
    listingsByStatus,
    openDeals,
    wonDeals,
    pendingBookings,
    commissionTotals,
    pendingDeveloperRequests,
    reviewCount,
    videoCount,
    recentUsers,
    recentListings,
    recentDeals,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: true }),
    prisma.listing.groupBy({ by: ["status"], _count: true }),
    prisma.deal.count({ where: { stage: { in: [...OPEN_STAGES] } } }),
    prisma.deal.count({ where: { stage: "CLOSED_WON" } }),
    prisma.booking.count({ where: { status: "PENDING_CONFIRMATION" } }),
    prisma.commission.groupBy({ by: ["status"], _sum: { amount: true } }),
    prisma.developerRequest.count({ where: { status: "PENDING" } }),
    prisma.review.count(),
    prisma.video.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.listing.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, title: true, city: true, status: true, createdAt: true, agent: { select: { name: true } } },
    }),
    prisma.deal.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        contactName: true,
        stage: true,
        createdAt: true,
        listing: { select: { title: true } },
      },
    }),
  ]);

  const roleCount = (r: string) => usersByRole.find((u) => u.role === r)?._count ?? 0;
  const listingCount = (s: string) => listingsByStatus.find((l) => l.status === s)?._count ?? 0;
  const totalUsers = usersByRole.reduce((n, u) => n + u._count, 0);
  const totalListings = listingsByStatus.reduce((n, l) => n + l._count, 0);
  const commissionSum = (s: string) =>
    Number(commissionTotals.find((c) => c.status === s)?._sum.amount ?? 0);

  const attention = [
    pendingDeveloperRequests > 0 && {
      label: `${pendingDeveloperRequests} developer request(s) awaiting review`,
      href: "/admin/dashboard/developer-requests",
    },
    pendingBookings > 0 && {
      label: `${pendingBookings} booking(s) pending confirmation`,
      href: "/admin/dashboard/bookings",
    },
    listingCount("DRAFT") > 0 && {
      label: `${listingCount("DRAFT")} draft listing(s)`,
      href: "/admin/dashboard/listings?status=DRAFT",
    },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Dashboard" description="Everything happening on REBX at a glance." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Users" value={totalUsers} href="/admin/dashboard/users"
          hint={`${roleCount("AGENT")} agents · ${roleCount("DEVELOPER")} developers · ${roleCount("CUSTOMER")} customers`} />
        <Stat label="Listings" value={totalListings} href="/admin/dashboard/listings"
          hint={`${listingCount("ACTIVE")} active · ${listingCount("DRAFT")} draft · ${listingCount("SOLD")} sold`} />
        <Stat label="Open deals" value={openDeals} href="/admin/dashboard/deals" hint={`${wonDeals} closed won`} />
        <Stat label="Admins" value={roleCount("ADMIN")} href="/admin/dashboard/users?role=ADMIN" />
        <Stat label="Commission pending" value={commissionSum("PENDING").toLocaleString()} href="/admin/dashboard/commissions" />
        <Stat label="Commission invoiced" value={commissionSum("INVOICED").toLocaleString()} href="/admin/dashboard/commissions" />
        <Stat label="Commission received" value={commissionSum("RECEIVED").toLocaleString()} href="/admin/dashboard/commissions" />
        <Stat label="Reviews / Videos" value={`${reviewCount} / ${videoCount}`} href="/admin/dashboard/reviews" />
      </div>

      <Card title="Needs attention">
        {attention.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing needs your attention right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="text-sm text-gray-900 underline-offset-2 hover:underline">
                  {a.label} →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Newest users">
          {recentUsers.length === 0 ? <Empty>No users yet.</Empty> : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {recentUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.name}</p>
                    <p className="truncate text-xs text-neutral-500">{u.email} · {formatDate(u.createdAt)}</p>
                  </div>
                  <Badge tone={roleTone[u.role]}>{u.role.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Newest listings">
          {recentListings.length === 0 ? <Empty>No listings yet.</Empty> : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {recentListings.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.title}</p>
                    <p className="truncate text-xs text-neutral-500">{l.agent.name} · {l.city} · {formatDate(l.createdAt)}</p>
                  </div>
                  <Badge>{l.status.replace("_", " ").toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Latest inquiries & deals">
          {recentDeals.length === 0 ? <Empty>No deals yet.</Empty> : (
            <ul className="flex flex-col divide-y divide-neutral-100">
              {recentDeals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.contactName}</p>
                    <p className="truncate text-xs text-neutral-500">{d.listing.title} · {formatDate(d.createdAt)}</p>
                  </div>
                  <Badge tone={d.stage === "CLOSED_WON" ? "green" : d.stage === "CLOSED_LOST" ? "red" : "amber"}>
                    {d.stage.replaceAll("_", " ").toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
