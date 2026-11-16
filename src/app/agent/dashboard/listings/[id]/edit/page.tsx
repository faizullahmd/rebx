import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { ListingForm } from "@/components/listings/ListingForm";
import { updateListing } from "@/lib/actions/listings";
import { getDevelopers, getListingById } from "@/lib/data/listings";

export const dynamic = "force-dynamic";

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

  if (!listing) {
    notFound();
  }

  // Access check: agents can only edit listings assigned to their account
  if (listing.agentId !== user.id) {
    return (
      <div className="flex flex-col gap-6 max-w-4xl">
        <div>
          <Link
            href="/agent/dashboard/listings"
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900 transition"
          >
            ← Back to my listings
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-neutral-900">
            Edit listing
          </h1>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-6 text-neutral-800 shadow-xs">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 font-bold text-base">
              !
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-neutral-900">
                Access Restricted
              </h2>
              <p className="mt-1 text-sm text-neutral-700 leading-relaxed">
                Listing <strong>&ldquo;{listing.title}&rdquo;</strong> (ID: {listing.id}) is assigned to agent{" "}
                <strong>{listing.agent?.name || listing.agent?.email || "another agent"}</strong>.
              </p>
              <p className="mt-2 text-xs text-neutral-500">
                You are currently signed in as <strong>{user.name}</strong> ({user.email}). In REBX, agents can only edit listings assigned to their own account.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  href="/agent/dashboard/listings"
                  className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition shadow-xs"
                >
                  View My Listings
                </Link>
                <Link
                  href={`/listings/${listing.slug}`}
                  target="_blank"
                  className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition shadow-2xs"
                >
                  View Public Listing ↗
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Edit listing</h1>
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
