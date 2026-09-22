import { ListingForm } from "@/components/listings/ListingForm";
import { createListing } from "@/lib/actions/listings";
import { getDevelopers } from "@/lib/data/listings";

export default async function NewListingPage() {
  const developers = await getDevelopers();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New listing</h1>
      <ListingForm action={createListing} developers={developers} submitLabel="Create listing" />
    </div>
  );
}
