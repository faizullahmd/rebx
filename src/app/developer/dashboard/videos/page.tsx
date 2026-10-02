import { requireRole } from "@/lib/session";
import { getUserGalleryVideos } from "@/lib/actions/videos";
import { GalleryVideosManager } from "@/components/dashboard/GalleryVideosManager";

export const metadata = {
  title: "My Videos | Developer Dashboard | REBX",
};

export default async function DeveloperVideosPage() {
  const user = await requireRole("DEVELOPER");
  const rawVideos = await getUserGalleryVideos(user.id);

  const videos = rawVideos.map((v) => ({
    ...v,
    createdAt: v.createdAt.toISOString(),
  }));

  return <GalleryVideosManager initialVideos={videos} roleTitle="Developer" />;
}
