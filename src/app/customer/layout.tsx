import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [{ href: "/customer/dashboard", label: "Overview" }];

export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("CUSTOMER");

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel="Customer" items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
