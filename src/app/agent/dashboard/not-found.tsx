import Link from "next/link";

export default function AgentDashboardNotFound() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center my-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 mb-4 font-bold text-xl">
        404
      </div>
      <h2 className="text-xl font-bold tracking-tight text-neutral-900">
        Listing Not Found
      </h2>
      <p className="mt-1 text-sm text-neutral-500 max-w-md">
        The listing you are looking for does not exist, was deleted, or the link is incorrect.
      </p>
      <Link
        href="/agent/dashboard/listings"
        className="mt-5 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 transition-colors shadow-xs"
      >
        Back to My Listings
      </Link>
    </div>
  );
}

