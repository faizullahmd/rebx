// Pure placeholder analysis (no zod, no environment access), so the editor can run it live in
// the browser and the server can run the very same checks on save.
import {
  BUILT_IN_BY_KEY,
  VARIABLES,
  mustAppearVariables,
  variablesForTemplate,
} from "@/lib/email/definitions";
import { collectVariables, type RenderIssue } from "@/lib/email/render";

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

export function suggestVariable(name: string, allowed: string[]): string | null {
  let best: { v: string; d: number } | null = null;
  for (const candidate of allowed) {
    const d = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (d <= 2 && (!best || d < best.d)) best = { v: candidate, d };
  }
  return best?.v ?? null;
}

export interface ContentAnalysis {
  issues: RenderIssue[];
  used: string[];
  hasErrors: boolean;
}

/** Placeholder validation for a template's subject, HTML and text. Used by the editor and on save. */
export function analyseContent(input: {
  key: string;
  subject: string;
  htmlBody: string;
  textBody?: string | null;
}): ContentAnalysis {
  const refs = variablesForTemplate(input.key);
  const allowed = refs.map((r) => r.name);
  const issues: RenderIssue[] = [];
  const usedAll = new Set<string>();
  const seen = new Set<string>();

  const scan = (label: string, source: string) => {
    const { used, errors } = collectVariables(source);
    for (const message of errors) {
      issues.push({ severity: "error", code: "syntax", message: `${label}: ${message}` });
    }
    for (const name of used) {
      usedAll.add(name);
      if (label === "Subject" && VARIABLES[name]?.type === "html" && !seen.has(`html:${name}`)) {
        seen.add(`html:${name}`);
        issues.push({
          severity: "error",
          code: "unknown_variable",
          variable: name,
          message: `Subject: {{${name}}} is a block of HTML and can't be used in the subject line.`,
        });
      }
      if (!allowed.includes(name) && !seen.has(`${label}:${name}`)) {
        seen.add(`${label}:${name}`);
        const hint = suggestVariable(name, allowed);
        issues.push({
          severity: "error",
          code: "unknown_variable",
          variable: name,
          message: `${label}: {{${name}}} isn't a supported variable${hint ? ` — did you mean {{${hint}}}?` : "."}`,
        });
      }
    }
  };

  scan("Subject", input.subject);
  scan("HTML", input.htmlBody);
  if (input.textBody) scan("Plain text", input.textBody);

  const bodyVars = new Set<string>([
    ...collectVariables(input.htmlBody).used,
    ...collectVariables(input.textBody ?? "").used,
  ]);
  for (const name of mustAppearVariables(input.key)) {
    if (!bodyVars.has(name)) {
      issues.push({
        severity: "error",
        code: "must_appear",
        variable: name,
        message: `The email body must include {{${name}}} — without it the email can't do its job (${VARIABLES[name]?.label ?? name}).`,
      });
    }
  }
  for (const ref of BUILT_IN_BY_KEY[input.key]?.variables ?? []) {
    if (ref.required && !mustAppearVariables(input.key).includes(ref.name) && !usedAll.has(ref.name)) {
      issues.push({
        severity: "warning",
        code: "unused_required",
        variable: ref.name,
        message: `{{${ref.name}}} is always available for this email but isn't used. That's fine if intentional.`,
      });
    }
  }

  return { issues, used: [...usedAll], hasErrors: issues.some((i) => i.severity === "error") };
}
