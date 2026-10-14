// The one rendering engine used by production sends, the live preview and test emails, so
// what an admin previews is what recipients get. Pure (no I/O), safe to import anywhere.
//
// Syntax (deliberately small):
//   {{variable}}                   substitutes a value (HTML-escaped in HTML contexts)
//   {{#if variable}}...{{/if}}     renders the block only when the value is non-empty
// There are no loops, filters or expressions: nothing an editor types can execute code.

import { VARIABLES } from "@/lib/email/definitions";
import { escapeHtml } from "@/lib/email/escape";
import { htmlToText } from "@/lib/email/text";

export type RenderContext = "html" | "text" | "subject";
export type RenderMode = "strict" | "preview";
export type TemplateData = Record<string, string | number | null | undefined>;

export type IssueCode =
  | "syntax"
  | "unknown_variable"
  | "missing_required"
  | "invalid_url"
  | "must_appear";

export interface RenderIssue {
  severity: "error" | "warning";
  code: IssueCode;
  variable?: string;
  message: string;
}

export class TemplateRenderError extends Error {
  constructor(public issues: RenderIssue[]) {
    super(`Email template failed to render: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "TemplateRenderError";
  }
}

export { escapeHtml };

type Node =
  | { type: "text"; value: string }
  | { type: "var"; name: string }
  | { type: "if"; name: string; children: Node[] };

const TOKEN = /\{\{\s*(#if\s+([A-Za-z_][A-Za-z0-9_]*)|\/if|([A-Za-z_][A-Za-z0-9_]*))\s*\}\}/g;

export function parseTemplate(source: string): { nodes: Node[]; errors: string[] } {
  const errors: string[] = [];
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [];
  let current = root;
  let last = 0;

  for (const match of source.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) current.push({ type: "text", value: source.slice(last, index) });
    last = index + match[0].length;

    if (match[2]) {
      const block = { name: match[2], children: [] as Node[] };
      current.push({ type: "if", name: block.name, children: block.children });
      stack.push(block);
      current = block.children;
    } else if (match[1] === "/if") {
      if (stack.length === 0) {
        errors.push("Found {{/if}} without a matching {{#if ...}}.");
      } else {
        stack.pop();
        current = stack.length ? stack[stack.length - 1].children : root;
      }
    } else if (match[3]) {
      current.push({ type: "var", name: match[3] });
    }
  }
  if (last < source.length) current.push({ type: "text", value: source.slice(last) });
  for (const open of stack) errors.push(`{{#if ${open.name}}} is never closed with {{/if}}.`);

  // Anything that looks like a placeholder but didn't tokenize is almost certainly a typo.
  const stripped = source.replace(TOKEN, "");
  const stray = stripped.match(/\{\{[^}]*\}?\}?|\}\}/);
  if (stray) errors.push(`Malformed placeholder near "${stray[0].slice(0, 30)}". Use {{variableName}}.`);

  return { nodes: root, errors };
}

export function collectVariables(source: string): { used: string[]; errors: string[] } {
  const { nodes, errors } = parseTemplate(source);
  const used = new Set<string>();
  const walk = (list: Node[]) => {
    for (const n of list) {
      if (n.type === "var") used.add(n.name);
      else if (n.type === "if") {
        used.add(n.name);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return { used: [...used], errors };
}

export interface RenderOptions {
  context: RenderContext;
  mode: RenderMode;
  /** Variables the template may use. Anything else is an "unknown variable". */
  allowed: ReadonlySet<string>;
  /** Variables that must have a non-empty value. */
  required?: ReadonlySet<string>;
}

const URL_VALUE = /^https?:\/\/[^\s<>"']+$/i;

function missingMarker(kind: "missing" | "unknown", name: string, context: RenderContext) {
  if (context === "html") {
    return `<span style="background:#fee2e2;color:#b91c1c;padding:0 4px;border-radius:3px;font-family:monospace;">⟦${kind}: ${escapeHtml(name)}⟧</span>`;
  }
  return `[[${kind}: ${name}]]`;
}

export function renderTemplate(
  source: string,
  data: TemplateData,
  options: RenderOptions
): { output: string; issues: RenderIssue[] } {
  const { context, mode, allowed, required } = options;
  const issues: RenderIssue[] = [];
  const reported = new Set<string>();
  const report = (issue: RenderIssue) => {
    const id = `${issue.code}:${issue.variable ?? issue.message}`;
    if (!reported.has(id)) {
      reported.add(id);
      issues.push(issue);
    }
  };

  const { nodes, errors } = parseTemplate(source);
  for (const message of errors) report({ severity: "error", code: "syntax", message });

  const valueOf = (name: string) => {
    const raw = data[name];
    return raw === null || raw === undefined ? "" : String(raw);
  };

  const check = (name: string): { known: boolean; value: string; valid: boolean } => {
    if (!allowed.has(name)) {
      report({
        severity: "error",
        code: "unknown_variable",
        variable: name,
        message: `Unknown variable {{${name}}}.`,
      });
      return { known: false, value: "", valid: false };
    }
    const value = valueOf(name);
    if (required?.has(name) && value === "") {
      report({
        severity: "error",
        code: "missing_required",
        variable: name,
        message: `Required variable {{${name}}} has no value.`,
      });
      return { known: true, value, valid: false };
    }
    if (value !== "" && VARIABLES[name]?.type === "url" && !URL_VALUE.test(value)) {
      report({
        severity: "error",
        code: "invalid_url",
        variable: name,
        message: `Variable {{${name}}} must be an http(s) URL.`,
      });
      return { known: true, value, valid: false };
    }
    return { known: true, value, valid: true };
  };

  const walk = (list: Node[]): string => {
    let out = "";
    for (const node of list) {
      if (node.type === "text") {
        out += node.value;
      } else if (node.type === "if") {
        const { known, value } = check(node.name);
        if (known && value !== "") out += walk(node.children);
        else walk(node.children); // still validate variables inside a skipped block
      } else {
        const { known, value, valid } = check(node.name);
        if (!known) {
          out += mode === "preview" ? missingMarker("unknown", node.name, context) : "";
        } else if (!valid && value === "") {
          out += mode === "preview" ? missingMarker("missing", node.name, context) : "";
        } else if (!valid) {
          // Invalid URL: show it, but flagged by the issue list; never auto-link it.
          out += context === "html" ? escapeHtml(value) : value;
        } else if (VARIABLES[node.name]?.type === "html") {
          // Trusted, server-built (and already sanitized) markup: inserted as-is in the HTML
          // body, flattened to text elsewhere. Never used for admin- or user-typed values.
          out += context === "html" ? value : htmlToText(value);
        } else {
          out += context === "html" ? escapeHtml(value) : value;
        }
      }
    }
    return out;
  };

  let output = walk(nodes);
  if (context === "subject") output = output.replace(/[\r\n]+/g, " ").trim();

  if (mode === "strict" && issues.some((i) => i.severity === "error")) {
    throw new TemplateRenderError(issues.filter((i) => i.severity === "error"));
  }
  return { output, issues };
}
