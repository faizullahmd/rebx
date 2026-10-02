import Link from "next/link";
import { parseVideoUrl } from "@/lib/video";

interface PropertyVideoPlayerProps {
  videoUrl: string;
  title?: string;
}

export function PropertyVideoPlayer({ videoUrl, title }: PropertyVideoPlayerProps) {
  const parsed = parseVideoUrl(videoUrl);
  if (!parsed) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200/90 bg-white p-4 sm:p-6 shadow-2xs">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg sm:text-xl font-bold text-neutral-900">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <svg className="h-3.5 w-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            Property Video
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Immersive walkthrough presentation and tour
          </p>
        </div>

        <Link
          href="/videos"
          className="inline-flex items-center gap-1 text-xs sm:text-sm font-semibold text-neutral-700 hover:text-neutral-950 hover:underline"
        >
          <span>More property videos</span>
          <span>→</span>
        </Link>
      </div>

      {/* Responsive 16:9 Lazy-Loaded nocookie Embed Player */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-inner">
        <iframe
          src={parsed.embedUrl}
          title={title ? `${title} — Property Video` : "Property Video"}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>
    </section>
  );
}
