import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { claimNextRenderJobForWorker } from "@/lib/video-studio/render-jobs";
import { WORKER_NO_STORE_HEADERS } from "@/lib/video-studio/worker-auth";
import { handleWorkerPost } from "@/lib/video-studio/worker-http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleWorkerPost(req, async (body) => {
    const result = await claimNextRenderJobForWorker(body);
    if (result.claimed || result.recoveredCount > 0) {
      try {
        revalidatePath("/admin/dashboard/video-studio");
        if (result.job?.projectId) {
          revalidatePath(`/admin/dashboard/video-studio/${result.job.projectId}`);
        }
      } catch {
        // Ignore outside Next.js request cache context
      }
    }
    return NextResponse.json(
      {
        ok: true,
        claimed: result.claimed,
        recoveredCount: result.recoveredCount,
        job: result.job,
      },
      { status: 200, headers: WORKER_NO_STORE_HEADERS },
    );
  });
}

