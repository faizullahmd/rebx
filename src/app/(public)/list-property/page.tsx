import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function ListPropertyPage() {
  const session = await auth();

  // 1. If logged out, redirect to login page
  if (!session?.user) {
    redirect("/login");
  }

  // 2. If logged in as an AGENT (or ADMIN), redirect to new listing page
  if (session.user.role === "AGENT" || session.user.role === "ADMIN") {
    redirect("/agent/dashboard/listings/new");
  }

  // 3. If user is a CUSTOMER, display the dedicated ineligible / become an agent page
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="w-full rounded-xl border border-neutral-200 bg-white p-8 shadow-sm sm:p-12">
        <div className="flex flex-col items-center text-center">
          {/* Subtle Icon */}
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-800">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <span className="mt-5 inline-flex items-center rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-neutral-600">
            Customer Account
          </span>

          <h1 className="mt-4 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
            You are not eligible to list a property
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-neutral-600 sm:text-base">
            Listing properties on the REBX exchange is exclusive to registered real estate agents and brokers. Customer accounts can search and view listings, but cannot publish new properties.
          </p>
        </div>

        {/* Upgrade / Become an Agent Info Box */}
        <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50/70 p-6 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Want to list properties? Become an Agent
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600 sm:text-sm">
                Register an Agent account to list commercial and residential properties, connect with developers, manage deal pipelines, and track transactions through to commission.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-800"
          >
            Become an Agent
          </Link>
          <Link
            href="/customer/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            Customer Dashboard
          </Link>
          <Link
            href="/listings"
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
          >
            Browse Listings →
          </Link>
        </div>
      </div>
    </div>
  );
}
