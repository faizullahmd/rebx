import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function JoinAsAgentPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/agent/dashboard");
  } else {
    redirect("/login");
  }
}
