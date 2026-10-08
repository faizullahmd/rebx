import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/agent/dashboard", label: "Overview" },
  { href: "/agent/dashboard/listings", label: "My listings" },
  { href: "/agent/dashboard/portfolio", label: "Portfolio" },
  { href: "/agent/dashboard/deals", label: "Deals" },
  { href: "/agent/dashboard/commissions", label: "Commissions" },
  { href: "/account", label: "Account settings" },
];

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("AGENT");
  if (!user.username) {
    redirect("/account?required=username");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar roleLabel="Agent" items={items} userName={user.name} />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">{children}</main>
    </div>
  );
}
