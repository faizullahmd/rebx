export default function PortfolioLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-10 animate-pulse">
      {/* Header skeleton */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
          <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-full bg-neutral-200 flex-none" />
          <div className="flex-1 space-y-3">
            <div className="h-8 w-48 rounded bg-neutral-200" />
            <div className="h-4 w-32 rounded bg-neutral-200" />
            <div className="h-16 w-full max-w-xl rounded bg-neutral-100" />
            <div className="flex gap-4 pt-3">
              <div className="h-4 w-28 rounded bg-neutral-200" />
              <div className="h-4 w-28 rounded bg-neutral-200" />
            </div>
          </div>
          <div className="flex gap-2 sm:flex-col sm:w-36">
            <div className="h-10 w-full rounded-lg bg-neutral-200" />
            <div className="h-10 w-full rounded-lg bg-neutral-200" />
          </div>
        </div>
      </div>

      {/* Filter skeleton */}
      <div className="flex items-center justify-between border-b border-neutral-200 pb-5">
        <div className="h-6 w-36 rounded bg-neutral-200" />
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-lg bg-neutral-200" />
          <div className="h-9 w-28 rounded-lg bg-neutral-200" />
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
            <div className="aspect-[4/3] bg-neutral-200" />
            <div className="p-5 space-y-3">
              <div className="h-4 w-24 bg-neutral-200 rounded" />
              <div className="h-5 w-3/4 bg-neutral-200 rounded" />
              <div className="h-6 w-20 bg-neutral-200 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
