import { redirect } from "next/navigation";
import { ListingForm } from "@/components/listings/ListingForm";
import { createListing } from "@/lib/actions/listings";
import { getDevelopers } from "@/lib/data/listings";
import { requireRole } from "@/lib/session";

export default async function DeveloperNewListingPage() {
  const developer = await requireRole("DEVELOPER");
  if (!developer.username) {
    redirect("/account?required=username");
  }

  const developers = await getDevelopers();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New listing</h1>
      <ListingForm
        action={createListing}
        developers={developers}
        submitLabel="Create listing"
        canAddVideo={true}
      />
    </div>
  );
}
