import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/customer/dashboard", label: "Overview" },
  { href: "/account", label: "Account settings" },
];

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("CUSTOMER");

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar roleLabel="Customer" items={items} userName={user.name} />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">{children}</main>
    </div>
  );
}
