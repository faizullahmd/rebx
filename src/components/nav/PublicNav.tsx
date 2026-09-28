import Link from "next/link";
import { auth } from "@/auth";
import { logout } from "@/lib/actions/auth";

export async function PublicNav() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200/80 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="REBX" className="h-8 sm:h-9 w-auto object-contain" />
        </Link>

        <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium">
          <Link
            href="/listings"
            className="text-neutral-600 transition-colors hover:text-neutral-900"
          >
            Browse Listings
          </Link>

          {session?.user ? (
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href="/dashboard"
                className="text-neutral-600 transition-colors hover:text-neutral-900"
              >
                My Dashboard
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
                >
                  Log out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-3 sm:gap-4">
              <Link
                href="/login"
                className="text-neutral-600 transition-colors hover:text-neutral-900"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-neutral-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800"
              >
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
