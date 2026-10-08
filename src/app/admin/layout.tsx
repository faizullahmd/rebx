import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/admin/dashboard", label: "Overview" },
  { href: "/admin/dashboard/users", label: "Users" },
  { href: "/admin/dashboard/listings", label: "All listings" },
  { href: "/admin/dashboard/deals", label: "Deals" },
  { href: "/admin/dashboard/bookings", label: "Bookings" },
  { href: "/admin/dashboard/commissions", label: "Commissions" },
  { href: "/admin/dashboard/developer-requests", label: "Developer requests" },
  { href: "/account", label: "Account settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("ADMIN");

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar roleLabel="Admin" items={items} userName={user.name} />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">{children}</main>
    </div>
  );
}
