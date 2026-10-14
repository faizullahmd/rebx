import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "@/lib/email/sanitize";
import { htmlToText } from "@/lib/email/text";

const clean = (html: string) => sanitizeEmailHtml(html).html;

describe("HTML sanitization", () => {
  it("removes script tags and their content", () => {
    const r = sanitizeEmailHtml('<p>Hi</p><script>alert(1)</script>');
    expect(r.html).toBe("<p>Hi</p>");
    expect(r.warnings.join(" ")).toMatch(/script/i);
  });

  it("removes inline event handlers", () => {
    const out = clean('<p onclick="steal()" onmouseover="x()">Hi</p><a href="https://a.test" onclick="x()">l</a>');
    expect(out).not.toMatch(/onclick|onmouseover/i);
  });

  it("blocks javascript:, vbscript: and data: URLs in links", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:x", "data:text/html,<script>alert(1)</script>"]) {
      const out = clean(`<a href="${href}">x</a>`);
      expect(out).not.toMatch(/javascript|vbscript|data:/i);
    }
  });

  it("keeps safe links and placeholder links, drops relative ones", () => {
    expect(clean('<a href="https://rebx.app/x?a=1&b=2">x</a>')).toContain('href="https://rebx.app/x?a=1&amp;b=2"');
    expect(clean('<a href="mailto:a@b.com">m</a>')).toContain("mailto:a@b.com");
    expect(clean('<a href="{{dealUrl}}">go</a>')).toContain('href="{{dealUrl}}"');
    expect(clean('<a href="/relative">r</a>')).not.toContain("href=");
  });

  it("only allows https images and placeholder images", () => {
    expect(clean('<img src="https://cdn.test/a.png" alt="a">')).toContain('src="https://cdn.test/a.png"');
    expect(clean('<img src="http://cdn.test/a.png">')).toBe("");
    expect(clean('<img src="data:image/svg+xml;base64,AAAA">')).toBe("");
    expect(clean('<img src="javascript:alert(1)">')).toBe("");
  });

  it("removes iframes, forms, style blocks and other active content", () => {
    const out = clean('<iframe src="https://evil.test"></iframe><form action="/x"><input name="a"></form><style>body{display:none}</style><object data="x"></object><p>ok</p>');
    expect(out).toBe("<p>ok</p>");
  });

  it("keeps email-friendly inline styles but strips dangerous ones", () => {
    const out = clean('<p style="color:#ff0000;font-size:18px;text-align:center;background:url(javascript:alert(1));position:fixed;behavior:url(x)">x</p>');
    expect(out).toContain("color:#ff0000");
    expect(out).toContain("font-size:18px");
    expect(out).toContain("text-align:center");
    expect(out).not.toMatch(/url\(|position|behavior|javascript/i);
  });

  it("keeps tables with layout attributes", () => {
    const out = clean('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tbody><tr><td align="center" style="padding:16px">x</td></tr></tbody></table>');
    expect(out).toContain('role="presentation"');
    expect(out).toContain("max-width:600px");
    expect(out).toContain('align="center"');
  });

  it("neutralises encoded and obfuscated payloads", () => {
    const out = clean('<a href="&#106;avascript:alert(1)">x</a><svg onload="x()"></svg><math><mi xlink:href="javascript:x"></mi></math>');
    expect(out).not.toMatch(/javascript|onload|<svg|<math/i);
  });

  it("preserves placeholders in text", () => {
    expect(clean("<p>Hi {{name}}, {{#if message}}{{message}}{{/if}}</p>")).toBe("<p>Hi {{name}}, {{#if message}}{{message}}{{/if}}</p>");
  });
});

describe("plain-text generation", () => {
  it("turns HTML into readable text with link targets", () => {
    const text = htmlToText('<h1>Title</h1><p>Hello <b>there</b>.</p><ul><li>One</li><li>Two</li></ul><p><a href="https://x.test/a">Open</a></p>');
    expect(text).toContain("Title");
    expect(text).toContain("Hello there.");
    expect(text).toContain("- One");
    expect(text).toContain("Open (https://x.test/a)");
    expect(text).not.toMatch(/[<>]/);
  });

  it("decodes entities and drops scripts", () => {
    expect(htmlToText("<p>A &amp; B &lt;3</p><script>x()</script>")).toBe("A & B <3");
  });
});
