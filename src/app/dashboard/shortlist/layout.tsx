import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardSidebar } from "@/components/nav/DashboardSidebar";
import type { Role } from "@prisma/client";

const roleDashboard: Record<Role, string> = {
  AGENT: "/agent/dashboard",
  DEVELOPER: "/developer/dashboard",
  CUSTOMER: "/customer/dashboard",
  ADMIN: "/admin/dashboard",
};

const items = [
  { href: "/customer/dashboard", label: "Overview" },
  { href: "/dashboard/shortlist", label: "Shortlist" },
  { href: "/customer/dashboard/deals", label: "Deals" },
  { href: "/account", label: "Account settings" },
];

export default async function ShortlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=" + encodeURIComponent("/dashboard/shortlist"));
  }

  // In the dashboard, Shortlist is strictly visible and accessible for customers only
  if (session.user.role !== "CUSTOMER") {
    redirect(roleDashboard[session.user.role] || "/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-neutral-50/30">
      <DashboardSidebar
        roleLabel="Customer"
        items={items}
        userName={session.user.name || "Customer"}
      />
      <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8 min-w-0">
        {children}
      </main>
    </div>
  );
}

