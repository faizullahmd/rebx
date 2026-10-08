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
import { canAddVideo, canAttachVideo } from "@/lib/video";
import { parsePriceInput } from "@/lib/price";

function parseImageUrls(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function parseVideoData(raw: FormDataEntryValue | null): { url: string; title?: string }[] {
  if (!raw || typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.url === "string" && item.url.trim())
        .slice(0, 3)
        .map((item) => ({
          url: item.url.trim(),
          title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined,
        }));
    }
  } catch {
    return raw
      .split(/[\n,]/)
      .map((url) => url.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((url) => ({ url }));
  }
  return [];
}

function parseDeveloperId(raw: string | undefined) {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
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
  listingId: number,
  listingTitle: string,
  agentId: number,
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
  const user = await requireUser();
  if (user.role !== "AGENT" && user.role !== "DEVELOPER" && user.role !== "ADMIN") {
    redirect("/unauthorized");
  }

  if (!user.username) {
    return {
      errors: {
        title: ["You must set a unique portfolio username in Account Settings before creating a listing."],
      },
    };
  }

  const validatedFields = ListingFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Please check the form. Some required fields are missing or invalid.",
    };
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
    videoId,
    requestDeveloperCompanyName: _requestDeveloperCompanyName,
    requestDeveloperContactName: _requestDeveloperContactName,
    requestDeveloperEmail: _requestDeveloperEmail,
    requestDeveloperPhone: _requestDeveloperPhone,
    ...data
  } = validatedFields.data;

  const isDeveloperUser = user.role === "DEVELOPER";
  const finalAgentId = user.id;
  const finalDeveloperId = isDeveloperUser
    ? user.id
    : requestingNewDeveloper
      ? null
      : parseDeveloperId(developerId);

  const canAttach = canAttachVideo(user.role);
  let finalVideoId: number | null = null;
  let finalVideoUrl: string | null = null;

  if (videoId) {
    if (!canAttach) {
      return {
        errors: {
          videoId: ["You do not have permission to attach videos to listings."],
        },
      };
    }
    const existingVideo = await prisma.video.findUnique({
      where: { id: videoId },
    });
    if (existingVideo) {
      finalVideoId = existingVideo.id;
      finalVideoUrl = existingVideo.url;
    }
  } else if (data.videoUrl && canAttach) {
    finalVideoUrl = data.videoUrl;
  }

  const videos = parseVideoData(formData.get("videoData"));
  const { numericPrice, priceDisplay } = parsePriceInput(data.price);

  const listing = await prisma.listing.create({
    data: {
      ...data,
      price: numericPrice,
      priceDisplay: priceDisplay,
      currency: data.currency?.trim() || "INR",
      videoId: finalVideoId,
      videoUrl: finalVideoUrl,
      state: data.state || null,
      postalCode: data.postalCode || null,
      reraId: data.reraId || null,
      avgPricePerSqFt: data.avgPricePerSqFt || null,
      possessionStarts: data.possessionStarts || null,
      propertyCategory: data.propertyCategory || null,
      propertyType: data.propertyType || null,
      furnishing: data.furnishing || null,
      parkingSpots: data.parkingSpots ?? null,
      facing: data.facing || null,
      propertyAgeYears: data.propertyAgeYears ?? null,
      availability: data.availability || null,
      slug: slugify(data.title),
      agentId: finalAgentId,
      developerId: finalDeveloperId,
      images: {
        create: parseImageUrls(imageUrls).map((url, sortOrder) => ({ url, sortOrder })),
      },
      videos: {
        create: videos.map((v, sortOrder) => ({
          url: v.url,
          title: v.title || null,
          sortOrder,
        })),
      },
    },
  });

  if (requestingNewDeveloper && !isDeveloperUser) {
    // A brand-new listing can't already have a pending request, so the "already
    // pending" branch of createDeveloperRequest never applies here.
    await createDeveloperRequest(listing.id, listing.title, user.id, user.name, formData);
  }

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/developer/dashboard");
  revalidatePath("/listings");
  revalidatePath("/videos");

  if (isDeveloperUser) {
    redirect(`/developer/dashboard/listings/${listing.id}/edit`);
  } else {
    redirect(`/agent/dashboard/listings/${listing.id}/edit`);
  }
}

