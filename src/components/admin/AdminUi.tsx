import Link from "next/link";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-neutral-200 bg-white p-5 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  href?: string;
  hint?: string;
}) {
  const body = (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue" | "purple";
}) {
  const tones = {
    gray: "bg-neutral-100 text-neutral-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
    purple: "bg-purple-50 text-purple-700",
  }[tone];
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}>
      {children}
    </span>
  );
}

export function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`border-b border-neutral-100 px-4 py-3 align-top ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
      {children}
    </div>
  );
}

export function SearchBar({
  placeholder,
  q,
  extra,
}: {
  placeholder: string;
  q?: string;
  extra?: React.ReactNode;
}) {
  return (
    <form className="flex flex-wrap items-center gap-2" method="get">
      <input
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {extra}
      <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700">
        Search
      </button>
    </form>
  );
}

export function Pagination({
  basePath,
  page,
  pageCount,
  params,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  params: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  return (
    <div className="flex items-center justify-between text-sm text-neutral-600">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
            ← Previous
          </Link>
        )}
        {page < pageCount && (
          <Link href={href(page + 1)} className="rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}

export const PAGE_SIZE = 25;

export function parsePage(raw: string | undefined) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export function formatDate(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(d);
}
