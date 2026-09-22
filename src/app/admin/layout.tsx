import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/admin/dashboard", label: "Overview" },
  { href: "/admin/dashboard/users", label: "Users" },
  { href: "/admin/dashboard/listings", label: "All listings" },
  { href: "/admin/dashboard/deals", label: "Deals" },
  { href: "/admin/dashboard/commissions", label: "Commissions" },
  { href: "/account", label: "Account settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("ADMIN");

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel="Admin" items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
