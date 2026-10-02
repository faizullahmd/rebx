import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";

const items = [
  { href: "/developer/dashboard", label: "My properties" },
  { href: "/developer/dashboard/videos", label: "Videos" },
  { href: "/developer/dashboard/bookings", label: "Bookings" },
  { href: "/account", label: "Account settings" },
];

export default async function DeveloperLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("DEVELOPER");
  if (!user.username) {
    redirect("/account?required=username");
  }

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar roleLabel="Developer" items={items} userName={user.name} />
      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
