import "server-only";
import { VARIABLES, variablesForTemplate } from "@/lib/email/definitions";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import {
  renderTemplate,
  type RenderIssue,
  type RenderMode,
  type TemplateData,
} from "@/lib/email/render";

export interface TemplateParts {
  subject: string;
  htmlBody: string;
  textBody?: string | null;
}

export interface RenderedParts {
  subject: string;
  html: string;
  /** null when the template has no plain-text part (matches how existing emails are sent). */
  text: string | null;
  issues: RenderIssue[];
}

/**
 * Renders subject, HTML and text with the same rules for production, preview and test sends.
 * "strict" throws TemplateRenderError on any error; "preview" never throws and marks problems.
 */
export function renderParts(
  key: string,
  parts: TemplateParts,
  data: TemplateData,
  mode: RenderMode
): RenderedParts {
  const refs = variablesForTemplate(key);
  const allowed = new Set(refs.map((r) => r.name));

  // "html" variables are inserted unescaped, so they're sanitized here even though they are
  // built by server code. Nothing unsafe can reach a recipient through them.
  const safeData: TemplateData = { ...data };
  for (const ref of refs) {
    if (VARIABLES[ref.name]?.type === "html" && safeData[ref.name]) {
      safeData[ref.name] = sanitizeEmailHtml(String(safeData[ref.name])).html;
    }
  }
  data = safeData;
  const required = new Set(refs.filter((r) => r.required).map((r) => r.name));
  const base = { mode, allowed, required };

  const subject = renderTemplate(parts.subject, data, { ...base, context: "subject" });
  const html = renderTemplate(parts.htmlBody, data, { ...base, context: "html" });
  const text = parts.textBody
    ? renderTemplate(parts.textBody, data, { ...base, context: "text" })
    : null;

  const seen = new Set<string>();
  const issues = [...subject.issues, ...html.issues, ...(text?.issues ?? [])].filter((i) => {
    const id = `${i.code}:${i.variable ?? i.message}`;
    return seen.has(id) ? false : (seen.add(id), true);
  });

  return { subject: subject.output, html: html.output, text: text?.output ?? null, issues };
}
