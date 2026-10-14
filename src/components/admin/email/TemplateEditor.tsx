"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  discardDraftAction,
  previewTemplateAction,
  publishTemplateAction,
  saveDraftAction,
  setTemplateStatusAction,
  type SaveResult,
} from "@/lib/actions/email-templates";
import { EMAIL_CATEGORIES, sampleDataFor, variablesForTemplate } from "@/lib/email/definitions";
import { analyseContent } from "@/lib/email/analysis";
import { htmlToText } from "@/lib/email/text";
import type { ConcurrencyTokens, PreviewResult } from "@/lib/email/template-service";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { RichTextEditor, type RichTextHandle } from "@/components/admin/email/RichTextEditor";
import { VariablePanel } from "@/components/admin/email/VariablePanel";
import { SampleDataEditor } from "@/components/admin/email/SampleDataEditor";
import { PreviewPane, type Device } from "@/components/admin/email/PreviewPane";
import { TestEmailDialog } from "@/components/admin/email/TestEmailDialog";
import { toEditorFields, type EditorFields } from "@/components/admin/email/editor-fields";

export interface EditorProps {
  template: {
    id: number;
    key: string;
    event: string;
    isSystem: boolean;
    critical: boolean;
    status: "ACTIVE" | "INACTIVE";
    version: number;
    updatedByName: string | null;
    updatedAt: string;
  };
  initialFields: EditorFields;
  hasDraft: boolean;
  draftInfo: { by: string | null; at: string } | null;
  tokens: ConcurrencyTokens;
  perms: { edit: boolean; publish: boolean; test: boolean; source: boolean; manage: boolean };
  senderDomain: string;
}

type FocusTarget = "subject" | "visual" | "html" | "text";
const TARGET_LABEL: Record<FocusTarget, string> = { subject: "the subject", visual: "the email content", html: "the HTML source", text: "the plain-text content" };
type Notice = { kind: "success" | "error" | "conflict"; message: string } | null;

