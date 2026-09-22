"use server";

import bcrypt from "bcryptjs";
import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { createPasswordResetToken, buildResetUrl } from "@/lib/password-reset-tokens";
import { sendDeveloperWelcomeEmail } from "@/lib/email";
import { RejectDeveloperRequestSchema } from "@/lib/validation/developer-request";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function revalidateDeveloperRequestPaths() {
  revalidatePath("/admin/dashboard/developer-requests");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/developer/dashboard");
}

export async function approveDeveloperRequest(requestId: string) {
  await requireRole("ADMIN");

  const request = await prisma.developerRequest.findUnique({ where: { id: requestId } });
  if (!request || request.status !== "PENDING") {
    return;
  }

  const emailTaken = await prisma.user.findUnique({ where: { email: request.contactEmail } });
  if (emailTaken) {
    throw new Error(
      "An account with this email already exists — resolve manually from the Users page."
    );
  }

  const placeholderPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  const newDeveloper = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: request.contactName,
        email: request.contactEmail,
        passwordHash: placeholderPasswordHash,
        role: "DEVELOPER",
        developerProfile: {
          create: {
            companyName: request.companyName,
            phone: request.contactPhone,
          },
        },
      },
    });

    await tx.developerRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", createdDeveloperId: user.id, reviewedAt: new Date() },
    });

    await tx.listing.update({
      where: { id: request.listingId },
      data: { developerId: user.id },
    });

    return user;
  });

  const rawToken = await createPasswordResetToken(newDeveloper.id, INVITE_TTL_MS);
  const host = (await headers()).get("host") ?? "";
  const setPasswordUrl = buildResetUrl(host, rawToken);

  await sendDeveloperWelcomeEmail(newDeveloper.email, request.companyName, setPasswordUrl);

  revalidateDeveloperRequestPaths();
}

export async function rejectDeveloperRequest(requestId: string, formData: FormData) {
  await requireRole("ADMIN");

  const validatedFields = RejectDeveloperRequestSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return;
  }

  await prisma.developerRequest.update({
    where: { id: requestId },
    data: {
      status: "REJECTED",
      rejectionReason: validatedFields.data.rejectionReason || null,
      reviewedAt: new Date(),
    },
  });

  revalidateDeveloperRequestPaths();
}
