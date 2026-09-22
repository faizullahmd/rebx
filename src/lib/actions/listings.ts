"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/session";
import { ListingFormSchema, type ListingFormState } from "@/lib/validation/listing";
import {
  DeveloperRequestFieldsSchema,
  REQUEST_NEW_DEVELOPER_VALUE,
} from "@/lib/validation/developer-request";
import { sendDeveloperRequestNotification } from "@/lib/email";

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

async function createDeveloperRequest(
  listingId: string,
  listingTitle: string,
  agentId: string,
  agentName: string,
  formData: FormData
) {
  const existingPending = await prisma.developerRequest.findFirst({
    where: { listingId, status: "PENDING" },
  });
  if (existingPending) {
    return "A developer request for this listing is already pending admin approval.";
  }

  const { requestDeveloperCompanyName, requestDeveloperContactName, requestDeveloperEmail, requestDeveloperPhone } =
    DeveloperRequestFieldsSchema.parse(Object.fromEntries(formData));

  await prisma.developerRequest.create({
    data: {
      listingId,
      requestedById: agentId,
      companyName: requestDeveloperCompanyName,
      contactName: requestDeveloperContactName,
      contactEmail: requestDeveloperEmail,
      contactPhone: requestDeveloperPhone || null,
    },
  });

  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const host = (await headers()).get("host") ?? "";
  const protocol = host.startsWith("localhost") ? "http" : "https";

  await sendDeveloperRequestNotification(
    admins.map((a) => a.email),
    {
      companyName: requestDeveloperCompanyName,
      contactName: requestDeveloperContactName,
      listingTitle,
      requestedByName: agentName,
      reviewUrl: `${protocol}://${host}/admin/dashboard/developer-requests`,
    }
  );

  return null;
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

  const requestingNewDeveloper = validatedFields.data.developerId === REQUEST_NEW_DEVELOPER_VALUE;
  if (requestingNewDeveloper) {
    const fieldsValidation = DeveloperRequestFieldsSchema.safeParse(Object.fromEntries(formData));
    if (!fieldsValidation.success) {
      return { errors: fieldsValidation.error.flatten().fieldErrors };
    }
  }

  const {
    imageUrls,
    developerId,
    requestDeveloperCompanyName: _requestDeveloperCompanyName,
    requestDeveloperContactName: _requestDeveloperContactName,
    requestDeveloperEmail: _requestDeveloperEmail,
    requestDeveloperPhone: _requestDeveloperPhone,
    ...data
  } = validatedFields.data;

  const listing = await prisma.listing.create({
    data: {
      ...data,
      state: data.state || null,
      postalCode: data.postalCode || null,
      slug: slugify(data.title),
      agentId: agent.id,
      developerId: requestingNewDeveloper ? null : developerId || null,
      images: {
        create: parseImageUrls(imageUrls).map((url, sortOrder) => ({ url, sortOrder })),
      },
    },
  });

  if (requestingNewDeveloper) {
    // A brand-new listing can't already have a pending request, so the "already
    // pending" branch of createDeveloperRequest never applies here.
    await createDeveloperRequest(listing.id, listing.title, agent.id, agent.name, formData);
  }

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

  const requestingNewDeveloper = validatedFields.data.developerId === REQUEST_NEW_DEVELOPER_VALUE;
  if (requestingNewDeveloper) {
    const fieldsValidation = DeveloperRequestFieldsSchema.safeParse(Object.fromEntries(formData));
    if (!fieldsValidation.success) {
      return { errors: fieldsValidation.error.flatten().fieldErrors };
    }
  }

  const {
    imageUrls,
    developerId,
    requestDeveloperCompanyName: _requestDeveloperCompanyName,
    requestDeveloperContactName: _requestDeveloperContactName,
    requestDeveloperEmail: _requestDeveloperEmail,
    requestDeveloperPhone: _requestDeveloperPhone,
    ...data
  } = validatedFields.data;
  const urls = parseImageUrls(imageUrls);

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        ...data,
        state: data.state || null,
        postalCode: data.postalCode || null,
        ...(requestingNewDeveloper ? {} : { developerId: developerId || null }),
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

  let requestMessage: string | null = null;
  if (requestingNewDeveloper) {
    requestMessage = await createDeveloperRequest(
      listingId,
      existing.title,
      user.id,
      user.name,
      formData
    );
  }

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/developer/dashboard");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
  revalidatePath(`/listings/${existing.slug}`);

  return { message: requestMessage ?? "Listing updated." };
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
