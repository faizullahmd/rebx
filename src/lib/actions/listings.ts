"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/session";
import { ListingFormSchema, type ListingFormState } from "@/lib/validation/listing";

function parseImageUrls(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function slugify(title: string) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function createListing(
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const agent = await requireRole("AGENT");

  const validatedFields = ListingFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { imageUrls, developerId, ...data } = validatedFields.data;

  const listing = await prisma.listing.create({
    data: {
      ...data,
      state: data.state || null,
      postalCode: data.postalCode || null,
      slug: slugify(data.title),
      agentId: agent.id,
      developerId: developerId || null,
      images: {
        create: parseImageUrls(imageUrls).map((url, sortOrder) => ({ url, sortOrder })),
      },
    },
  });

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/listings");
  redirect(`/agent/dashboard/listings/${listing.id}/edit`);
}

export async function updateListing(
  listingId: string,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const user = await requireUser();

  const existing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!existing) {
    return { message: "Listing not found." };
  }
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    return { message: "You are not allowed to edit this listing." };
  }

  const validatedFields = ListingFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { imageUrls, developerId, ...data } = validatedFields.data;
  const urls = parseImageUrls(imageUrls);

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        ...data,
        state: data.state || null,
        postalCode: data.postalCode || null,
        developerId: developerId || null,
      },
    }),
    prisma.listingImage.deleteMany({ where: { listingId } }),
    ...(urls.length
      ? [
          prisma.listingImage.createMany({
            data: urls.map((url, sortOrder) => ({ listingId, url, sortOrder })),
          }),
        ]
      : []),
  ]);

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/developer/dashboard");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
  revalidatePath(`/listings/${existing.slug}`);

  return { message: "Listing updated." };
}

export async function deleteListing(listingId: string) {
  const user = await requireUser();

  const existing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!existing) return;
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    throw new Error("You are not allowed to delete this listing.");
  }

  await prisma.listing.delete({ where: { id: listingId } });

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
}
