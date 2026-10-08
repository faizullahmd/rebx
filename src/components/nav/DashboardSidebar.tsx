"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on route change
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Close mobile menu on outside click or Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (
        mobileNavRef.current &&
        !mobileNavRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  return (
    <>
      {/* Mobile Navigation Container (md:hidden) */}
      <div ref={mobileNavRef} className="sticky top-0 z-30 md:hidden bg-white">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-xs">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="REBX" className="h-7 w-auto object-contain" />
            </Link>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
              {roleLabel}
            </span>
          </div>

          {/* Three-line horizontal button */}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className="rounded-lg p-2 text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-900 cursor-pointer"
            aria-label="Toggle dashboard menu"
            aria-expanded={isOpen}
          >
            {isOpen ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </header>

        {/* Mobile Dropdown Menu */}
        {isOpen && (
          <div className="border-b border-gray-200 bg-white px-4 pt-2 pb-5 shadow-lg animate-in slide-in-from-top-2 duration-150">
          <nav className="flex flex-col gap-1 text-sm">
            {items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className={`rounded-md px-3 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "bg-gray-100 font-semibold text-gray-900"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 border-t border-gray-200 pt-3 text-sm">
            <p className="truncate text-xs font-medium text-gray-500">{userName}</p>
            <form action={logout} className="mt-2">
              <button
                type="submit"
                className="w-full text-left text-sm font-medium text-red-600 hover:underline cursor-pointer"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>

      {/* Desktop Sidebar (hidden md:flex) */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col justify-between border-r border-gray-200 px-4 py-6 min-h-screen sticky top-0 bg-white">
        <div>
          <Link href="/" className="flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="REBX" className="h-8 w-auto" />
          </Link>
          <p className="mt-1 text-xs uppercase tracking-wide text-gray-400">{roleLabel}</p>
          <nav className="mt-6 flex flex-col gap-1 text-sm">
            {items.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 transition-colors ${
                    isActive
                      ? "bg-gray-100 font-medium text-gray-900"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="border-t border-gray-200 pt-4 text-sm">
          <p className="truncate text-gray-600">{userName}</p>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-gray-500 hover:text-gray-900 cursor-pointer">
              Log out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
