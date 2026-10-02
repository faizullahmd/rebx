import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getListingById } from "@/lib/data/listings";
import { DeveloperVideoManager } from "@/components/listings/DeveloperVideoManager";

export default async function DeveloperListingVideosPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listingId = Number(id);
  if (Number.isNaN(listingId)) {
    notFound();
  }

  const user = await requireRole("DEVELOPER");
  const listing = await getListingById(listingId);

  if (!listing || (listing.developerId !== user.id && listing.agentId !== user.id)) {
    notFound();
  }

  return (
    <DeveloperVideoManager
      listingId={listing.id}
      listingTitle={listing.title}
      initialVideos={listing.videos || []}
    />
  );
}
