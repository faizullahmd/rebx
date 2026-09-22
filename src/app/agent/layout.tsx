import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/agent/dashboard", label: "Overview" },
  { href: "/agent/dashboard/listings", label: "My listings" },
  { href: "/agent/dashboard/deals", label: "Deals" },
  { href: "/agent/dashboard/commissions", label: "Commissions" },
];

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("AGENT");

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel="Agent" items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
