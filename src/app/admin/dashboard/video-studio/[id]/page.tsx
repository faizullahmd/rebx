import { notFound } from "next/navigation";
import { getProjectRenderJobs, getProjectVersions, getProjectWithScenes } from "@/lib/data/video-studio";
import Workspace from "./Workspace";

export default async function VideoDraftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, versions, renderJobs] = await Promise.all([
    getProjectWithScenes(id),
    getProjectVersions(id),
    getProjectRenderJobs(id),
  ]);

  if (!data) {
    notFound();
  }

  return (
    <Workspace
      project={data.project}
      initialScenes={data.scenes}
      versionedJson={data.versionedJson}
      initialVersions={versions}
      initialRenderJobs={renderJobs}
    />
  );
}
