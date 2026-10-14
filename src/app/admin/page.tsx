import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function AdminIndexPage() {
  const session = await auth();
  redirect(session?.user?.role === "ADMIN" ? "/admin/dashboard" : "/admin/login");
}
