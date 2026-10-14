"use client";

import Link from "next/link";
import type { EmailTemplateStatus } from "@prisma/client";
import {
  deleteTemplateAction,
  duplicateTemplateAction,
  setTemplateStatusAction,
} from "@/lib/actions/email-templates";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { TestEmailDialog } from "@/components/admin/email/TestEmailDialog";

export function TemplateRowActions({
  id,
  name,
  status,
  isSystem,
  critical,
  hasDraft,
}: {
  id: number;
  name: string;
  status: EmailTemplateStatus;
  isSystem: boolean;
  critical: boolean;
  hasDraft: boolean;
}) {
  const next: EmailTemplateStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  const base = `/admin/dashboard/email-templates/${id}`;
  const linkClass = "rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50";

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Link href={`${base}/edit`} className={linkClass}>{hasDraft ? "Edit (draft)" : "Edit"}</Link>
        <Link href={`${base}/preview`} className={linkClass}>Preview</Link>
        <Link href={`${base}/history`} className={linkClass}>History</Link>
        <TestEmailDialog templateId={id} />
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        <ActionForm action={duplicateTemplateAction.bind(null, id)} confirmMessage={`Duplicate “${name}”? The copy starts inactive.`}>
          <SubmitButton>Duplicate</SubmitButton>
        </ActionForm>
        {critical && status === "ACTIVE" ? (
          <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-500" title="Account access depends on this email.">
            Critical, always on
          </span>
        ) : (
          <ActionForm
            action={setTemplateStatusAction.bind(null, id, next)}
            confirmMessage={
              next === "INACTIVE"
                ? `Deactivate “${name}”? The system will stop sending this email until it is activated again.`
                : `Activate “${name}”?`
            }
          >
            <SubmitButton variant={next === "INACTIVE" ? "danger" : "default"}>
              {next === "INACTIVE" ? "Deactivate" : "Activate"}
            </SubmitButton>
          </ActionForm>
        )}
        {!isSystem && (
          <ActionForm action={deleteTemplateAction.bind(null, id)} confirmMessage={`Delete “${name}” and its version history? This cannot be undone.`}>
            <SubmitButton variant="danger">Delete</SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
