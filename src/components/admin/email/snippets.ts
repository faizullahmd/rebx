// Reusable email components an admin can drop into any template. (The logo header and footer are
// NOT here: the shared layout adds them to every email.) They are plain, inline-styled,
// table-based HTML (the most compatible email markup) and deliberately contain no variables
// and no invented contact details, so they work in every template. Edit the text after inserting.

export interface Snippet {
  id: string;
  label: string;
  description: string;
  html: string;
}

const FONT = "font-family:Arial,Helvetica,sans-serif;";

export const SNIPPETS: Snippet[] = [
  {
    id: "contact",
    label: "Contact details",
    description: "A short 'questions?' block. Edit the wording to match your support process.",
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tbody><tr><td style="padding:16px;background-color:#f4f4f5;border-radius:6px;${FONT}font-size:14px;line-height:20px;color:#3f3f46;"><strong>Questions?</strong><br>Just reply to this email and our team will get back to you.</td></tr></tbody></table>`,
  },
  {
    id: "disclaimer",
    label: "Disclaimer",
    description: "Standard confidentiality / no-reply style disclaimer.",
    html: `<p style="margin:16px 0 0 0;${FONT}font-size:11px;line-height:16px;color:#a1a1aa;">This message and any links in it are intended only for the recipient. If you received it by mistake, please delete it and let us know.</p>`,
  },
];

export const FONT_FAMILIES = [
  "Arial, Helvetica, sans-serif",
  "Georgia, serif",
  "'Times New Roman', Times, serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
  "'Trebuchet MS', Helvetica, sans-serif",
  "'Courier New', Courier, monospace",
];

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

export function tableHtml(rows: number, cols: number, header: boolean) {
  const cell = `padding:8px 12px;border:1px solid #e4e4e7;${FONT}font-size:14px;color:#18181b;`;
  const head = `${cell}background-color:#f4f4f5;font-weight:bold;text-align:left;`;
  const tr = (tag: "td" | "th", n: number) =>
    `<tr>${Array.from({ length: n }, (_, i) => `<${tag} style="${tag === "th" ? head : cell}">${tag === "th" ? `Column ${i + 1}` : "&nbsp;"}</${tag}>`).join("")}</tr>`;
  const body = Array.from({ length: Math.max(1, rows - (header ? 1 : 0)) }, () => tr("td", cols)).join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">${
    header ? `<thead>${tr("th", cols)}</thead>` : ""
  }<tbody>${body}</tbody></table><p><br></p>`;
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const escapeText = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buttonHtml(label: string, href: string, color: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tbody><tr><td style="background-color:${color};border-radius:6px;"><a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 24px;${FONT}font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeText(label)}</a></td></tr></tbody></table><p><br></p>`;
}

export const DIVIDER_HTML = `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;"><p><br></p>`;

export function spacerHtml(px: number) {
  return `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div><p><br></p>`;
}

/** Links must be absolute http(s)/mailto/tel URLs, or a {{variable}} placeholder. */
export function isSafeLinkTarget(value: string) {
  return /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+|tel:[^\s"<>]+|\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\})$/i.test(value.trim());
}

export function isSafeImageSource(value: string) {
  return /^(https:\/\/[^\s"<>]+|\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\})$/i.test(value.trim());
}