const input = "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50 disabled:text-neutral-500";
const tabBtn = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-xs font-medium ${active ? "bg-gray-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`;

function Field({ label, htmlFor, errors, hint, children }: { label: string; htmlFor: string; errors?: string[]; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-neutral-700">{label}</label>
      {children}
      {hint && !errors?.length && <p className="text-[11px] text-neutral-500">{hint}</p>}
      {errors?.map((e) => <p key={e} role="alert" className="text-[11px] text-red-600">{e}</p>)}
    </div>
  );
}

export function TemplateEditor({ template, initialFields, hasDraft: initialHasDraft, draftInfo, tokens: initialTokens, perms, senderDomain }: EditorProps) {
  const [fields, setFields] = useState<EditorFields>(initialFields);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialFields));
  const [tokens, setTokens] = useState(initialTokens);
  const [hasDraft, setHasDraft] = useState(initialHasDraft);
  const [version, setVersion] = useState(template.version);
  const [sample, setSample] = useState<Record<string, string>>(() => sampleDataFor(variablesForTemplate(template.key)));
  const [side, setSide] = useState<"details" | "variables" | "sample">("details");
  const [content, setContent] = useState<"visual" | "html" | "text">("visual");
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "publish" | "discard" | null>(null);
  const [summary, setSummary] = useState("");
  const [, startTransition] = useTransition();

  const rte = useRef<RichTextHandle>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const focusTarget = useRef<FocusTarget>("visual");
  const [target, setTargetState] = useState<FocusTarget>("visual");
  const setTarget = (t: FocusTarget) => { focusTarget.current = t; setTargetState(t); };
  const publishDialog = useRef<HTMLDialogElement>(null);
  const fieldsRef = useRef(fields);
  const sampleRef = useRef(sample);
  fieldsRef.current = fields;
  sampleRef.current = sample;

  const disabled = !perms.edit || busy !== null;
  const dirty = JSON.stringify(fields) !== baseline;
  const set = <K extends keyof EditorFields>(k: K, v: string) => setFields((f) => ({ ...f, [k]: v }));

  // ---- live placeholder analysis (the same checks the server runs on save)
  const analysis = useMemo(
    () => analyseContent({ key: template.key, subject: fields.subject, htmlBody: fields.htmlBody, textBody: fields.textBody }),
    [template.key, fields.subject, fields.htmlBody, fields.textBody]
  );
  const used = useMemo(() => new Set(analysis.used), [analysis.used]);
  const errors = analysis.issues.filter((i) => i.severity === "error");
  const analysisWarnings = analysis.issues.filter((i) => i.severity === "warning");

  // ---- warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ---- debounced live preview, rendered server-side with the production engine
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      const res = await previewTemplateAction(template.id, fields as unknown as Record<string, unknown>, sample);
      if (id !== seq.current) return;
      setPreviewLoading(false);
      if (res.ok) {
        setPreview(res.preview);
        setPreviewError(null);
      } else {
        setPreviewError(res.message);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [fields, sample, template.id]);

  // ---- insert a variable at the cursor of whichever field was last focused
  const spliceInto = (el: HTMLInputElement | HTMLTextAreaElement | null, key: "subject" | "htmlBody" | "textBody", token: string) => {
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    set(key, next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const insertToken = useCallback((token: string) => {
    if (disabled) return;
    switch (focusTarget.current) {
      case "subject": spliceInto(subjectRef.current, "subject", token); break;
      case "html": spliceInto(htmlRef.current, "htmlBody", token); break;
      case "text": spliceInto(textRef.current, "textBody", token); break;
      default: rte.current?.insertText(token);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const applyResult = (res: SaveResult) => {
    const next = toEditorFields(res.fields);
    setFields(next);
    setBaseline(JSON.stringify(next));
    setTokens(res.tokens);
    setVersion(res.version);
    setWarnings(res.warnings);
    setFieldErrors({});
  };

  const handleFailure = (res: { message: string; fieldErrors?: Record<string, string[]>; conflict?: boolean }) => {
    setFieldErrors(res.fieldErrors ?? {});
    setNotice({ kind: res.conflict ? "conflict" : "error", message: res.message });
  };

  const save = async () => {
    setBusy("save"); setNotice(null);
    const res = await saveDraftAction(template.id, { fields: fields as unknown as Record<string, unknown>, tokens });
    setBusy(null);
    if (res.ok) {
      applyResult(res);
      setHasDraft(true);
      setNotice({ kind: "success", message: res.message ?? "Draft saved." });
    } else handleFailure(res);
  };

  const publish = async () => {
    setBusy("publish"); setNotice(null);
    const res = await publishTemplateAction(template.id, { fields: fields as unknown as Record<string, unknown>, tokens }, summary);
    setBusy(null);
    publishDialog.current?.close();
    if (res.ok) {
      applyResult(res);
      setHasDraft(false);
      setSummary("");
      setNotice({ kind: "success", message: res.message ?? "Published." });
    } else handleFailure(res);
  };

  const discard = async () => {
    if (!window.confirm("Discard your unpublished draft? Production is not affected. This reloads the published version.")) return;
    setBusy("discard");
    const res = await discardDraftAction(template.id);
    if (res.ok) window.location.reload();
    else { setBusy(null); handleFailure(res); }
  };

  const confirmLeave = (e: React.MouseEvent) => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
  };

  const err = (k: string) => fieldErrors[k];
  const base = `/admin/dashboard/email-templates/${template.id}`;
  const canPublish = perms.publish && errors.length === 0 && busy === null;

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------------ header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/dashboard/email-templates" onClick={confirmLeave} className="text-sm text-neutral-500 hover:text-neutral-900">← Back to templates</Link>
          <h1 className="mt-1 truncate text-2xl font-semibold">{fields.name || "Untitled template"}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">{template.key}</code>
            <span>Published v{version} by {template.updatedByName ?? "system"}</span>
            <span className={template.status === "ACTIVE" ? "text-emerald-700" : "text-neutral-500"}>{template.status === "ACTIVE" ? "● Active" : "○ Inactive"}</span>
            {hasDraft ? <span className="font-medium text-amber-700">Unpublished draft{draftInfo?.by ? ` by ${draftInfo.by}` : ""}</span> : <span>No draft</span>}
            {dirty && <span className="font-medium text-red-600">Unsaved changes</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/history`} onClick={confirmLeave} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">History</Link>
          {perms.test && (
            <TestEmailDialog templateId={template.id} label="Send test email" getFields={() => fieldsRef.current as unknown as Record<string, unknown>} getData={() => sampleRef.current} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" />
          )}
          {perms.edit && hasDraft && !dirty && (
            <button type="button" onClick={discard} disabled={busy !== null} className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">Discard draft</button>
          )}
          {perms.edit && (
            <button type="button" onClick={save} disabled={busy !== null || (!dirty && hasDraft)} className="rounded-md border border-gray-900 px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100 disabled:opacity-50">
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
          )}
          {perms.publish && (
            <button type="button" onClick={() => publishDialog.current?.showModal()} disabled={busy !== null || (!dirty && !hasDraft)} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {busy === "publish" ? "Publishing…" : "Publish…"}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div role={notice.kind === "success" ? "status" : "alert"} className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3 text-sm ${notice.kind === "success" ? "bg-emerald-50 text-emerald-800" : notice.kind === "conflict" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}>
          <span>{notice.message}</span>
          {notice.kind === "conflict" && <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white">Reload latest</button>}
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="rounded-md bg-amber-50 px-4 py-3 text-xs text-amber-900" aria-label="Sanitization notes">
          {warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
      {!perms.edit && <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-600">You have view-only access to this template.</p>}

      {/* ------------------------------------------------------------ 3-panel layout */}
      <div className="grid gap-6 xl:grid-cols-[minmax(270px,310px)_minmax(0,1fr)_minmax(340px,430px)]">
        {/* left: details / variables / sample data */}
        <aside className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto" aria-label="Template settings">
          <div role="tablist" aria-label="Settings sections" className="flex gap-1">
            {(["details", "variables", "sample"] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={side === t} onClick={() => setSide(t)} className={tabBtn(side === t)}>
                {t === "details" ? "Details" : t === "variables" ? "Variables" : "Sample data"}
              </button>
            ))}
          </div>

          <div hidden={side !== "details"} className="flex flex-col gap-3">
              <Field label="Template name" htmlFor="f-name" errors={err("name")}>
                <input id="f-name" className={input} disabled={disabled} value={fields.name} onChange={(e) => set("name", e.target.value)} maxLength={120} />
              </Field>
              <Field label="Unique key" htmlFor="f-key" hint={template.isSystem ? "Built-in template: the key is locked so production emails keep working." : "The key can't be changed after creation."}>
                <input id="f-key" className={`${input} font-mono`} value={template.key} disabled readOnly />
              </Field>
              <Field label="Description" htmlFor="f-desc" errors={err("description")}>
                <textarea id="f-desc" rows={2} className={input} disabled={disabled} value={fields.description} onChange={(e) => set("description", e.target.value)} maxLength={500} />
              </Field>
              <Field label="Category" htmlFor="f-cat" errors={err("category")}>
                <select id="f-cat" className={input} disabled={disabled} value={fields.category} onChange={(e) => set("category", e.target.value)}>
                  {EMAIL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Trigger / event" htmlFor="f-event" hint={template.isSystem ? "Locked: this is where the app sends this email from." : "Informational for custom templates."}>
                <input id="f-event" className={`${input} font-mono`} value={template.event} disabled readOnly />
              </Field>
              <Field label="Subject" htmlFor="f-subject" errors={err("subject")} hint="Variables allowed, e.g. {{listingTitle}}.">
                <input id="f-subject" ref={subjectRef} className={input} disabled={disabled} value={fields.subject} onFocus={() => setTarget("subject")} onChange={(e) => set("subject", e.target.value)} maxLength={200} />
              </Field>
              <fieldset className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
                <legend className="px-1 text-xs font-semibold text-neutral-600">Sender &amp; recipients</legend>
                <Field label="Sender name" htmlFor="f-fromname" errors={err("fromName")} hint="Leave empty to use the platform default.">
                  <input id="f-fromname" className={input} disabled={disabled} value={fields.fromName} onChange={(e) => set("fromName", e.target.value)} />
                </Field>
                <Field label="Sender email" htmlFor="f-fromemail" errors={err("fromEmail")} hint={`Must be on the verified domain @${senderDomain}. Empty = platform default.`}>
                  <input id="f-fromemail" type="email" className={input} disabled={disabled} value={fields.fromEmail} onChange={(e) => set("fromEmail", e.target.value)} />
                </Field>
                <Field label="Reply-to" htmlFor="f-replyto" errors={err("replyTo")}>
                  <input id="f-replyto" type="email" className={input} disabled={disabled} value={fields.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
                </Field>
                <Field label="CC" htmlFor="f-cc" errors={err("cc")} hint="Up to 5, comma-separated.">
                  <input id="f-cc" className={input} disabled={disabled} value={fields.cc} onChange={(e) => set("cc", e.target.value)} />
                </Field>
                <Field label="BCC" htmlFor="f-bcc" errors={err("bcc")} hint="Up to 5, comma-separated.">
                  <input id="f-bcc" className={input} disabled={disabled} value={fields.bcc} onChange={(e) => set("bcc", e.target.value)} />
                </Field>
              </fieldset>
              {perms.manage && (
                <div className="rounded-md border border-neutral-200 p-3 text-xs">
                  <p className="mb-2 font-semibold text-neutral-600">Status: {template.status === "ACTIVE" ? "Active" : "Inactive"}</p>
                  {template.critical ? (
                    <p className="text-neutral-500">Critical email: it can&apos;t be deactivated.</p>
                  ) : (
                    <ActionForm
                      action={setTemplateStatusAction.bind(null, template.id, template.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
                      confirmMessage={template.status === "ACTIVE" ? "Deactivate this template? The system will stop sending this email." : "Activate this template?"}
                    >
                      <SubmitButton variant={template.status === "ACTIVE" ? "danger" : "default"}>{template.status === "ACTIVE" ? "Deactivate" : "Activate"}</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              )}
            </div>
          <div hidden={side !== "variables"}>
            <VariablePanel templateKey={template.key} used={used} onInsert={insertToken} disabled={disabled} target={TARGET_LABEL[target]} />
          </div>
          <div hidden={side !== "sample"}>
            <SampleDataEditor templateKey={template.key} data={sample} onChange={setSample} only={used} />
          </div>
        </aside>

        {/* centre: content editor */}
        <section className="flex min-w-0 flex-col gap-3" aria-label="Email content">
          <div role="tablist" aria-label="Editor mode" className="flex flex-wrap items-center gap-1">
            <button type="button" role="tab" aria-selected={content === "visual"} onClick={() => setContent("visual")} className={tabBtn(content === "visual")}>Visual</button>
            <button type="button" role="tab" aria-selected={content === "html"} onClick={() => setContent("html")} className={tabBtn(content === "html")}>HTML source{!perms.source ? " (read-only)" : ""}</button>
            <button type="button" role="tab" aria-selected={content === "text"} onClick={() => setContent("text")} className={tabBtn(content === "text")}>Plain text</button>
          </div>
          {err("htmlBody") && err("htmlBody")!.map((m) => <p key={m} role="alert" className="text-xs text-red-600">{m}</p>)}
          {err("content") && (
            <ul role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{err("content")!.map((m) => <li key={m}>✕ {m}</li>)}</ul>
          )}

          {content === "visual" && (
            <RichTextEditor ref={rte} value={fields.htmlBody} onChange={(h) => set("htmlBody", h)} onFocusEditor={() => setTarget("visual")} disabled={disabled} />
          )}
          {content === "html" && (
            <textarea
              ref={htmlRef}
              aria-label="HTML source"
              spellCheck={false}
              readOnly={!perms.source || disabled}
              value={fields.htmlBody}
              onFocus={() => setTarget("html")}
              onChange={(e) => set("htmlBody", e.target.value)}
              className="min-h-[420px] w-full rounded-lg border border-neutral-300 bg-neutral-50 p-3 font-mono text-xs leading-5"
            />
          )}
          {content === "text" && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-neutral-500">Optional. If empty, only the HTML version is sent (as today). Add one for clients that don&apos;t show HTML.</p>
                <button type="button" disabled={disabled} onClick={() => set("textBody", htmlToText(fields.htmlBody))} className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-50">
                  Generate from HTML
                </button>
              </div>
              <textarea
                ref={textRef}
                aria-label="Plain-text content"
                disabled={disabled}
                value={fields.textBody}
                onFocus={() => setTarget("text")}
                onChange={(e) => set("textBody", e.target.value)}
                className="min-h-[360px] w-full rounded-lg border border-neutral-300 p-3 font-mono text-xs leading-5"
              />
            </div>
          )}

          <div aria-live="polite" className="rounded-lg border border-neutral-200 bg-white p-3 text-xs">
            <p className="mb-1 font-semibold text-neutral-700">Validation</p>
            {errors.length === 0 && analysisWarnings.length === 0 ? (
              <p className="text-emerald-700">✓ All placeholders are valid.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {errors.map((i, n) => <li key={`e${n}`} className="text-red-700">✕ {i.message}</li>)}
                {analysisWarnings.map((i, n) => <li key={`w${n}`} className="text-amber-800">⚠ {i.message}</li>)}
              </ul>
            )}
          </div>
        </section>

        {/* right: preview */}
        <aside className="flex flex-col gap-2 xl:sticky xl:top-4 xl:self-start" aria-label="Live preview">
          <h2 className="text-sm font-semibold">Live preview</h2>
          <PreviewPane preview={preview} loading={previewLoading} error={previewError} device={device} onDevice={setDevice} />
        </aside>
      </div>

      {/* ------------------------------------------------------------ publish confirmation */}
      <dialog ref={publishDialog} aria-labelledby="publish-title" className="m-auto w-full max-w-lg rounded-xl border border-neutral-200 p-0 shadow-xl backdrop:bg-black/40">
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id="publish-title" className="text-lg font-semibold">Publish version {version + 1}?</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {template.status === "ACTIVE" ? "Production emails will use this version immediately." : "This template is inactive, so it won't be sent until it is activated."} You can restore any earlier version from History.
            </p>
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
              {errors.map((i, n) => <li key={n}>✕ {i.message}</li>)}
            </ul>
          )}
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            What changed? (optional)
            <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} placeholder="e.g. Updated the greeting and added a support link" className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <p className="text-xs text-neutral-500">Tip: send yourself a test email first.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => publishDialog.current?.close()} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button type="button" onClick={() => startTransition(() => { void publish(); })} disabled={!canPublish} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {busy === "publish" ? "Publishing…" : "Publish now"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
