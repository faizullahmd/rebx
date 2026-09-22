import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [{ href: "/developer/dashboard", label: "My properties" }];

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("DEVELOPER");

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel="Developer" items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
