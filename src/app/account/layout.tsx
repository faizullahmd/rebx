import { requireUser } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [{ href: "/dashboard", label: "← Back to dashboard" }];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar roleLabel={user.role} items={items} userName={user.name} />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">{children}</main>
    </div>
  );
}
