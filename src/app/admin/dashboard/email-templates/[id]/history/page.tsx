import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { diffLines, hasChanges } from "@/lib/email/diff";
import { NotFoundError } from "@/lib/email/errors";
import { getEditorState, listTemplateAudit, listTestLogs, listVersions } from "@/lib/email/template-service";
import { Badge, Card, Empty, PageHeader, TableShell, Td, Th } from "@/components/admin/AdminUi";
import { RestoreButton } from "@/components/admin/email/RestoreButton";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d);

const COMPARED = [
  ["subject", "Subject"], ["htmlBody", "HTML content"], ["textBody", "Plain text"], ["name", "Name"],
  ["category", "Category"], ["fromName", "Sender name"], ["fromEmail", "Sender email"],
  ["replyTo", "Reply-to"], ["cc", "CC"], ["bcc", "BCC"],
] as const;

export default async function EmailTemplateHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const sp = await searchParams;

  const user = await requireRole("ADMIN");
  const actor = { id: user.id, role: user.role, email: user.email };

  let state;
  try {
    state = await getEditorState(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const [versions, tests, audit] = await Promise.all([
    listVersions(actor, id),
    listTestLogs(actor, id),
    listTemplateAudit(actor, id),
  ]);
  const { template } = state;
  const canRestore = hasPermission(actor, "email.restore");

  // Default comparison: the latest version against the one before it.
  const byNumber = new Map(versions.map((v) => [v.version, v]));
  const toV = byNumber.get(Number(sp.to)) ?? versions[0];
  const fromV = byNumber.get(Number(sp.from)) ?? versions[1] ?? versions[0];
  const diffs = COMPARED.map(([key, label]) => {
    const before = String(fromV?.[key] ?? "");
    const after = String(toV?.[key] ?? "");
    return { key, label, lines: before === after ? [] : diffLines(before, after) };
  }).filter((d) => hasChanges(d.lines));

  const base = `/admin/dashboard/email-templates/${id}`;
  const select = "rounded-md border border-gray-300 px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/dashboard/email-templates" className="text-sm text-neutral-500 hover:text-neutral-900">← Back to templates</Link>
        <Link href={`${base}/edit`} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">Edit</Link>
      </div>
      <PageHeader title={`History: ${template.name}`} description={`Currently published: version ${template.version}. Every publish, restore and creation is kept.`} />

      <section aria-label="Versions" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Versions</h2>
        <TableShell>
          <thead><tr><Th>Version</Th><Th>Change</Th><Th>By</Th><Th>When</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <Td>
                  <span className="font-medium">v{v.version}</span>{" "}
                  {v.version === template.version && <Badge tone="green">published</Badge>}
                </Td>
                <Td>
                  <Badge tone={v.action === "RESTORE" ? "purple" : v.action === "PUBLISH" ? "blue" : "gray"}>{v.action.toLowerCase()}</Badge>
                  <p className="mt-1 max-w-sm text-xs text-neutral-600">{v.changeSummary ?? "No summary."}</p>
                  {v.restoredFromVersion && <p className="text-[11px] text-neutral-400">from v{v.restoredFromVersion}</p>}
                </Td>
                <Td className="text-xs text-neutral-600">{v.createdBy?.name ?? "system"}</Td>
                <Td className="whitespace-nowrap text-xs text-neutral-600">{fmt(v.createdAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <Link href={`${base}/history?from=${Math.max(1, v.version - 1)}&to=${v.version}`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">Compare with previous</Link>
                    {canRestore && v.version !== template.version && <RestoreButton templateId={id} version={v.version} currentVersion={template.version} />}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      <section aria-label="Compare versions" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Compare versions</h2>
        <form method="get" className="flex flex-wrap items-center gap-2">
          <label className="text-sm">From <select name="from" defaultValue={fromV?.version} className={select}>{versions.map((v) => <option key={v.id} value={v.version}>v{v.version}</option>)}</select></label>
          <label className="text-sm">To <select name="to" defaultValue={toV?.version} className={select}>{versions.map((v) => <option key={v.id} value={v.version}>v{v.version}</option>)}</select></label>
          <button className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700">Compare</button>
        </form>
        {versions.length < 2 || !fromV || !toV ? (
          <Empty>There&apos;s only one version so far, so there&apos;s nothing to compare yet.</Empty>
        ) : fromV.version === toV.version ? (
          <Empty>Pick two different versions to compare.</Empty>
        ) : diffs.length === 0 ? (
          <Empty>v{fromV.version} and v{toV.version} have identical content.</Empty>
        ) : (
          diffs.map((d) => (
            <Card key={d.key} title={`${d.label}: v${fromV.version} → v${toV.version}`}>
              <pre className="max-h-96 overflow-auto rounded-md bg-neutral-50 p-3 text-xs leading-5">
                {d.lines.map((l, i) => (
                  <div key={i} className={l.type === "add" ? "bg-emerald-100 text-emerald-900" : l.type === "remove" ? "bg-red-100 text-red-900" : "text-neutral-500"}>
                    <span aria-hidden className="select-none pr-2">{l.type === "add" ? "+" : l.type === "remove" ? "−" : " "}</span>
                    <span className="sr-only">{l.type === "add" ? "Added: " : l.type === "remove" ? "Removed: " : ""}</span>
                    {l.text || " "}
                  </div>
                ))}
              </pre>
            </Card>
          ))
        )}
      </section>

      <section aria-label="Test emails" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recent test emails</h2>
        {tests.length === 0 ? <Empty>No test emails have been sent for this template.</Empty> : (
          <TableShell>
            <thead><tr><Th>When</Th><Th>Recipient</Th><Th>Version</Th><Th>Result</Th><Th>Sent by</Th></tr></thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <Td className="whitespace-nowrap text-xs">{fmt(t.createdAt)}</Td>
                  <Td className="text-xs">{t.recipient}</Td>
                  <Td className="text-xs">v{t.templateVersion}{t.usedDraft ? " (+ unpublished edits)" : ""}</Td>
                  <Td>{t.status === "SENT" ? <Badge tone="green">sent</Badge> : <Badge tone="red">failed</Badge>}{t.error && <p className="mt-1 max-w-xs text-xs text-red-700">{t.error}</p>}</Td>
                  <Td className="text-xs">{t.sentBy?.name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </section>

      <section aria-label="Audit trail" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Audit trail</h2>
        {audit.length === 0 ? <Empty>No activity recorded yet.</Empty> : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span>{a.summary}</span>
                <span className="text-xs text-neutral-500">{a.actor?.name ?? a.actorEmail ?? "system"} · {fmt(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
