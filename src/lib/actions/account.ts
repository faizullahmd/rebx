"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { signOut } from "@/auth";
import {
  ChangePasswordSchema,
  ProfileFormSchema,
  type ChangePasswordState,
  type ProfileFormState,
} from "@/lib/validation/account";

function revalidateAccountPaths() {
  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/agent", "layout");
  revalidatePath("/developer", "layout");
  revalidatePath("/customer", "layout");
  revalidatePath("/admin", "layout");
}

export async function updateProfile(
  _prevState: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const user = await requireUser();

  const validatedFields = ProfileFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { name, email, agencyName, licenseNo, companyName, website, phone, bio } =
    validatedFields.data;

  if (email !== user.email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { message: "An account with this email already exists." };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { name, email } });

    if (user.role === "AGENT") {
      await tx.agentProfile.upsert({
        where: { userId: user.id },
        update: {
          agencyName: agencyName || null,
          licenseNo: licenseNo || null,
          phone: phone || null,
          bio: bio || null,
        },
        create: {
          userId: user.id,
          agencyName: agencyName || null,
          licenseNo: licenseNo || null,
          phone: phone || null,
          bio: bio || null,
        },
      });
    } else if (user.role === "DEVELOPER") {
      await tx.developerProfile.upsert({
        where: { userId: user.id },
        update: {
          companyName: companyName || "",
          phone: phone || null,
          website: website || null,
        },
        create: {
          userId: user.id,
          companyName: companyName || "",
          phone: phone || null,
          website: website || null,
        },
      });
    } else if (user.role === "CUSTOMER") {
      await tx.customerProfile.upsert({
        where: { userId: user.id },
        update: { phone: phone || null },
        create: { userId: user.id, phone: phone || null },
      });
    }
  });

  revalidateAccountPaths();
  return { message: "Profile updated." };
}

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const validatedFields = ChangePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { currentPassword, newPassword } = validatedFields.data;

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const passwordsMatch = await bcrypt.compare(currentPassword, dbUser.passwordHash);
  if (!passwordsMatch) {
    return { errors: { currentPassword: ["Current password is incorrect."] } };
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  // JWT sessions aren't invalidated by a DB password change, so signing out is
  // what actually forces re-authentication with the new password.
  await signOut({ redirectTo: "/login" });
}
