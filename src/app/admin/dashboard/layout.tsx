import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { requireRole } from "@/lib/session";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  // The proxy already sends logged-out visitors to /admin/login; this keeps the layout
  // safe if it is ever reached another way.
  const session = await auth();
  if (!session?.user) redirect("/admin/login");
  const user = await requireRole("ADMIN");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 md:flex-row">
      <AdminSidebar userName={user.name} userEmail={user.email} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
