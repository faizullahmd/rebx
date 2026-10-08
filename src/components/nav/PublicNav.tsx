import { auth } from "@/auth";
import { PublicNavClient } from "./PublicNavClient";

export async function PublicNav() {
  const session = await auth();

  return <PublicNavClient user={session?.user} />;
}

