import { NextResponse } from "next/server";
import { getVideoDetails, isValidVideoUrl } from "@/lib/video";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url || !isValidVideoUrl(url)) {
    return NextResponse.json({ error: "Invalid video URL" }, { status: 400 });
  }

  const details = await getVideoDetails(url);
  if (!details) {
    return NextResponse.json({ error: "Could not parse video URL" }, { status: 400 });
  }

  return NextResponse.json(details);
}
