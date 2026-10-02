"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/auth";
import { nextUserId } from "@/lib/user-id";
import { sendWelcomeEmail } from "@/lib/email";
import {
  LoginFormSchema,
  SignupFormSchema,
  type LoginFormState,
  type SignupFormState,
} from "@/lib/validation/auth";

import { normalizeUsername } from "@/lib/validation/username";
import { Prisma } from "@prisma/client";

export async function signup(
  _prevState: SignupFormState,
  formData: FormData
): Promise<SignupFormState> {
  const validatedFields = SignupFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
    username: formData.get("username") || "",
    companyName: formData.get("companyName") || "",
  });

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { name, email, password, role, username, companyName } = validatedFields.data;
  const normalizedUsername = username ? normalizeUsername(username) : null;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { message: "An account with this email already exists." };
  }

  if (normalizedUsername) {
    const existingUsername = await prisma.user.findUnique({
      where: { username: normalizedUsername },
    });
    if (existingUsername) {
      return {
        errors: {
          username: ["This username is already taken. Please choose another."],
        },
      };
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.$transaction(async (tx) => {
      const id = await nextUserId(tx, role);
      await tx.user.create({
        data: {
          id,
          name,
          email,
          username: normalizedUsername,
          passwordHash,
          role,
          ...(role === "AGENT"
            ? { agentProfile: { create: {} } }
            : role === "DEVELOPER"
              ? { developerProfile: { create: { companyName: companyName || "" } } }
              : { customerProfile: { create: {} } }),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        errors: {
          username: ["This username was just taken. Please choose another."],
        },
      };
    }
    throw error;
  }

  await sendWelcomeEmail(email, name);

  await signIn("credentials", {
    email,
    password,
    redirectTo: "/dashboard",
  });
}

export async function login(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const validatedFields = LoginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!validatedFields.success) {
    return { message: "Please enter a valid email and password." };
  }

  try {
    await signIn("credentials", {
      ...validatedFields.data,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: "Invalid email or password." };
    }
    throw error;
  }
}

export async function logout() {
  await signOut({ redirectTo: "/" });
}
