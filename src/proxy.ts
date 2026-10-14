import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import type { Role } from "@prisma/client";

const roleForPrefix: Record<string, Role> = {
  "/agent": "AGENT",
  "/developer": "DEVELOPER",
  "/customer": "CUSTOMER",
};

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/list-property") {
    const session = await auth();
    if (!session?.user) {
      const loginUrl = new URL("/login", req.nextUrl);
      loginUrl.searchParams.set("callbackUrl", "/agent/dashboard/listings/new");
      return NextResponse.redirect(loginUrl);
    }
    if (session.user.role === "AGENT" || session.user.role === "ADMIN") {
      return NextResponse.redirect(new URL("/agent/dashboard/listings/new", req.nextUrl));
    }
    return NextResponse.next();
  }

  // The admin panel has its own login page, so unauthenticated admin requests go there
  // (not the public /login), and /admin/login itself must stay reachable when logged out.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const session = await auth();
    const isLoginPage = pathname === "/admin/login";
    if (!session?.user) {
      if (isLoginPage) return NextResponse.next();
      const loginUrl = new URL("/admin/login", req.nextUrl);
      if (pathname !== "/admin") loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (session.user.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl));
    }
    if (isLoginPage || pathname === "/admin") {
      return NextResponse.redirect(new URL("/admin/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }

  const isAccount = pathname === "/account" || pathname.startsWith("/account/");
  const prefix = Object.keys(roleForPrefix).find(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!isAccount && !prefix) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.user) {
    const loginUrl = new URL("/login", req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!isAccount && session.user.role !== roleForPrefix[prefix!]) {
    return NextResponse.redirect(new URL("/unauthorized", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/agent/:path*",
    "/developer/:path*",
    "/customer/:path*",
    "/admin/:path*",
    "/account/:path*",
    "/list-property",
  ],
};