export async function updateListing(
  listingId: number,
  _prevState: ListingFormState,
  formData: FormData
): Promise<ListingFormState> {
  const user = await requireUser();

  const existing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!existing) {
    return { success: false, message: "Listing not found." };
  }
  if (user.role !== "ADMIN" && existing.agentId !== user.id && existing.developerId !== user.id) {
    return { success: false, message: "You are not allowed to edit this listing." };
  }

  const validatedFields = ListingFormSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
      message: "Please check the form. Some required fields are missing or invalid.",
    };
  }

  const isDeveloperUser = user.role === "DEVELOPER";
  const requestingNewDeveloper = !isDeveloperUser && validatedFields.data.developerId === REQUEST_NEW_DEVELOPER_VALUE;
  if (requestingNewDeveloper) {
    const fieldsValidation = DeveloperRequestFieldsSchema.safeParse(Object.fromEntries(formData));
    if (!fieldsValidation.success) {
      return { errors: fieldsValidation.error.flatten().fieldErrors };
    }
  }

  const {
    imageUrls,
    developerId,
    videoId,
    requestDeveloperCompanyName: _requestDeveloperCompanyName,
    requestDeveloperContactName: _requestDeveloperContactName,
    requestDeveloperEmail: _requestDeveloperEmail,
    requestDeveloperPhone: _requestDeveloperPhone,
    ...data
  } = validatedFields.data;

  const canAttach = canAttachVideo(user.role);
  const isOwner = existing.developerId === user.id || existing.agentId === user.id;

  if (user.role !== "ADMIN" && !isOwner) {
    return { message: "You are not allowed to edit this listing." };
  }

  let finalVideoId: number | null | undefined = undefined;
  let finalVideoUrl: string | null | undefined = undefined;

  if (formData.has("videoId")) {
    if (!canAttach || (!isOwner && user.role !== "ADMIN")) {
      return {
        errors: {
          videoId: ["Only listing owners with permitted roles can attach or edit videos."],
        },
      };
    }

    if (videoId) {
      const existingVideo = await prisma.video.findUnique({
        where: { id: videoId },
      });
      if (existingVideo) {
        finalVideoId = existingVideo.id;
        finalVideoUrl = existingVideo.url;
      } else {
        finalVideoId = null;
        finalVideoUrl = null;
      }
    } else {
      finalVideoId = null;
      finalVideoUrl = null;
    }
  } else if (data.videoUrl !== undefined && data.videoUrl !== (existing.videoUrl || "")) {
    if (!canAttach || (!isOwner && user.role !== "ADMIN")) {
      return {
        errors: {
          videoUrl: ["Only listing owners can add or edit videos."],
        },
      };
    }
    finalVideoUrl = data.videoUrl || null;
  }

  const urls = parseImageUrls(imageUrls);
  const videos = parseVideoData(formData.get("videoData"));
  const { numericPrice, priceDisplay } = parsePriceInput(data.price);

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        ...data,
        price: numericPrice,
        priceDisplay: priceDisplay,
        currency: data.currency?.trim() || "INR",
        state: data.state || null,
        postalCode: data.postalCode || null,
        reraId: data.reraId || null,
        avgPricePerSqFt: data.avgPricePerSqFt || null,
        possessionStarts: data.possessionStarts || null,
        propertyCategory: data.propertyCategory || null,
        propertyType: data.propertyType || null,
        furnishing: data.furnishing || null,
        parkingSpots: data.parkingSpots ?? null,
        facing: data.facing || null,
        propertyAgeYears: data.propertyAgeYears ?? null,
        availability: data.availability || null,
        ...(finalVideoId !== undefined
          ? { videoId: finalVideoId, videoUrl: finalVideoUrl }
          : finalVideoUrl !== undefined
            ? { videoUrl: finalVideoUrl }
            : {}),
        ...(isDeveloperUser
          ? { developerId: existing.developerId ?? user.id }
          : requestingNewDeveloper
            ? {}
            : { developerId: parseDeveloperId(developerId) }),
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
    prisma.listingVideo.deleteMany({ where: { listingId } }),
    ...(videos.length
      ? [
          prisma.listingVideo.createMany({
            data: videos.map((v, sortOrder) => ({
              listingId,
              url: v.url,
              title: v.title || null,
              sortOrder,
            })),
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
  revalidatePath(`/agent/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/developer/dashboard/listings/${listingId}/edit`);
  revalidatePath("/listings");
  revalidatePath("/videos");
  revalidatePath(`/listings/${existing.slug}`);

  return {
    success: true,
    message: requestMessage ?? "Listing updated successfully.",
    slug: existing.slug,
  };
}

export async function saveListingVideos(
  listingId: number,
  videos: { url: string; title?: string }[]
) {
  const user = await requireUser();

  const existing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!existing) {
    throw new Error("Listing not found.");
  }
  if (user.role !== "ADMIN" && existing.agentId !== user.id && existing.developerId !== user.id) {
    throw new Error("You are not allowed to update videos for this listing.");
  }

  const validVideos = (videos || [])
    .filter((v) => v && typeof v.url === "string" && v.url.trim());

  await prisma.$transaction([
    prisma.listingVideo.deleteMany({ where: { listingId } }),
    ...(validVideos.length
      ? [
          prisma.listingVideo.createMany({
            data: validVideos.map((v, sortOrder) => ({
              listingId,
              url: v.url.trim(),
              title: v.title?.trim() || null,
              sortOrder,
            })),
          }),
        ]
      : []),
  ]);

  revalidatePath("/developer/dashboard");
  revalidatePath(`/developer/dashboard/listings/${listingId}/videos`);
  revalidatePath(`/developer/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listings/${existing.slug}`);

  return { success: true };
}

export async function deleteListing(listingId: number) {
  const user = await requireUser();

  const existing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!existing) return;
  if (user.role !== "ADMIN" && existing.agentId !== user.id && existing.developerId !== user.id) {
    throw new Error("You are not allowed to delete this listing.");
  }

  await prisma.listing.delete({ where: { id: listingId } });

  revalidatePath("/agent/dashboard/listings");
  revalidatePath("/agent/dashboard/portfolio");
  revalidatePath("/developer/dashboard");
  revalidatePath("/admin/dashboard/listings");
  revalidatePath("/listings");
  revalidatePath("/videos");
}

export async function updateListingTagAction(
  listingId: number,
  tag: string | null
): Promise<{ success: boolean; tag?: string | null; error?: string }> {
  try {
    const user = await requireUser();

    const existing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, agentId: true, developerId: true, slug: true, updatedAt: true },
    });

    if (!existing) {
      return { success: false, error: "Listing not found." };
    }

    if (user.role !== "ADMIN" && existing.agentId !== user.id && existing.developerId !== user.id) {
      return { success: false, error: "You are not authorized to update this listing." };
    }

    const validTags = ["new", "featured", "most_viewed", "few_units_left", "exclusive"];
    const sanitizedTag = tag && validTags.includes(tag) ? tag : null;

    // CRITICAL: Preserve existing.updatedAt so changing the tag never alters table ordering
    await prisma.listing.update({
      where: { id: listingId },
      data: {
        tags: sanitizedTag ? [sanitizedTag] : [],
        updatedAt: existing.updatedAt,
      },
    });

    revalidatePath("/agent/dashboard/listings");
    revalidatePath("/agent/dashboard/portfolio");
    revalidatePath(`/listings/${existing.slug}`);

    return { success: true, tag: sanitizedTag };
  } catch (err: any) {
    console.error("updateListingTagAction error:", err);
    return {
      success: false,
      error: err?.message || "An unexpected error occurred while updating the tag.",
    };
  }
}

