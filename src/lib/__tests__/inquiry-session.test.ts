import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

import { forgetInquirer, readInquirySession, rememberInquiry } from "@/lib/inquiry-session";

const encode = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64url");

beforeEach(() => jar.clear());

describe("inquiry session cookie", () => {
  it("is empty for a visitor who hasn't sent an inquiry", async () => {
    expect(await readInquirySession()).toEqual({ listings: [] });
  });

  it("remembers who they are and which properties they've contacted", async () => {
    await rememberInquiry({ name: "Markos Test", email: "m@example.com", phone: "+91 98765 43210" }, 2);
    await rememberInquiry({}, 5);
    await rememberInquiry({}, 5); // contacting the same property twice records it once
    expect(await readInquirySession()).toEqual({ name: "Markos Test", email: "m@example.com", phone: "+91 98765 43210", listings: [2, 5] });
  });

  it("forgets the details but keeps the list of contacted properties", async () => {
    await rememberInquiry({ name: "Markos Test", email: "m@example.com" }, 2);
    await forgetInquirer();
    expect(await readInquirySession()).toEqual({ listings: [2] });
  });

  it("ignores a tampered or malformed cookie instead of trusting it", async () => {
    for (const raw of ["not-base64-json", encode({ listings: "x" }), encode({ email: "not-an-email", listings: [] }), encode({ listings: [-1] }), encode({ name: "A", listings: [] })]) {
      jar.set("rebx_inquiry", raw);
      expect(await readInquirySession()).toEqual({ listings: [] });
    }
  });
});
