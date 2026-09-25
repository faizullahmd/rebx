"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import type { Role } from "@prisma/client";

const VALID_ROLES: Role[] = ["AGENT", "DEVELOPER", "CUSTOMER", "ADMIN"];

export async function updateUserRole(userId: number, formData: FormData) {
  await requireRole("ADMIN");

  const role = formData.get("role");
  if (typeof role !== "string" || !VALID_ROLES.includes(role as Role)) {
    throw new Error("Invalid role.");
  }

  const data: { role: Role; developerProfile?: { create: { companyName: string } } } = {
    role: role as Role,
  };

  if (role === "DEVELOPER") {
    const existing = await prisma.developerProfile.findUnique({ where: { userId } });
    if (!existing) {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      data.developerProfile = { create: { companyName: `${user.name}'s company` } };
    }
  }

  await prisma.user.update({ where: { id: userId }, data });

  revalidatePath("/admin/dashboard/users");
}
