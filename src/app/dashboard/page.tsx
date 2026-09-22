import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Role } from "@prisma/client";

const roleDashboard: Record<Role, string> = {
  AGENT: "/agent/dashboard",
  DEVELOPER: "/developer/dashboard",
  CUSTOMER: "/customer/dashboard",
  ADMIN: "/admin/dashboard",
};

export default async function DashboardRedirectPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  redirect(roleDashboard[session.user.role]);
}
