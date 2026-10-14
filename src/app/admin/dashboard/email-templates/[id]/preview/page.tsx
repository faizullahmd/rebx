import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { NotFoundError } from "@/lib/email/errors";
import { getEditorState } from "@/lib/email/template-service";
import { PageHeader } from "@/components/admin/AdminUi";
import { PreviewPageClient } from "@/components/admin/email/PreviewPageClient";

export const dynamic = "force-dynamic";

export default async function PreviewEmailTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();
  const { version } = await searchParams;

  const user = await requireRole("ADMIN");
  const actor = { id: user.id, role: user.role, email: user.email };
  let state;
  try {
    state = await getEditorState(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { template, draft } = state;

  // ?version=draft previews the unpublished draft; the default is what production sends.
  const showDraft = version === "draft" && draft;
  const source = showDraft ? draft : template;
  const fields = {
    name: source.name, description: source.description, category: source.category, subject: source.subject,
    htmlBody: source.htmlBody, textBody: source.textBody, fromName: source.fromName, fromEmail: source.fromEmail,
    replyTo: source.replyTo, cc: source.cc, bcc: source.bcc,
  };
  const base = `/admin/dashboard/email-templates/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/dashboard/email-templates" className="text-sm text-neutral-500 hover:text-neutral-900">← Back to templates</Link>
        <div className="flex gap-2 text-sm">
          {draft && (
            <Link href={showDraft ? base + "/preview" : base + "/preview?version=draft"} className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50">
              {showDraft ? "Show published version" : "Show unpublished draft"}
            </Link>
          )}
          <Link href={`${base}/edit`} className="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-700">Edit</Link>
        </div>
      </div>
      <PageHeader
        title={`Preview: ${template.name}`}
        description={showDraft ? "Showing the unpublished draft. Production is not using this yet." : `Showing published version ${template.version}, which is what production sends.`}
      />
      <PreviewPageClient templateId={id} templateKey={template.key} fields={fields} canTest={hasPermission(actor, "email.test")} />
    </div>
  );
}
