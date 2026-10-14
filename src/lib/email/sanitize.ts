import "server-only";
import sanitizeHtml from "sanitize-html";

// Allowlist sanitizer for email HTML. Everything not listed here is removed: no scripts,
// event handlers, iframes, forms, <style> blocks or javascript:/data: URLs. Inline CSS is
// kept (email clients need it) but only for properties and value shapes listed below.

const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i, /^[a-z]{3,20}$/i];
const LENGTH = [/^-?\d+(\.\d+)?(px|em|rem|%|pt)?$/, /^auto$/];
const SHORTHAND = [/^(-?\d+(\.\d+)?(px|em|rem|%|pt)?\s*|auto\s*){1,4}$/];
const BORDER = [/^[a-z0-9#\s.,()%-]{1,60}$/i];

const ALLOWED_STYLES = {
  color: COLOR,
  "background-color": COLOR,
  "font-size": LENGTH,
  "font-family": [/^[a-zA-Z0-9 ,'"-]{1,120}$/],
  "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
  "font-style": [/^(normal|italic|oblique)$/],
  "text-align": [/^(left|right|center|justify)$/],
  "text-decoration": [/^(none|underline|line-through)$/],
  "text-transform": [/^(none|uppercase|lowercase|capitalize)$/],
  "letter-spacing": LENGTH,
  "line-height": [/^\d+(\.\d+)?(px|em|rem|%|pt)?$/, /^normal$/],
  "vertical-align": [/^(top|middle|bottom|baseline)$/],
  padding: SHORTHAND,
  "padding-top": LENGTH,
  "padding-right": LENGTH,
  "padding-bottom": LENGTH,
  "padding-left": LENGTH,
  margin: SHORTHAND,
  "margin-top": LENGTH,
  "margin-right": LENGTH,
  "margin-bottom": LENGTH,
  "margin-left": LENGTH,
  width: LENGTH,
  "max-width": LENGTH,
  "min-width": LENGTH,
  height: LENGTH,
  border: BORDER,
  "border-top": BORDER,
  "border-right": BORDER,
  "border-bottom": BORDER,
  "border-left": BORDER,
  "border-color": BORDER,
  "border-radius": SHORTHAND,
  "border-collapse": [/^(collapse|separate)$/],
  display: [/^(block|inline|inline-block|table|table-cell)$/],
};

const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "blockquote",
  "a", "img", "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
];

const PLACEHOLDER = /^\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/;
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)/i;
const SAFE_SRC = /^https:\/\//i;

export interface SanitizeResult {
  html: string;
  /** Human-readable notes about content that was removed or changed. */
  warnings: string[];
}

export function describeUnsafeContent(html: string): string[] {
  const warnings: string[] = [];
  if (/<script\b/i.test(html)) warnings.push("Removed <script> tags (scripts are not allowed in emails).");
  if (/<(iframe|object|embed|form|input|button|select|textarea|link|meta|base|style)\b/i.test(html)) {
    warnings.push("Removed unsupported elements (iframe, form, style, and similar).");
  }
  if (/\son[a-z]+\s*=/i.test(html)) warnings.push("Removed inline event handlers (onclick and similar).");
  if (/(javascript|vbscript)\s*:|data\s*:\s*text\/html/i.test(html)) {
    warnings.push("Removed links using javascript:, vbscript: or data: URLs.");
  }
  return warnings;
}

export function sanitizeEmailHtml(input: string): SanitizeResult {
  const warnings = describeUnsafeContent(input);
  let droppedLinks = 0;
  let droppedImages = 0;

  const html = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title", "style"],
      img: ["src", "alt", "width", "height", "style"],
      table: ["role", "width", "cellpadding", "cellspacing", "border", "align", "style"],
      td: ["align", "valign", "colspan", "rowspan", "width", "height", "style"],
      th: ["align", "valign", "colspan", "rowspan", "width", "height", "style"],
      tr: ["style"],
      "*": ["style", "align"],
    },
    allowedStyles: { "*": ALLOWED_STYLES },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const href = (attribs.href ?? "").trim();
        if (href && !SAFE_HREF.test(href) && !PLACEHOLDER.test(href)) {
          droppedLinks++;
          const { href: _removed, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        return { tagName, attribs: { ...attribs, href } };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      const src = (frame.attribs.src ?? "").trim();
      const ok = SAFE_SRC.test(src) || PLACEHOLDER.test(src);
      if (!ok) droppedImages++;
      return !ok;
    },
  });

  if (droppedLinks) warnings.push(`${droppedLinks} link(s) had an unsafe or relative URL and were unlinked. Links must start with https://, http://, mailto: or tel:.`);
  if (droppedImages) warnings.push(`${droppedImages} image(s) were removed. Image URLs must start with https://.`);

  return { html, warnings: [...new Set(warnings)] };
}
