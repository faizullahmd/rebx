import Link from "next/link";
import { ListingCard } from "@/components/listings/ListingCard";
import { getRecentActiveListings } from "@/lib/data/listings";

export default async function HomePage() {
  const listings = await getRecentActiveListings(6);

  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col items-start gap-4 py-12">
        <h1 className="text-4xl font-semibold tracking-tight">
          The exchange platform for real estate brokers.
        </h1>
        <p className="max-w-xl text-gray-600">
          REBX connects agents, developers, and customers — from listing a property to
          tracking every deal through to commission received.
        </p>
        <div className="flex gap-3">
          <Link
            href="/listings"
            className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Browse listings
          </Link>
          <Link
            href="/signup"
            className="rounded-md border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Join as an agent
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Recently listed</h2>
          <Link href="/listings" className="text-sm text-gray-600 hover:text-gray-900">
            View all →
          </Link>
        </div>
        {listings.length === 0 ? (
          <p className="text-sm text-gray-500">No active listings yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
