"use client";

import { useMemo, useState } from "react";
import { VARIABLES, VARIABLE_GROUPS, variablesForTemplate } from "@/lib/email/definitions";

/** Lists the variables available to this template, grouped, with insert and copy actions. */
export function VariablePanel({
  templateKey,
  used,
  onInsert,
  disabled,
  target,
}: {
  templateKey: string;
  used: Set<string>;
  onInsert: (token: string) => void;
  disabled?: boolean;
  /** Human label of the field the next insert will go into. */
  target?: string;
}) {
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const refs = useMemo(() => variablesForTemplate(templateKey), [templateKey]);
  const refByName = useMemo(() => new Map(refs.map((r) => [r.name, r])), [refs]);

  const copy = async (token: string, name: string) => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(name);
    setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
  };

  const needle = q.trim().toLowerCase();
  const groups = VARIABLE_GROUPS.map((group) => ({
    group,
    items: refs
      .map((r) => VARIABLES[r.name])
      .filter((v) => v && v.group === group)
      .filter((v) => !needle || v.name.toLowerCase().includes(needle) || v.label.toLowerCase().includes(needle)),
  })).filter((g) => g.items.length);

  const small = "rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-100 disabled:opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        Click <strong>Insert</strong> to place a variable at your cursor. Values are HTML-escaped automatically.
        {target && <span className="mt-1 block rounded bg-neutral-100 px-2 py-1 text-neutral-700" aria-live="polite">Inserts into: <strong>{target}</strong>. Click in a field to change it.</span>}
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search variables"
        aria-label="Search variables"
        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
      />
      {groups.length === 0 && <p className="text-sm text-neutral-500">No variables match.</p>}
      {groups.map(({ group, items }) => (
        <section key={group} aria-label={`${group} variables`}>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{group}</h3>
          <ul className="flex flex-col gap-1.5">
            {items.map((v) => {
              const ref = refByName.get(v.name)!;
              const token = `{{${v.name}}}`;
              return (
                <li key={v.name} className="rounded-md border border-neutral-200 p-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs">{token}</code>
                    {ref.mustAppear ? (
                      <span className="rounded bg-red-50 px-1.5 text-[10px] font-medium text-red-700">must be in body</span>
                    ) : ref.required ? (
                      <span className="rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700">always provided</span>
                    ) : (
                      <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-500">optional</span>
                    )}
                    {used.has(v.name) && <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-700">used</span>}
                  </div>
                  <p className="mt-1 text-xs text-neutral-600">{v.description}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-400">
                    {v.type === "html" ? "Built automatically from live data. Previews and test emails show sample content." : `Example: ${v.sample}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button type="button" disabled={disabled} onClick={() => onInsert(token)} className={small}>Insert</button>
                    <button type="button" onClick={() => copy(token, v.name)} className={small}>{copied === v.name ? "Copied ✓" : "Copy"}</button>
                    {!ref.required && (
                      <button type="button" disabled={disabled} onClick={() => onInsert(`{{#if ${v.name}}}…{{/if}}`)} className={small} title="Only show a section when this value is not empty">
                        Insert if-block
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
