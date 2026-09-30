import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import type { Role } from "@prisma/client";

const roleForPrefix: Record<string, Role> = {
  "/agent": "AGENT",
  "/developer": "DEVELOPER",
  "/customer": "CUSTOMER",
  "/admin": "ADMIN",
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
