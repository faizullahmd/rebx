import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { senderDomain } from "@/lib/email/sender";
import { BUILT_IN_BY_KEY } from "@/lib/email/definitions";
import { NotFoundError } from "@/lib/email/errors";
import { ensureBuiltInTemplates, getEditorState } from "@/lib/email/template-service";
import { TemplateEditor } from "@/components/admin/email/TemplateEditor";
import { toEditorFields } from "@/components/admin/email/editor-fields";

export const dynamic = "force-dynamic";

export default async function EditEmailTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();

  const user = await requireRole("ADMIN");
  const actor = { id: user.id, role: user.role, email: user.email };
  await ensureBuiltInTemplates(actor);

  let state;
  try {
    state = await getEditorState(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { template, draft, working, tokens } = state;

  return (
    <TemplateEditor
      key={`${template.id}-${template.version}-${draft?.updatedAt.getTime() ?? 0}`}
      template={{
        id: template.id,
        key: template.key,
        event: template.event,
        isSystem: template.isSystem,
        critical: Boolean(BUILT_IN_BY_KEY[template.key]?.critical),
        status: template.status,
        version: template.version,
        updatedByName: template.updatedBy?.name ?? null,
        updatedAt: template.updatedAt.toISOString(),
      }}
      initialFields={toEditorFields(working as unknown as Record<string, unknown>)}
      hasDraft={Boolean(draft)}
      draftInfo={draft ? { by: draft.updatedBy?.name ?? null, at: draft.updatedAt.toISOString() } : null}
      tokens={tokens}
      perms={{
        edit: hasPermission(actor, "email.edit"),
        publish: hasPermission(actor, "email.publish"),
        test: hasPermission(actor, "email.test"),
        source: hasPermission(actor, "email.source"),
        manage: hasPermission(actor, "email.manage"),
      }}
      senderDomain={senderDomain()}
    />
  );
}
