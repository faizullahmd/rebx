import { NextResponse, type NextRequest } from "next/server";
import { recoverExpiredRenderJobs } from "@/lib/video-studio/render-jobs";
import { WORKER_NO_STORE_HEADERS } from "@/lib/video-studio/worker-auth";
import { handleWorkerPost } from "@/lib/video-studio/worker-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleWorkerPost(
    req,
    async (body) => {
      const result = await recoverExpiredRenderJobs(body);
      return NextResponse.json(
        {
          ok: true,
          ...result,
        },
        { status: 200, headers: WORKER_NO_STORE_HEADERS },
      );
    },
    { allowEmptyBody: true },
  );
}

