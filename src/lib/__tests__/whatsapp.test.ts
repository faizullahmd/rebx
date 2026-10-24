import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanTemplateParam, isWhatsAppConfigured, normalizeWhatsAppNumber, notifyAgentNewLead, sendWhatsAppTemplate } from "@/lib/whatsapp";

const ENV = { WHATSAPP_ACCESS_TOKEN: "test-token-123", WHATSAPP_PHONE_NUMBER_ID: "111222333" };
const original = { ...process.env };

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const call = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) };
};

beforeEach(() => {
  Object.assign(process.env, ENV);
  delete process.env.WHATSAPP_DEFAULT_COUNTRY_CODE;
  delete process.env.WHATSAPP_API_VERSION;
  delete process.env.WHATSAPP_TEMPLATE_NEW_LEAD;
  delete process.env.WHATSAPP_TEMPLATE_LANGUAGE;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeWhatsAppNumber", () => {
  it.each([
    ["+91 98765 43210", "919876543210"],
    ["+91-98765-43210", "919876543210"],
    ["9876543210", "919876543210"],
    ["098765 43210", "919876543210"],
    ["0091 98765 43210", "919876543210"],
    ["+1 (711) 766-7549", "17117667549"],
    ["919876543210", "919876543210"],
  ])("%s -> %s", (input, expected) => expect(normalizeWhatsAppNumber(input)).toBe(expected));

  it.each([null, undefined, "", "abc", "12345", "+12", "98765abc43", "++919876543210", "+1234567890123456"])("rejects %s", (v) => {
    expect(normalizeWhatsAppNumber(v as string | null)).toBeNull();
  });

  it("uses the configured default country code", () => {
    process.env.WHATSAPP_DEFAULT_COUNTRY_CODE = "44";
    expect(normalizeWhatsAppNumber("7911 123456")).toBe("447911123456");
  });
});

describe("cleanTemplateParam", () => {
  it("removes line breaks, tabs and repeated spaces, and never returns an empty value", () => {
    expect(cleanTemplateParam("Hello\n\nWorld\t  again")).toBe("Hello World again");
    expect(cleanTemplateParam("   ")).toBe("-");
    expect(cleanTemplateParam(null)).toBe("-");
  });
  it("truncates long values", () => {
    const out = cleanTemplateParam("x".repeat(500), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("sendWhatsAppTemplate", () => {
  it("does nothing, without calling the network, when not configured", async () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    const fn = mockFetch(200, {});
    expect(isWhatsAppConfigured()).toBe(false);
    expect(await sendWhatsAppTemplate("919876543210", "t", ["a"])).toMatchObject({ ok: false, skipped: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("skips an invalid number without calling the network", async () => {
    const fn = mockFetch(200, {});
    expect(await sendWhatsAppTemplate("not a number", "t", [])).toMatchObject({ ok: false, skipped: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("posts the template to the Graph API with the bearer token and ordered body parameters", async () => {
    const fn = mockFetch(200, { messages: [{ id: "wamid.ABC" }] });
    const res = await sendWhatsAppTemplate("+91 98765 43210", "new_lead_alert", ["Lakeside Home", "Markos", "https://rebx.app/d/1"]);
    expect(res).toEqual({ ok: true, messageId: "wamid.ABC" });

    const { url, init, body } = call(fn);
    expect(url).toBe("https://graph.facebook.com/v25.0/111222333/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token-123");
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: {
        name: "new_lead_alert",
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [
          { type: "text", text: "Lakeside Home" },
          { type: "text", text: "Markos" },
          { type: "text", text: "https://rebx.app/d/1" },
        ] }],
      },
    });
  });

  it("returns Meta's error instead of throwing, and never logs the token", async () => {
    mockFetch(400, { error: { message: "Invalid parameter", code: 100, error_data: { details: "template name (x) does not exist in en_US" } } });
    const res = await sendWhatsAppTemplate("919876543210", "x", []);
    expect(res).toEqual({ ok: false, error: "template name (x) does not exist in en_US (code 100)" });
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain("test-token-123");
  });

  it("never throws on a network failure or timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("socket hang up"); }));
    expect(await sendWhatsAppTemplate("919876543210", "x", [])).toEqual({ ok: false, error: "socket hang up" });
  });

  it("honours the configured API version and template language", async () => {
    process.env.WHATSAPP_API_VERSION = "v30.0";
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = "en";
    const fn = mockFetch(200, { messages: [{ id: "wamid.X" }] });
    await sendWhatsAppTemplate("919876543210", "x", []);
    const { url, body } = call(fn);
    expect(url).toContain("/v30.0/");
    expect(body.template.language.code).toBe("en");
    expect(body.template.components).toBeUndefined();
  });
});

describe("notifyAgentNewLead", () => {
  const details = { listingTitle: "Lakeside\nFamily Home", contactName: "Markos", dealUrl: "https://rebx.app/agent/dashboard/deals/9" };

  it("sends only to agents who opted in and have a phone number", async () => {
    const fn = mockFetch(200, { messages: [{ id: "wamid.1" }] });
    expect(await notifyAgentNewLead({ phone: "98765 43210", whatsappOptIn: false }, details)).toMatchObject({ ok: false, skipped: true });
    expect(await notifyAgentNewLead(null, details)).toMatchObject({ ok: false, skipped: true });
    expect(await notifyAgentNewLead({ phone: null, whatsappOptIn: true }, details)).toMatchObject({ ok: false, skipped: true });
    expect(fn).not.toHaveBeenCalled();

    expect(await notifyAgentNewLead({ phone: "98765 43210", whatsappOptIn: true }, details)).toMatchObject({ ok: true });
    const { body } = call(fn);
    expect(body.to).toBe("919876543210");
    expect(body.template.name).toBe("new_lead_alert");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["Lakeside Family Home", "Markos", details.dealUrl]);
  });

  it("uses a custom template name when configured", async () => {
    process.env.WHATSAPP_TEMPLATE_NEW_LEAD = "lead_v2";
    const fn = mockFetch(200, { messages: [{ id: "wamid.2" }] });
    await notifyAgentNewLead({ phone: "9876543210", whatsappOptIn: true }, details);
    expect(call(fn).body.template.name).toBe("lead_v2");
  });
});
