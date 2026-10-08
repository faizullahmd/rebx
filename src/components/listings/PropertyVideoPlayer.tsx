import { parseVideoUrl } from "@/lib/video";

interface PropertyVideoPlayerProps {
  videoUrl: string;
  title?: string;
}

export function PropertyVideoPlayer({ videoUrl, title }: PropertyVideoPlayerProps) {
  const parsed = parseVideoUrl(videoUrl);

  const isDirectVideo =
    !parsed &&
    (videoUrl.endsWith(".mp4") ||
      videoUrl.endsWith(".webm") ||
      videoUrl.endsWith(".mov") ||
      videoUrl.includes("/uploads/"));

  if (!parsed && !isDirectVideo) return null;

  return (
    <section className="mt-3 w-full max-w-full sm:max-w-md overflow-hidden rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3 sm:p-3.5 shadow-2xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-neutral-900">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <svg className="h-2.5 w-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          Property Video Tour
        </h3>
      </div>

      {title && (
        <p className="mb-2 text-xs text-neutral-600 truncate font-medium" title={title}>
          {title}
        </p>
      )}

      {/* Responsive 16:9 Video Player optimized for Mobile */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black shadow-inner">
        {parsed ? (
          <iframe
            src={parsed.embedUrl}
            title={title ? `${title} — Property Video` : "Property Video"}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <video
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
      </div>
    </section>
  );
}
