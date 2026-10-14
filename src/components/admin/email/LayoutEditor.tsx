"use client";

import { useEffect, useRef, useState } from "react";
import { previewLayoutAction, saveLayoutAction } from "@/lib/actions/email-templates";
import { DEFAULT_LAYOUT, type LayoutSettings } from "@/lib/email/layout";

const input = "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-neutral-50 disabled:text-neutral-500";

function Field({ label, id, errors, hint, children }: { label: string; id: string; errors?: string[]; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-neutral-700">{label}</label>
      {children}
      {hint && !errors?.length && <p className="text-[11px] text-neutral-500">{hint}</p>}
      {errors?.map((e) => <p key={e} role="alert" className="text-[11px] text-red-600">{e}</p>)}
    </div>
  );
}

function ColorField({ id, label, value, onChange, disabled, errors }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean; errors?: string[] }) {
  return (
    <Field label={label} id={id} errors={errors}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} disabled={disabled} value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 shrink-0 rounded border border-gray-300" />
        <input id={id} className={`${input} font-mono`} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} />
      </div>
    </Field>
  );
}

export function LayoutEditor({
  initial,
  version: initialVersion,
  isDefault,
  updatedBy,
  updatedAt,
  canEdit,
}: {
  initial: LayoutSettings;
  version: number;
  isDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  canEdit: boolean;
}) {
  const [settings, setSettings] = useState<LayoutSettings>(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [version, setVersion] = useState(initialVersion);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "conflict"; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(520);

  const dirty = JSON.stringify(settings) !== baseline;
  const set = <K extends keyof LayoutSettings>(k: K, v: LayoutSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const disabled = !canEdit || saving;
  const e = (k: keyof LayoutSettings) => errors[k];

  useEffect(() => {
    if (!dirty) return;
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await previewLayoutAction(settings as unknown as Record<string, unknown>);
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) { setHtml(res.html); setErrors(res.fieldErrors); }
    }, 350);
    return () => clearTimeout(t);
  }, [settings]);

  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.min(1200, Math.max(300, doc.documentElement.scrollHeight + 4)));
  };
  useEffect(() => { const t = setTimeout(fit, 80); return () => clearTimeout(t); }, [html, device]);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const res = await saveLayoutAction(settings as unknown as Record<string, unknown>, version);
    setSaving(false);
    dialog.current?.close();
    if (res.ok) {
      setVersion(res.version);
      setBaseline(JSON.stringify(settings));
      setNotice({ kind: "success", message: res.message ?? "Saved." });
    } else {
      if (res.fieldErrors) setErrors(res.fieldErrors);
      setNotice({ kind: res.conflict ? "conflict" : "error", message: res.message });
    }
  };

  const seg = (active: boolean) => `rounded-md px-2.5 py-1 text-xs font-medium ${active ? "bg-gray-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`;
  const hasFieldErrors = Object.keys(errors).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-neutral-500">
          {isDefault && version === 0 ? "Using the built-in default layout (nothing saved yet)." : `Version ${version}${updatedBy ? ` · last saved by ${updatedBy}` : ""}${updatedAt ? ` · ${new Date(updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}`}
          {dirty && <span className="ml-2 font-medium text-red-600">Unsaved changes</span>}
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" disabled={disabled} onClick={() => setSettings(DEFAULT_LAYOUT)} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Reset to defaults</button>
            <button type="button" disabled={disabled || !dirty || hasFieldErrors} onClick={() => dialog.current?.showModal()} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">Save layout…</button>
          </div>
        )}
      </div>

      {notice && (
        <div role={notice.kind === "success" ? "status" : "alert"} className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-4 py-3 text-sm ${notice.kind === "success" ? "bg-emerald-50 text-emerald-800" : notice.kind === "conflict" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}>
          <span>{notice.message}</span>
          {notice.kind === "conflict" && <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white">Reload latest</button>}
        </div>
      )}
      {!canEdit && <p className="rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-600">You have view-only access to the email layout.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <form onSubmit={(ev) => ev.preventDefault()} className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Layout settings">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Header</legend>
            <Field label="Logo URL" id="l-logo" errors={e("logoUrl")} hint="A full https:// image address (PNG or JPG). The default is the REBX logo.">
              <input id="l-logo" className={input} disabled={disabled} value={settings.logoUrl} onChange={(ev) => set("logoUrl", ev.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Logo width (px)" id="l-width" errors={e("logoWidth")}>
                <input id="l-width" type="number" min={60} max={300} className={input} disabled={disabled} value={settings.logoWidth} onChange={(ev) => set("logoWidth", Number(ev.target.value))} />
              </Field>
              <Field label="Logo alt text" id="l-alt" errors={e("logoAlt")}>
                <input id="l-alt" className={input} disabled={disabled} value={settings.logoAlt} onChange={(ev) => set("logoAlt", ev.target.value)} maxLength={80} />
              </Field>
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Colours</legend>
            <ColorField id="l-accent" label="Accent bar" value={settings.accentColor} onChange={(v) => set("accentColor", v)} disabled={disabled} errors={e("accentColor")} />
            <ColorField id="l-bg" label="Page background" value={settings.backgroundColor} onChange={(v) => set("backgroundColor", v)} disabled={disabled} errors={e("backgroundColor")} />
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Footer</legend>
            <Field label="Company line" id="l-foot" errors={e("footerText")}>
              <textarea id="l-foot" rows={2} className={input} disabled={disabled} value={settings.footerText} onChange={(ev) => set("footerText", ev.target.value)} maxLength={300} />
            </Field>
            <Field label="Why they got this email" id="l-note" errors={e("footerNote")}>
              <textarea id="l-note" rows={2} className={input} disabled={disabled} value={settings.footerNote} onChange={(ev) => set("footerNote", ev.target.value)} maxLength={300} />
            </Field>
            <Field label="Support email (optional)" id="l-support" errors={e("supportEmail")} hint="Shown as “Questions? …” in the footer. Leave empty to hide it.">
              <input id="l-support" type="email" className={input} disabled={disabled} value={settings.supportEmail} onChange={(ev) => set("supportEmail", ev.target.value)} />
            </Field>
          </fieldset>
        </form>

        <section aria-label="Layout preview" className="flex min-w-0 flex-col gap-2" aria-busy={loading}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Live preview</h2>
            <div role="group" aria-label="Preview device" className="flex gap-1">
              <button type="button" className={seg(device === "desktop")} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
              <button type="button" className={seg(device === "mobile")} aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button>
            </div>
          </div>
          <div className={`rounded-lg bg-neutral-100 p-3 ${loading ? "opacity-60" : ""}`}>
            <div className="mx-auto overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm" style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%" }}>
              {html ? (
                <iframe ref={frame} title="Layout preview" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={html} onLoad={fit} style={{ width: "100%", height, border: 0, display: "block" }} />
              ) : (
                <p className="p-6 text-center text-sm text-neutral-500">Rendering preview…</p>
              )}
            </div>
          </div>
          <p className="text-xs text-neutral-500">The sample message inside the card stands in for each template&apos;s own content.</p>
        </section>
      </div>

      <dialog ref={dialog} aria-labelledby="layout-save-title" className="m-auto w-full max-w-md rounded-xl border border-neutral-200 p-0 shadow-xl backdrop:bg-black/40">
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id="layout-save-title" className="text-lg font-semibold">Save the email layout?</h2>
            <p className="mt-1 text-sm text-neutral-500">This changes <strong>every email</strong> the platform sends, starting immediately: welcome, password reset, notifications and any templates you create later.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={saving} onClick={save} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">{saving ? "Saving…" : "Save for all emails"}</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
