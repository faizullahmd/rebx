import { describe, expect, it } from "vitest";
import { collectVariables, escapeHtml, parseTemplate, renderTemplate, TemplateRenderError } from "@/lib/email/render";
import { renderParts } from "@/lib/email/pipeline";

const allowed = new Set(["name", "listingTitle", "dealUrl", "contactPhone", "message"]);
const html = (src: string, data: Record<string, string | null | undefined>, extra = {}) =>
  renderTemplate(src, data, { context: "html", mode: "strict", allowed, ...extra });

describe("placeholder rendering", () => {
  it("substitutes variables", () => {
    expect(html("Hi {{name}}!", { name: "Casey" }).output).toBe("Hi Casey!");
  });

  it("tolerates whitespace inside braces", () => {
    expect(html("Hi {{ name }}!", { name: "Casey" }).output).toBe("Hi Casey!");
  });

  it("escapes HTML in values so dynamic content can't inject markup", () => {
    const out = html("<p>{{name}}</p>", { name: `<img src=x onerror="alert(1)">&'` }).output;
    expect(out).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;</p>");
    expect(out).not.toContain("<img");
  });

  it("does not escape in plain-text and subject contexts, and strips line breaks from subjects", () => {
    const text = renderTemplate("{{name}}", { name: "A & B" }, { context: "text", mode: "strict", allowed });
    expect(text.output).toBe("A & B");
    const subject = renderTemplate("Hello {{name}}", { name: "A\r\nBcc: evil@x.com" }, { context: "subject", mode: "strict", allowed });
    expect(subject.output).toBe("Hello A Bcc: evil@x.com");
    expect(subject.output).not.toMatch(/[\r\n]/);
  });

  it("renders conditional blocks only when the value is non-empty", () => {
    const src = "A{{#if contactPhone}}<br/>{{contactPhone}}{{/if}}B";
    expect(html(src, { contactPhone: "555" }).output).toBe("A<br/>555B");
    expect(html(src, { contactPhone: "" }).output).toBe("AB");
    expect(html(src, {}).output).toBe("AB");
    expect(html(src, { contactPhone: null }).output).toBe("AB");
  });

  it("supports nested conditionals", () => {
    const src = "{{#if name}}[{{#if message}}{{message}}{{/if}}]{{/if}}";
    expect(html(src, { name: "x", message: "m" }).output).toBe("[m]");
    expect(html(src, { name: "x" }).output).toBe("[]");
    expect(html(src, { message: "m" }).output).toBe("");
  });

  it("leaves non-template braces and look-alike text alone", () => {
    expect(html("a { b } c", {}).output).toBe("a { b } c");
  });
});

describe("missing and unsupported variables", () => {
  it("strict mode throws on an unknown (e.g. misspelled) variable", () => {
    expect(() => html("{{naem}}", { name: "x" })).toThrow(TemplateRenderError);
    try {
      html("{{naem}}", { name: "x" });
    } catch (e) {
      expect((e as TemplateRenderError).issues[0]).toMatchObject({ code: "unknown_variable", variable: "naem" });
    }
  });

  it("strict mode throws when a required variable has no value, so no broken email is sent", () => {
    expect(() => html("{{dealUrl}}", {}, { required: new Set(["dealUrl"]) })).toThrow(/dealUrl/);
    expect(() => html("{{dealUrl}}", { dealUrl: "" }, { required: new Set(["dealUrl"]) })).toThrow(TemplateRenderError);
  });

  it("an optional variable may be empty without error", () => {
    expect(html("[{{message}}]", { message: "" }).output).toBe("[]");
  });

  it("preview mode never throws and marks problems visibly", () => {
    const r = renderTemplate("{{name}} {{naem}}", {}, { context: "html", mode: "preview", allowed, required: new Set(["name"]) });
    expect(r.output).toContain("missing: name");
    expect(r.output).toContain("unknown: naem");
    expect(r.issues.map((i) => i.code).sort()).toEqual(["missing_required", "unknown_variable"]);
  });

  it("rejects non-http(s) values for URL variables (e.g. javascript:)", () => {
    const urlAllowed = new Set(["resetUrl"]);
    expect(() => renderTemplate("{{resetUrl}}", { resetUrl: "javascript:alert(1)" }, { context: "html", mode: "strict", allowed: urlAllowed })).toThrow(/URL/);
    const ok = renderTemplate("{{resetUrl}}", { resetUrl: "https://x.test/a?b=1&c=2" }, { context: "html", mode: "strict", allowed: urlAllowed });
    expect(ok.output).toBe("https://x.test/a?b=1&amp;c=2");
  });

  it("reports syntax errors for unbalanced or malformed blocks", () => {
    expect(parseTemplate("{{#if name}}x").errors[0]).toMatch(/never closed/);
    expect(parseTemplate("x{{/if}}").errors[0]).toMatch(/without a matching/);
    expect(parseTemplate("{{ name").errors.length).toBeGreaterThan(0);
    expect(() => html("{{#if name}}x", { name: "a" })).toThrow(TemplateRenderError);
  });

  it("collects the variables a template uses, including inside conditionals", () => {
    expect(collectVariables("{{a}} {{#if b}}{{c}}{{/if}}").used.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("renderParts (shared by production, preview and test sends)", () => {
  it("renders a built-in template's three parts with its own variable rules", () => {
    const r = renderParts("welcome", { subject: "Hi {{name}}", htmlBody: "<p>{{name}}</p>", textBody: "Hi {{name}}" }, { name: "A<B" }, "strict");
    expect(r).toMatchObject({ subject: "Hi A<B", html: "<p>A&lt;B</p>", text: "Hi A<B" });
  });

  it("returns null text when the template has no plain-text part", () => {
    expect(renderParts("welcome", { subject: "s", htmlBody: "<p>x</p>" }, { name: "a" }, "strict").text).toBeNull();
  });

  it("uses the full variable catalogue for custom templates", () => {
    expect(renderParts("my_custom", { subject: "s", htmlBody: "{{listingTitle}}" }, { listingTitle: "X" }, "strict").html).toBe("X");
  });

  it("escapeHtml escapes all five dangerous characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
