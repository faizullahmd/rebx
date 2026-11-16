import { getProjectsDashboard } from "@/lib/data/video-studio";
import ProjectDashboardClient from "./ProjectDashboardClient";

export default async function VideoStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status ?? "ALL";
  const sort = sp.sort === "created" ? "created" : "updated";
  const q = sp.q ?? "";

  const { counts, projects } = await getProjectsDashboard({
    status,
    sort,
    q,
  });

  return (
    <ProjectDashboardClient
      counts={counts}
      projects={projects}
      currentStatus={status}
      currentSort={sort}
      searchQuery={q}
    />
  );
}

