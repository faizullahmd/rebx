import Link from "next/link";
import { requireRole } from "@/lib/session";
import { BUILT_IN_BY_KEY } from "@/lib/email/definitions";
import { ensureBuiltInTemplates, listTemplates } from "@/lib/email/template-service";
import { ForbiddenError } from "@/lib/email/errors";
import { TemplateRowActions } from "@/components/admin/email/TemplateRowActions";
import { Badge, Empty, PageHeader, Pagination, TableShell, Td, Th, formatDate, parsePage } from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

type Search = { q?: string; category?: string; status?: string; event?: string; sort?: string; dir?: string; page?: string };

export default async function EmailTemplatesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireRole("ADMIN");
  const actor = { id: user.id, role: user.role, email: user.email };
  const sp = await searchParams;

  // Idempotent: makes sure the built-in transactional emails exist as editable templates.
  await ensureBuiltInTemplates(actor);

  const sort = sp.sort === "name" || sp.sort === "category" ? sp.sort : "updatedAt";
  const dir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : undefined;
  let data;
  try {
    data = await listTemplates(actor, {
      q: sp.q?.trim() || undefined,
      category: sp.category || undefined,
      status: sp.status || undefined,
      event: sp.event || undefined,
      sort,
      dir,
      page: parsePage(sp.page),
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return <Empty>You don&apos;t have access to email templates.</Empty>;
    throw error;
  }

  const select = "rounded-md border border-gray-300 px-3 py-2 text-sm";
  const params = { q: sp.q, category: sp.category, status: sp.status, event: sp.event, sort: sp.sort, dir: sp.dir };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email templates"
        description={`${data.total} template(s). Edit the emails the platform sends without a code change. Changes only affect production after you publish.`}
        actions={
          <Link href="/admin/dashboard/email-templates/new" className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700">
            New template
          </Link>
        }
      />

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search name, key or subject" aria-label="Search templates" className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className={select}>
          <option value="">All categories</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className={select}>
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <select name="event" defaultValue={sp.event ?? ""} aria-label="Trigger event" className={select}>
          <option value="">All triggers</option>
          {data.events.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort by" className={select}>
          <option value="updatedAt">Sort: last updated</option>
          <option value="name">Sort: name</option>
          <option value="category">Sort: category</option>
        </select>
        <select name="dir" defaultValue={dir ?? ""} aria-label="Sort direction" className={select}>
          <option value="">Default order</option>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700">Apply</button>
        {(sp.q || sp.category || sp.status || sp.event) && (
          <Link href="/admin/dashboard/email-templates" className="text-sm text-neutral-500 underline">Clear</Link>
        )}
      </form>

      {data.items.length === 0 ? (
        <Empty>No templates match your filters.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Template</Th><Th>Category / trigger</Th><Th>Subject</Th><Th>Status</Th><Th>Updated</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link href={`/admin/dashboard/email-templates/${t.id}/edit`} className="font-medium hover:underline">{t.name}</Link>
                  <p className="font-mono text-xs text-neutral-500">{t.key}</p>
                  <p className="text-xs text-neutral-400">v{t.version}{t.isSystem ? " · built-in" : " · custom"}</p>
                </Td>
                <Td className="text-xs text-neutral-600">
                  <p className="font-medium text-neutral-800">{t.category}</p>
                  <p className="font-mono">{t.event}</p>
                </Td>
                <Td className="max-w-[16rem] text-neutral-700"><span className="line-clamp-2">{t.subject}</span></Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone={t.status === "ACTIVE" ? "green" : "gray"}>{t.status === "ACTIVE" ? "active" : "inactive"}</Badge>
                    {t.draft && <Badge tone="amber">unpublished draft</Badge>}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-xs text-neutral-600">
                  <p>{formatDate(t.updatedAt)}</p>
                  <p className="text-neutral-400">{t.updatedBy?.name ?? "system"}</p>
                </Td>
                <Td>
                  <TemplateRowActions id={t.id} name={t.name} status={t.status} isSystem={t.isSystem} critical={Boolean(BUILT_IN_BY_KEY[t.key]?.critical)} hasDraft={Boolean(t.draft)} />
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/email-templates" page={data.page} pageCount={data.pageCount} params={params} />
    </div>
  );
}
