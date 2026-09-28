import Link from "next/link";
import { auth } from "@/auth";

export async function PublicFooter() {
  const session = await auth();
  const agentHref = session?.user ? "/agent/dashboard" : "/login";

  return (
    <footer className="border-t border-neutral-200 bg-neutral-50/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
          <div className="flex flex-col items-center gap-2 text-center md:items-start md:text-left">
            <Link href="/" className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="REBX" className="h-8 w-auto" />
            </Link>
            <p className="text-sm font-medium text-neutral-700">
              Real Estate Broker Exchange
            </p>
            <p className="text-xs text-neutral-500 max-w-xs">
              The centralized exchange platform connecting agents, developers, and customers from listing to closing.
            </p>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-sm">
            <Link
              href="/listings"
              className="text-neutral-600 transition-colors hover:text-neutral-900"
            >
              Browse Listings
            </Link>
            <Link
              href={agentHref}
              className="text-neutral-600 transition-colors hover:text-neutral-900"
            >
              Join as an Agent
            </Link>
            <Link
              href="/dashboard"
              className="text-neutral-600 transition-colors hover:text-neutral-900"
            >
              My Dashboard
            </Link>
          </nav>
        </div>

        <div className="mt-10 border-t border-neutral-200 pt-6 text-center text-xs text-neutral-500">
          <p>© {new Date().getFullYear()} REBX — Real Estate Broker Exchange. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
