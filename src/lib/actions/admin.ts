"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { updateDeal } from "@/lib/actions/deals";
import {
  sendListingReviewDecisionEmail,
  sendListingLiveEmail,
} from "@/lib/email";
import { nextUserId } from "@/lib/user-id";
import { PasswordSchema } from "@/lib/validation/auth";
import { normalizeUsername, validateUsernameFormat } from "@/lib/validation/username";
import { TAG_COLOR_KEYS } from "@/lib/tags";
import type { ListingStatus, Role } from "@prisma/client";

export type AdminActionState = { ok?: boolean; message?: string } | undefined;

const ROLES: Role[] = ["AGENT", "DEVELOPER", "CUSTOMER", "ADMIN"];
const LISTING_STATUSES: ListingStatus[] = ["DRAFT", "ACTIVE", "UNDER_OFFER", "SOLD"];

const ok = (message: string): AdminActionState => ({ ok: true, message });
const fail = (message: string): AdminActionState => ({ ok: false, message });

function refresh(...paths: string[]) {
  for (const path of paths) revalidatePath(path);
}

async function ensureProfile(userId: number, role: Role, displayName: string) {
  if (role === "DEVELOPER") {
    const existing = await prisma.developerProfile.findUnique({ where: { userId } });
    if (!existing) {
      await prisma.developerProfile.create({
        data: { userId, companyName: `${displayName}'s company` },
      });
    }
  } else if (role === "AGENT") {
    const existing = await prisma.agentProfile.findUnique({ where: { userId } });
    if (!existing) await prisma.agentProfile.create({ data: { userId } });
  } else if (role === "CUSTOMER") {
    const existing = await prisma.customerProfile.findUnique({ where: { userId } });
    if (!existing) await prisma.customerProfile.create({ data: { userId } });
  }
}

// ---------------------------------------------------------------- Users

const CreateUserSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  password: PasswordSchema,
  role: z.enum(["AGENT", "DEVELOPER", "CUSTOMER", "ADMIN"]),
  username: z.string().trim().optional().or(z.literal("")),
  companyName: z.string().trim().optional().or(z.literal("")),
});

export async function createUser(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const parsed = CreateUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid input.");
  }
  const { name, email, password, role, companyName } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return fail("An account with this email already exists.");
  }

  let username: string | null = null;
  if (parsed.data.username) {
    username = normalizeUsername(parsed.data.username);
    const check = validateUsernameFormat(username);
    if (!check.valid) return fail(check.error ?? "Invalid username.");
    if (await prisma.user.findUnique({ where: { username } })) {
      return fail("That username is already taken.");
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.$transaction(async (tx) => {
    const id = await nextUserId(tx, role);
    await tx.user.create({
      data: {
        id,
        name,
        email,
        username,
        passwordHash,
        role,
        ...(role === "AGENT"
          ? { agentProfile: { create: {} } }
          : role === "DEVELOPER"
            ? { developerProfile: { create: { companyName: companyName || `${name}'s company` } } }
            : role === "CUSTOMER"
              ? { customerProfile: { create: {} } }
              : {}),
      },
    });
  });

  refresh("/admin/dashboard/users", "/admin/dashboard");
  return ok(`Created ${role.toLowerCase()} account for ${email}.`);
}

export async function updateUserRole(
  userId: number,
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const admin = await requireRole("ADMIN");

  const role = formData.get("role");
  if (typeof role !== "string" || !ROLES.includes(role as Role)) {
    return fail("Invalid role.");
  }
  if (userId === admin.id) {
    return fail("You can't change your own role.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return fail("User not found.");
  if (user.role === role) return ok("Role unchanged.");

  await prisma.user.update({ where: { id: userId }, data: { role: role as Role } });
  await ensureProfile(userId, role as Role, user.name);

  refresh("/admin/dashboard/users", "/admin/dashboard");
  return ok(`Role changed to ${role.toLowerCase()}.`);
}

export async function resetUserPassword(
  userId: number,
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const parsed = PasswordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid password.");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return fail("User not found.");

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(parsed.data, 10) },
  });
  // Pending reset links shouldn't outlive an admin-set password.
  await prisma.passwordResetToken.deleteMany({ where: { userId } });

  return ok("Password updated.");
}

export async function deleteUser(
  userId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  const admin = await requireRole("ADMIN");
  if (userId === admin.id) return fail("You can't delete your own account.");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      _count: {
        select: {
          listingsAsAgent: true,
          dealsAsAgent: true,
          commissionsAsAgent: true,
          developerRequestsMade: true,
        },
      },
    },
  });
  if (!user) return fail("User not found.");

  if (user.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return fail("You can't delete the last admin.");
  }

  const c = user._count;
  const owned = [
    c.listingsAsAgent && `${c.listingsAsAgent} listing(s)`,
    c.dealsAsAgent && `${c.dealsAsAgent} deal(s)`,
    c.commissionsAsAgent && `${c.commissionsAsAgent} commission(s)`,
    c.developerRequestsMade && `${c.developerRequestsMade} developer request(s)`,
  ].filter(Boolean);
  if (owned.length) {
    return fail(`This user still owns ${owned.join(", ")}. Delete or reassign those first.`);
  }

  await prisma.user.delete({ where: { id: userId } });

  refresh("/admin/dashboard/users", "/admin/dashboard");
  return ok("User deleted.");
}

