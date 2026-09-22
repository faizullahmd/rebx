import Link from "next/link";
import { auth } from "@/auth";
import { logout } from "@/lib/actions/auth";

export async function PublicNav() {
  const session = await auth();

  return (
    <header className="border-b border-gray-200">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          REBX
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/listings" className="text-gray-600 hover:text-gray-900">
            Browse listings
          </Link>
          {session?.user ? (
            <>
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                My dashboard
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-600 hover:text-gray-900">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-gray-900 px-3 py-1.5 text-white hover:bg-gray-700"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
