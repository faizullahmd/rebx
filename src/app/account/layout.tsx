import { requireUser } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [{ href: "/dashboard", label: "← Back to dashboard" }];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel={user.role} items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
