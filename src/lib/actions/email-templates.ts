"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EmailTemplateStatus } from "@prisma/client";
import { requireUser } from "@/lib/session";
import type { Actor } from "@/lib/permissions";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleError,
  ValidationFailure,
} from "@/lib/email/errors";
import * as service from "@/lib/email/template-service";
import type { PreviewResult, ConcurrencyTokens } from "@/lib/email/template-service";
import type { RenderIssue, TemplateData } from "@/lib/email/render";

// Server actions for the email template admin. Each one re-authenticates and re-authorizes
// (the service checks the permission), because hiding a button is not a security boundary.
// Next.js additionally rejects cross-origin action requests (Origin/Host check).

export type ActionResult<T = object> =
  | ({ ok: true; message?: string } & T)
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
      /** The template changed under the editor; the UI should offer a reload. */
      conflict?: boolean;
    };

export type FormState =
  | { ok?: boolean; message?: string; fieldErrors?: Record<string, string[]>; values?: Record<string, string> }
  | undefined;

const LIST_PATH = "/admin/dashboard/email-templates";

async function actor(): Promise<Actor> {
  const user = await requireUser();
  return { id: user.id, role: user.role, email: user.email };
}

function toFailure(error: unknown): Extract<ActionResult, { ok: false }> {
  if (error instanceof ValidationFailure) {
    return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
  }
  if (error instanceof ConflictError) return { ok: false, message: error.message, conflict: true };
  if (error instanceof ForbiddenError || error instanceof NotFoundError || error instanceof RuleError) {
    return { ok: false, message: error.message };
  }
  console.error("Email template action failed:", error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

async function run<T extends object>(fn: (a: Actor) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn(await actor());
  } catch (error) {
    // redirect() and notFound() signal through thrown errors and must not be swallowed.
    if (error instanceof Error && (error as { digest?: string }).digest?.startsWith("NEXT_")) throw error;
    return toFailure(error);
  }
}

export interface EditorPayload {
  fields: Record<string, unknown>;
  tokens: ConcurrencyTokens;
}

const iso = (d: Date) => d.toISOString();

// -------------------------------------------------------------------- list actions

export async function createTemplateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  let createdId: number | null = null;
  const result = await run(async (a) => {
    const created = await service.createTemplate(a, Object.fromEntries(formData));
    createdId = created.id;
    return { ok: true as const };
  });
  if (!result.ok) {
    // Echo the input back: React resets uncontrolled forms after an action, which would
    // otherwise wipe what the admin typed whenever validation fails.
    const values = Object.fromEntries(
      [...formData.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v as string])
    );
    return { ok: false, message: result.message, fieldErrors: result.fieldErrors, values };
  }
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${createdId}/edit`);
}

export async function duplicateTemplateAction(
  id: number,
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  let copyId: number | null = null;
  const result = await run(async (a) => {
    copyId = (await service.duplicateTemplate(a, id)).id;
    return { ok: true as const };
  });
  if (!result.ok) return { ok: false, message: result.message };
  revalidatePath(LIST_PATH);
  redirect(`${LIST_PATH}/${copyId}/edit`);
}

export async function setTemplateStatusAction(
  id: number,
  status: EmailTemplateStatus,
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  const result = await run(async (a) => {
    const t = await service.setTemplateStatus(a, id, status);
    return { ok: true as const, message: `${t.name} is now ${status === "ACTIVE" ? "active" : "inactive"}.` };
  });
  if (result.ok) revalidatePath(LIST_PATH);
  return { ok: result.ok, message: result.message };
}

export async function deleteTemplateAction(
  id: number,
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  const result = await run(async (a) => {
    await service.deleteTemplate(a, id);
    return { ok: true as const, message: "Template deleted." };
  });
  if (result.ok) revalidatePath(LIST_PATH);
  return { ok: result.ok, message: result.message };
}

// ---------------------------------------------------------------- editor actions

export interface SaveResult {
  tokens: ConcurrencyTokens;
  fields: Record<string, unknown>;
  warnings: string[];
  issues: RenderIssue[];
  savedAt: string;
  version: number;
}

export async function saveDraftAction(id: number, payload: EditorPayload): Promise<ActionResult<SaveResult>> {
  return run(async (a) => {
    const res = await service.saveDraft(a, id, payload.fields, payload.tokens);
    revalidatePath(LIST_PATH);
    return {
      ok: true as const,
      message: "Draft saved. Production emails still use the published version.",
      tokens: res.tokens,
      fields: res.fields,
      warnings: res.warnings,
      issues: res.issues,
      savedAt: iso(res.draft.updatedAt),
      version: res.tokens.expectedVersion,
    };
  });
}

export async function publishTemplateAction(
  id: number,
  payload: EditorPayload,
  changeSummary: string
): Promise<ActionResult<SaveResult>> {
  return run(async (a) => {
    const res = await service.publishTemplate(a, id, payload.fields, payload.tokens, changeSummary);
    revalidatePath(LIST_PATH);
    return {
      ok: true as const,
      message: `Published as version ${res.template.version}. New emails now use it.`,
      tokens: { expectedVersion: res.template.version, expectedDraftStamp: null },
      fields: res.fields,
      warnings: res.warnings,
      issues: res.issues,
      savedAt: iso(res.template.updatedAt),
      version: res.template.version,
    };
  });
}

export async function discardDraftAction(id: number): Promise<ActionResult<{ tokens: ConcurrencyTokens }>> {
  return run(async (a) => {
    await service.discardDraft(a, id);
    const state = await service.getEditorState(a, id);
    revalidatePath(LIST_PATH);
    return { ok: true as const, message: "Draft discarded.", tokens: state.tokens };
  });
}

export async function previewTemplateAction(
  id: number,
  fields: Record<string, unknown>,
  data: TemplateData
): Promise<ActionResult<{ preview: PreviewResult }>> {
  return run(async (a) => ({ ok: true as const, preview: await service.previewTemplate(a, id, fields, data) }));
}

export async function sendTestEmailAction(
  id: number,
  input: {
    recipient: string;
    fields?: Record<string, unknown>;
    data?: TemplateData;
    confirmAccountRecipient?: boolean;
  }
): Promise<ActionResult<{ status: "SENT" | "FAILED"; subject: string }>> {
  return run<{ status: "SENT" | "FAILED"; subject: string }>(async (a) => {
    const res = await service.sendTestEmail(a, id, input);
    if (res.status === "FAILED") {
      return { ok: false, message: `The test email could not be sent: ${res.error}` };
    }
    return { ok: true, message: `Test email sent to ${input.recipient}.`, status: res.status, subject: res.subject };
  });
}

export async function restoreVersionAction(
  id: number,
  version: number,
  expectedVersion: number,
  changeSummary: string
): Promise<ActionResult<{ newVersion: number }>> {
  return run(async (a) => {
    const row = await service.restoreVersion(a, id, version, expectedVersion, changeSummary);
    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${id}/history`);
    return { ok: true as const, message: `Restored version ${version} as version ${row.version}.`, newVersion: row.version };
  });
}
