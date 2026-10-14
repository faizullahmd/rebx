"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/auth";
import { nextUserId } from "@/lib/user-id";
import { clearFailures, isBlocked, recordFailure } from "@/lib/rate-limit";
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

  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  await sendWelcomeEmail(email, name, `${protocol}://${host}`);

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

export async function adminLogin(
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

  // Only accounts with the ADMIN role may use this form. Check before signing in so a
  // non-admin never receives a session from it; the message stays generic on purpose.
  const { email, password } = validatedFields.data;

  // Throttle repeated failures per client IP and per target email (8 per 15 minutes).
  const forwarded = (await headers()).get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const keys = [`admin-login:ip:${ip}`, `admin-login:email:${email.toLowerCase()}`];
  const MAX_FAILURES = 8;
  const WINDOW_MS = 15 * 60 * 1000;
  if (keys.some((key) => isBlocked(key, MAX_FAILURES))) {
    return { message: "Too many failed attempts. Please try again in 15 minutes." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !passwordOk || user.role !== "ADMIN") {
    keys.forEach((key) => recordFailure(key, WINDOW_MS));
    return { message: "Invalid admin credentials." };
  }
  keys.forEach(clearFailures);

  // Only same-site /admin paths are allowed as a post-login destination.
  const requested = formData.get("callbackUrl");
  const redirectTo =
    typeof requested === "string" && /^\/admin(\/|$)/.test(requested) && !requested.startsWith("//")
      ? requested
      : "/admin/dashboard";

  try {
    await signIn("credentials", { email, password, redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      return { message: "Invalid admin credentials." };
    }
    throw error;
  }
}
