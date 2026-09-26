import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ListingForm } from "@/components/listings/ListingForm";
import { updateListing } from "@/lib/actions/listings";
import { getDevelopers, getListingById } from "@/lib/data/listings";

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listingId = Number(id);
  if (Number.isNaN(listingId)) {
    notFound();
  }

  const user = await requireRole("AGENT");
  const [listing, developers] = await Promise.all([
    getListingById(listingId),
    getDevelopers(),
  ]);

  if (!listing || listing.agentId !== user.id) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Edit listing</h1>
      <ListingForm
        action={updateListing.bind(null, listingId)}
        listing={{ ...listing, price: Number(listing.price) }}
        developers={developers}
        submitLabel="Save changes"
      />
    </div>
  );
}
