import { NextRequest, NextResponse } from "next/server";
import {
  processSiteVisitReminders,
  verifyCronAuthHeaders,
} from "@/lib/site-visit-reminders";

export const dynamic = "force-dynamic";

function verifyCronAuth(req: NextRequest): boolean {
  return verifyCronAuthHeaders({
    authHeader: req.headers.get("authorization"),
    cronHeader: req.headers.get("x-cron-secret"),
    querySecret: req.nextUrl.searchParams.get("secret"),
    configuredSecret: process.env.CRON_SECRET,
    isProduction: process.env.NODE_ENV === "production",
  });
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      { error: "Unauthorized. Valid CRON_SECRET required." },
      { status: 401 }
    );
  }

  try {
    const siteBaseUrl = req.nextUrl.origin;
    const result = await processSiteVisitReminders({ siteBaseUrl });
    return NextResponse.json(result);
  } catch (err) {
    console.error("Cron site visit reminders error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
