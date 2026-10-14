import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ListingForm } from "@/components/listings/ListingForm";
import { updateListing } from "@/lib/actions/listings";
import { getDevelopers, getListingById } from "@/lib/data/listings";

export default async function AdminEditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listingId = Number(id);
  if (Number.isNaN(listingId)) notFound();

  await requireRole("ADMIN");
  const [listing, developers] = await Promise.all([getListingById(listingId), getDevelopers()]);
  if (!listing) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/dashboard/listings" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Back to listings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit listing</h1>
        <p className="text-sm text-neutral-500">Editing as admin: {listing.title}</p>
      </div>
      <ListingForm
        action={updateListing.bind(null, listingId)}
        listing={{
          ...listing,
          price: listing.price != null ? Number(listing.price) : null,
          projectArea: (listing as any).projectArea != null ? Number((listing as any).projectArea) : null,
        }}
        developers={developers}
        submitLabel="Save changes"
        canAddVideo={true}
      />
    </div>
  );
}
