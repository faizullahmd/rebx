import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { failRenderJobForWorker } from "@/lib/video-studio/render-jobs";
import { WORKER_NO_STORE_HEADERS } from "@/lib/video-studio/worker-auth";
import { handleWorkerPost } from "@/lib/video-studio/worker-http";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  return handleWorkerPost(req, async (body) => {
    const job = await failRenderJobForWorker(jobId, body);
    try {
      revalidatePath("/admin/dashboard/video-studio");
      revalidatePath(`/admin/dashboard/video-studio/${job.projectId}`);
    } catch {
      // Ignore outside Next.js request cache context
    }
    return NextResponse.json(
      { ok: true, job },
      { status: 200, headers: WORKER_NO_STORE_HEADERS },
    );
  });
}