// ------------------------------------------------------------- Listings

export async function updateListingStatus(
  listingId: number,
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const status = formData.get("status");
  if (typeof status !== "string" || !LISTING_STATUSES.includes(status as ListingStatus)) {
    return fail("Invalid status.");
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      slug: true,
      title: true,
      status: true,
      agent: { select: { name: true, email: true } },
    },
  });
  if (!listing) return fail("Listing not found.");

  const nextStatus = status as ListingStatus;
  await prisma.listing.update({ where: { id: listingId }, data: { status: nextStatus } });

  // If status changed and agent has an email, send review decision email
  if (listing.status !== nextStatus && listing.agent?.email) {
    const host = (await headers()).get("host") ?? "";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const listingUrl = `${protocol}://${host}/listings/${listing.slug}`;
    const outcome = nextStatus === "ACTIVE" ? "Approved" : nextStatus === "DRAFT" ? "Rejected" : nextStatus;
    const reviewNotes = typeof formData.get("notes") === "string" ? String(formData.get("notes")) : null;

    await sendListingReviewDecisionEmail(listing.agent.email, {
      agentName: listing.agent.name,
      listingTitle: listing.title,
      status: outcome,
      listingUrl,
      reviewNotes,
    });

    if (nextStatus === "ACTIVE") {
      await sendListingLiveEmail(listing.agent.email, {
        agentName: listing.agent.name,
        listingTitle: listing.title,
        listingUrl,
      });
    }
  }

  refresh("/admin/dashboard/listings", "/listings", `/listings/${listing.slug}`, "/");
  return ok("Status updated.");
}

export async function deleteListingAdmin(
  listingId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { slug: true },
  });
  if (!listing) return fail("Listing not found.");

  await prisma.listing.delete({ where: { id: listingId } });

  refresh("/admin/dashboard/listings", "/admin/dashboard", "/listings", "/");
  return ok("Listing deleted.");
}

// ---------------------------------------------------------------- Deals

// Reuses updateDeal so closing a deal still creates its booking, notifies, etc.
export async function updateDealAdmin(
  dealId: number,
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");
  const result = await updateDeal(dealId, undefined, formData);
  if (result?.errors) {
    const first = Object.values(result.errors).flat()[0];
    return fail(first ?? "Invalid input.");
  }
  if (result?.message === "Deal updated.") {
    refresh("/admin/dashboard/deals", "/admin/dashboard");
    return ok("Deal updated.");
  }
  return fail(result?.message ?? "Could not update the deal.");
}

export async function deleteDealAdmin(
  dealId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const deal = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
  if (!deal) return fail("Deal not found.");

  await prisma.deal.delete({ where: { id: dealId } });

  refresh(
    "/admin/dashboard/deals",
    "/admin/dashboard/bookings",
    "/admin/dashboard/commissions",
    "/admin/dashboard"
  );
  return ok("Deal deleted.");
}

// -------------------------------------------------------------- Reviews

export async function deleteReview(
  reviewId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { id: true } });
  if (!review) return fail("Review not found.");

  await prisma.review.delete({ where: { id: reviewId } });

  refresh("/admin/dashboard/reviews", "/admin/dashboard");
  return ok("Review deleted.");
}

export async function toggleReviewVerified(
  reviewId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { isVerified: true },
  });
  if (!review) return fail("Review not found.");

  await prisma.review.update({ where: { id: reviewId }, data: { isVerified: !review.isVerified } });

  refresh("/admin/dashboard/reviews");
  return ok(review.isVerified ? "Marked unverified." : "Marked verified.");
}

// --------------------------------------------------------------- Videos

export async function deleteVideoAdmin(
  videoId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const video = await prisma.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) return fail("Video not found.");

  await prisma.video.delete({ where: { id: videoId } });

  refresh("/admin/dashboard/videos", "/admin/dashboard", "/videos", "/listings");
  return ok("Video deleted.");
}

// ----------------------------------------------------------------- Tags

export async function createDefaultTag(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").toLowerCase();
  if (!name) return fail("Tag name is required.");
  if (name.length > 20) return fail("Tag name must be 20 characters or fewer.");
  if (!(TAG_COLOR_KEYS as readonly string[]).includes(color)) return fail("Choose a valid colour.");

  const existing = await prisma.tag.findMany({ where: { isDefault: true }, select: { name: true } });
  if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    return fail("A default tag with that name already exists.");
  }

  await prisma.tag.create({ data: { name, color, isDefault: true, createdBy: null } });

  refresh("/admin/dashboard/tags");
  return ok(`Created default tag “${name}”.`);
}

export async function deleteTagAdmin(
  tagId: number,
  _prev: AdminActionState,
  _formData: FormData
): Promise<AdminActionState> {
  await requireRole("ADMIN");

  const tag = await prisma.tag.findUnique({ where: { id: tagId }, select: { id: true } });
  if (!tag) return fail("Tag not found.");

  await prisma.tag.delete({ where: { id: tagId } });

  refresh("/admin/dashboard/tags", "/admin/dashboard/listings", "/listings");
  return ok("Tag deleted. Listings using it were untagged.");
}
