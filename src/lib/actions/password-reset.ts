"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  ForgotPasswordSchema,
  ResetPasswordSchema,
  type ForgotPasswordState,
  type ResetPasswordState,
} from "@/lib/validation/account";

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";
const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const validatedFields = ForgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { message: GENERIC_MESSAGE };
  }

  const { email } = validatedFields.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    const rawToken = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(rawToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const headerList = await headers();
    const host = headerList.get("host");
    const protocol = host?.startsWith("localhost") ? "http" : "https";
    const resetUrl = `${protocol}://${host}/reset-password/${rawToken}`;

    await sendPasswordResetEmail(email, resetUrl);
  }

  return { message: GENERIC_MESSAGE };
}

export async function resetPassword(
  token: string,
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const validatedFields = ResetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const tokenHash = hashToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.expiresAt.getTime() < Date.now()
  ) {
    return { message: "This reset link is invalid or has expired. Please request a new one." };
  }

  const passwordHash = await bcrypt.hash(validatedFields.data.newPassword, 10);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { userId: resetToken.userId, usedAt: null },
    }),
  ]);

  redirect("/login");
}
