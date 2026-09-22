import Link from "next/link";
import { requireRole } from "@/lib/session";

export default async function CustomerDashboardPage() {
  const user = await requireRole("CUSTOMER");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="max-w-md text-gray-600">
        Your saved properties and inquiries will show up here in a future update. For now,
        browse listings and reach out to agents directly.
      </p>
      <Link
        href="/listings"
        className="w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Browse listings
      </Link>
    </div>
  );
}
