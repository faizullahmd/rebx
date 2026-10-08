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
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar roleLabel="Developer" items={items} userName={user.name} />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">{children}</main>
    </div>
  );
}
