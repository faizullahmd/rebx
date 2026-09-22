import "server-only";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // A session's JWT can outlive the user row it points to (e.g. an admin deletes
  // the account, or the database gets reset). Catch that here instead of letting
  // every foreign-key-dependent query below fail with a raw 500.
  const stillExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!stillExists) {
    await signOut({ redirectTo: "/login" });
  }

  return session.user;
}

export async function requireRole(role: Role) {
  const user = await requireUser();
  if (user.role !== role) {
    redirect("/unauthorized");
  }
  return user;
}
