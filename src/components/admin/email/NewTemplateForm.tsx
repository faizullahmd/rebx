"use client";

import { useActionState } from "react";
import { createTemplateAction } from "@/lib/actions/email-templates";
import { EMAIL_CATEGORIES } from "@/lib/email/definitions";

function Field({ label, name, hint, errors, children }: { label: string; name: string; hint?: string; errors?: string[]; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && !errors && <p className="text-xs text-neutral-500">{hint}</p>}
      {errors?.map((e) => <p key={e} className="text-xs text-red-600">{e}</p>)}
    </div>
  );
}

const input = "rounded-md border border-gray-300 px-3 py-2 text-sm";

export function NewTemplateForm() {
  const [state, action, pending] = useActionState(createTemplateAction, undefined);
  const err = state?.fieldErrors ?? {};
  const v = state?.values ?? {};

  return (
    <form key={state?.message ?? "new"} action={action} className="flex max-w-xl flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-6">
      {state?.message && !state.fieldErrors && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>}
      <Field label="Name" name="name" errors={err.name}>
        <input id="name" name="name" defaultValue={v.name} required maxLength={120} className={input} placeholder="Payment receipt" />
      </Field>
      <Field label="Unique key" name="key" errors={err.key} hint="Lowercase letters, numbers and underscores, e.g. payment_receipt. Can't be changed later.">
        <input id="key" name="key" defaultValue={v.key} required maxLength={64} className={`${input} font-mono`} placeholder="payment_receipt" />
      </Field>
      <Field label="Category" name="category" errors={err.category}>
        <select id="category" name="category" defaultValue={v.category ?? "Custom"} className={input}>
          {EMAIL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Event / trigger" name="event" errors={err.event} hint="Where this email is meant to be sent from, e.g. billing.payment_received. Custom templates are not sent automatically; developers wire them to an event.">
        <input id="event" name="event" defaultValue={v.event} required maxLength={80} className={`${input} font-mono`} placeholder="billing.payment_received" />
      </Field>
      <Field label="Subject" name="subject" errors={err.subject}>
        <input id="subject" name="subject" defaultValue={v.subject} required maxLength={200} className={input} placeholder="Your receipt from REBX" />
      </Field>
      <Field label="Description (optional)" name="description" errors={err.description}>
        <textarea id="description" name="description" defaultValue={v.description} rows={2} maxLength={500} className={input} />
      </Field>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {pending ? "Creating…" : "Create and open editor"}
        </button>
      </div>
    </form>
  );
}
