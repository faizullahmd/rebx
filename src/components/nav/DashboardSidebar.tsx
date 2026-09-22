import Link from "next/link";
import { logout } from "@/lib/actions/auth";

type NavItem = { href: string; label: string };

export function DashboardSidebar({
  roleLabel,
  items,
  userName,
}: {
  roleLabel: string;
  items: NavItem[];
  userName: string;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-gray-200 px-4 py-6">
      <div>
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="REBX" className="h-8 w-auto" />
        </Link>
        <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">{roleLabel}</p>
        <nav className="mt-6 flex flex-col gap-1 text-sm">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-gray-700 hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-gray-200 pt-4 text-sm">
        <p className="truncate text-gray-600">{userName}</p>
        <form action={logout} className="mt-2">
          <button type="submit" className="text-gray-500 hover:text-gray-900">
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}
