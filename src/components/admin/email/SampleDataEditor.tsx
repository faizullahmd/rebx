"use client";

import { VARIABLES, sampleDataFor, variablesForTemplate } from "@/lib/email/definitions";

/** Editable placeholder values for previews and test emails. Blank a value to see how a missing one renders. */
export function SampleDataEditor({
  templateKey,
  data,
  onChange,
  only,
}: {
  templateKey: string;
  data: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** Limit to variables the template actually uses (plus nothing else). */
  only?: Set<string>;
}) {
  const refs = variablesForTemplate(templateKey).filter((r) => !only || only.has(r.name) || r.required);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">Used by the preview and test emails. Clear a value to see what a missing variable looks like.</p>
        <button type="button" onClick={() => onChange(sampleDataFor(variablesForTemplate(templateKey)))} className="shrink-0 text-xs text-neutral-600 underline">
          Reset
        </button>
      </div>
      {refs.length === 0 && <p className="text-sm text-neutral-500">This template doesn&apos;t use any variables yet.</p>}
      {refs.map((r) => {
        const def = VARIABLES[r.name];
        if (def?.type === "html") {
          return (
            <div key={r.name} className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
              <code className="w-fit rounded bg-neutral-100 px-1 py-0.5">{`{{${r.name}}}`}</code>
              <p className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-2.5 py-2 text-xs font-normal text-neutral-500">
                Built automatically in real emails (the newest active listings). Previews and tests show 3 sample cards.
              </p>
            </div>
          );
        }
        return (
          <label key={r.name} className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
            <span className="flex items-center gap-1.5">
              <code className="rounded bg-neutral-100 px-1 py-0.5">{`{{${r.name}}}`}</code>
              {r.required && <span className="text-[10px] font-normal text-amber-700">always provided</span>}
            </span>
            <input
              value={data[r.name] ?? ""}
              onChange={(e) => onChange({ ...data, [r.name]: e.target.value })}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-normal"
              placeholder={def?.sample}
            />
          </label>
        );
      })}
    </div>
  );
}
