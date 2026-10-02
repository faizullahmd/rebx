import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { validateUsernameFormat, normalizeUsername } from "@/lib/validation/username";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 60;

  const current = rateLimitMap.get(ip);
  if (!current || now > current.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }

  current.count += 1;
  if (current.count > maxRequests) {
    return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { available: false, state: "error", error: "Too many requests. Please wait a moment." },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawValue = searchParams.get("value") ?? "";

  if (!rawValue) {
    return NextResponse.json({
      available: false,
      state: "invalid",
      error: "Username is required.",
    });
  }

  const validation = validateUsernameFormat(rawValue);
  if (!validation.valid) {
    return NextResponse.json({
      available: false,
      state: "invalid",
      error: validation.error,
    });
  }

  const normalized = normalizeUsername(rawValue);

  try {
    // Check if it's the current user's own username
    const session = await auth();
    if (session?.user?.id) {
      const currentUserId = Number(session.user.id);
      if (!Number.isNaN(currentUserId)) {
        const currentUser = await prisma.user.findUnique({
          where: { id: currentUserId },
          select: { username: true },
        });
        if (currentUser?.username?.toLowerCase() === normalized) {
          return NextResponse.json({
            available: true,
            state: "current",
            message: "This is your current username.",
          });
        }
      }
    }

    const existing = await prisma.user.findUnique({
      where: { username: normalized },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json({
        available: false,
        state: "taken",
        error: "This username is already taken.",
      });
    }

    return NextResponse.json({
      available: true,
      state: "available",
      message: "Username is available.",
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error("Username check error:", error);
    return NextResponse.json(
      { available: false, state: "error", error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}
