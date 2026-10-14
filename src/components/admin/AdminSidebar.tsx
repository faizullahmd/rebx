"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions/auth";

const groups: { title: string; items: { href: string; label: string }[] }[] = [
  { title: "Overview", items: [{ href: "/admin/dashboard", label: "Dashboard" }] },
  { title: "People", items: [{ href: "/admin/dashboard/users", label: "Users" }] },
  {
    title: "Marketplace",
    items: [
      { href: "/admin/dashboard/listings", label: "Listings" },
      { href: "/admin/dashboard/deals", label: "Deals & inquiries" },
      { href: "/admin/dashboard/bookings", label: "Bookings" },
      { href: "/admin/dashboard/commissions", label: "Commissions" },
      { href: "/admin/dashboard/developer-requests", label: "Developer requests" },
    ],
  },
  {
    title: "Content",
    items: [
      { href: "/admin/dashboard/reviews", label: "Reviews" },
      { href: "/admin/dashboard/videos", label: "Videos" },
      { href: "/admin/dashboard/tags", label: "Tags" },
      { href: "/admin/dashboard/email-templates", label: "Email templates" },
    ],
  },
];

export function AdminSidebar({ userName, userEmail }: { userName: string; userEmail: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) =>
    href === "/admin/dashboard" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            {group.title}
          </p>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition ${
                isActive(item.href)
                  ? "bg-gray-900 font-medium text-white"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
      <Link href="/" target="_blank" className="px-3 text-sm text-neutral-600 hover:text-neutral-900">
        View public site ↗
      </Link>
      <Link href="/account" className="px-3 text-sm text-neutral-600 hover:text-neutral-900">
        Account settings
      </Link>
      <div className="px-3 pt-1">
        <p className="truncate text-sm font-medium text-neutral-900">{userName}</p>
        <p className="truncate text-xs text-neutral-500">{userEmail}</p>
      </div>
      <form action={logout} className="px-3">
        <button type="submit" className="text-sm text-red-600 hover:text-red-800">
          Log out
        </button>
      </form>
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <span className="text-sm font-semibold">REBX Admin</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle admin menu"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-6 border-b border-neutral-200 bg-white p-4 md:hidden">
          {nav}
          {footer}
        </div>
      )}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between overflow-y-auto border-r border-neutral-200 bg-white p-5 md:flex">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-lg font-semibold tracking-tight">REBX</p>
            <p className="text-xs uppercase tracking-wider text-neutral-400">Admin panel</p>
          </div>
          {nav}
        </div>
        {footer}
      </aside>
    </>
  );
}
