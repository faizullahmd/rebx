import { prisma } from "@/lib/prisma";
import { createDefaultTag, deleteTagAdmin } from "@/lib/actions/admin";
import { TAG_COLORS, TAG_COLOR_KEYS, type TagColorKey } from "@/lib/tags";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { Badge, Card, Empty, PageHeader, TableShell, Td, Th } from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    include: {
      creator: { select: { name: true } },
      _count: { select: { listings: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Tags" description="Default tags are available to every agent. Agents can also create their own." />

      <Card title="Create default tag">
        <ActionForm action={createDefaultTag}>
          <input name="name" maxLength={20} placeholder="Tag name" required className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <select name="color" defaultValue="blue" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {TAG_COLOR_KEYS.map((c) => <option key={c} value={c}>{TAG_COLORS[c].label}</option>)}
          </select>
          <SubmitButton variant="primary">Create tag</SubmitButton>
        </ActionForm>
      </Card>

      {tags.length === 0 ? (
        <Empty>No tags yet.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Tag</Th><Th>Type</Th><Th>Used on</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {tags.map((t) => {
              const meta = TAG_COLORS[t.color as TagColorKey];
              return (
                <tr key={t.id}>
                  <Td>
                    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta ? meta.softBadgeClass : "bg-neutral-50 text-neutral-700"}`}>
                      <span className={`h-2 w-2 rounded-full ${meta ? meta.swatchClass : "bg-neutral-400"}`} />
                      {t.name}
                    </span>
                  </Td>
                  <Td>{t.isDefault ? <Badge tone="blue">default</Badge> : <Badge>{t.creator ? `by ${t.creator.name}` : "custom"}</Badge>}</Td>
                  <Td className="text-neutral-600">{t._count.listings} listing(s)</Td>
                  <Td>
                    <ActionForm action={deleteTagAdmin.bind(null, t.id)} confirmMessage={`Delete tag “${t.name}”? ${t._count.listings} listing(s) will be untagged.`}>
                      <SubmitButton variant="danger">Delete</SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
    </div>
  );
}
