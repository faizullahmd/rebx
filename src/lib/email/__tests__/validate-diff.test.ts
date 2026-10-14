import { describe, expect, it } from "vitest";
import { analyseContent, contentFieldsSchema, createFieldsSchema, suggestVariable } from "@/lib/email/validate";
import { diffLines, hasChanges } from "@/lib/email/diff";
import { buildFromHeader, isAllowedSenderEmail, parseAddress } from "@/lib/email/sender";

const valid = {
  name: "Welcome", description: "", category: "Account", subject: "Hi", htmlBody: "<p>x</p>",
  textBody: "", fromName: "", fromEmail: "", replyTo: "", cc: "", bcc: "",
};

describe("field validation", () => {
  it("accepts a valid template and normalises empty optionals to null", () => {
    const r = contentFieldsSchema.parse(valid);
    expect(r).toMatchObject({ description: null, textBody: null, fromName: null, fromEmail: null, replyTo: null, cc: null, bcc: null });
  });

  it("treats null (database rows), undefined and empty string the same way for optional fields", () => {
    const nulls = { name: "Welcome", category: "Account", subject: "Hi", htmlBody: "<p>x</p>", description: null, textBody: null, fromName: null, fromEmail: null, replyTo: null, cc: null, bcc: null };
    expect(contentFieldsSchema.parse(nulls)).toMatchObject({ description: null, textBody: null, fromName: null, fromEmail: null, replyTo: null, cc: null, bcc: null });
    const { description, textBody, ...omitted } = nulls; void description; void textBody;
    expect(contentFieldsSchema.safeParse(omitted).success).toBe(true);
  });

  it("rejects bad subjects", () => {
    expect(contentFieldsSchema.safeParse({ ...valid, subject: "" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, subject: "a\nb" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, subject: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects empty or oversized HTML", () => {
    expect(contentFieldsSchema.safeParse({ ...valid, htmlBody: "" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, htmlBody: "x".repeat(200_001) }).success).toBe(false);
  });

  it("validates category, reply-to and cc/bcc lists", () => {
    expect(contentFieldsSchema.safeParse({ ...valid, category: "Nope" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, replyTo: "not-an-email" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, cc: "a@x.com, bad" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, cc: "a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com" }).success).toBe(false);
    expect(contentFieldsSchema.parse({ ...valid, cc: "A@x.com; b@x.com A@x.com" }).cc).toBe("a@x.com, b@x.com");
  });

  it("only allows a sender email on the verified domain, and clean sender names", () => {
    expect(contentFieldsSchema.safeParse({ ...valid, fromEmail: "team@resend.dev" }).success).toBe(true);
    expect(contentFieldsSchema.safeParse({ ...valid, fromEmail: "ceo@evil.com" }).success).toBe(false);
    expect(contentFieldsSchema.safeParse({ ...valid, fromName: 'A <evil@x.com>' }).success).toBe(false);
    expect(isAllowedSenderEmail("x@resend.dev")).toBe(true);
    expect(isAllowedSenderEmail("x@notresend.dev")).toBe(false);
  });

  it("validates template keys and events on create", () => {
    const base = { key: "promo_2026", event: "marketing.promo", name: "Promo", description: "", category: "Custom", subject: "Hi" };
    expect(createFieldsSchema.safeParse(base).success).toBe(true);
    for (const key of ["Promo", "1promo", "pr", "has space", "has-dash", "x".repeat(65)]) {
      expect(createFieldsSchema.safeParse({ ...base, key }).success).toBe(false);
    }
    expect(createFieldsSchema.safeParse({ ...base, event: "Bad Event" }).success).toBe(false);
  });
});

describe("placeholder analysis", () => {
  it("flags unknown variables with a did-you-mean suggestion", () => {
    const a = analyseContent({ key: "welcome", subject: "Hi {{nmae}}", htmlBody: "<p>{{name}}</p>" });
    expect(a.hasErrors).toBe(true);
    expect(a.issues.find((i) => i.variable === "nmae")?.message).toMatch(/did you mean \{\{name\}\}/);
  });

  it("blocks a built-in whose critical placeholder was removed", () => {
    const a = analyseContent({ key: "password_reset", subject: "Reset", htmlBody: "<p>no link here</p>" });
    expect(a.issues.some((i) => i.code === "must_appear" && i.variable === "resetUrl")).toBe(true);
    expect(a.hasErrors).toBe(true);
  });

  it("passes the original default content with no errors", () => {
    const a = analyseContent({ key: "password_reset", subject: "Reset", htmlBody: '<a href="{{resetUrl}}">{{resetUrl}}</a>' });
    expect(a.hasErrors).toBe(false);
  });

  it("restricts a built-in to its own variables but gives custom templates the full catalogue", () => {
    expect(analyseContent({ key: "welcome", subject: "s", htmlBody: "{{dealUrl}}" }).hasErrors).toBe(true);
    expect(analyseContent({ key: "my_custom", subject: "s", htmlBody: "{{dealUrl}}" }).hasErrors).toBe(false);
  });

  it("reports unbalanced conditionals", () => {
    expect(analyseContent({ key: "new_lead", subject: "s", htmlBody: "{{#if message}}x" }).hasErrors).toBe(true);
  });

  it("suggests close names only", () => {
    expect(suggestVariable("listingTitel", ["listingTitle", "name"])).toBe("listingTitle");
    expect(suggestVariable("zzzzzz", ["listingTitle", "name"])).toBeNull();
  });
});

describe("sender header", () => {
  it("returns the configured sender untouched when there are no overrides", () => {
    expect(buildFromHeader({})).toBe("REBX <onboarding@resend.dev>");
  });
  it("applies a display-name override on the configured address", () => {
    expect(buildFromHeader({ fromName: "REBX Support" })).toBe("REBX Support <onboarding@resend.dev>");
  });
  it("strips header-injection characters from the name", () => {
    expect(buildFromHeader({ fromName: 'Evil"\r\nBcc: x' })).not.toMatch(/[\r\n"]/);
  });
  it("parses addresses with and without a display name", () => {
    expect(parseAddress("REBX <a@b.com>")).toEqual({ name: "REBX", email: "a@b.com" });
    expect(parseAddress("a@b.com")).toEqual({ name: null, email: "a@b.com" });
  });
});

describe("version diff", () => {
  it("marks added, removed and unchanged lines", () => {
    const d = diffLines("a\nb\nc", "a\nB\nc\nd");
    expect(d.filter((l) => l.type === "remove").map((l) => l.text)).toEqual(["b"]);
    expect(d.filter((l) => l.type === "add").map((l) => l.text)).toEqual(["B", "d"]);
    expect(d.filter((l) => l.type === "same").map((l) => l.text)).toEqual(["a", "c"]);
    expect(hasChanges(d)).toBe(true);
  });
  it("reports no changes for identical text", () => {
    expect(hasChanges(diffLines("x\ny", "x\ny"))).toBe(false);
  });
});
