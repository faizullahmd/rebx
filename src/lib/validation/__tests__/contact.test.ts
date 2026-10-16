import { describe, expect, it } from "vitest";
import { isValidPhone } from "@/lib/validation/contact";
import { CustomerInquirySchema, InquiryFormSchema, ManualDealSchema } from "@/lib/validation/deal";

const base = { contactName: "Markos", contactEmail: "markos@example.com", contactPhone: "", message: "hi" };
const errorsOf = (input: Record<string, unknown>) => {
  const r = InquiryFormSchema.safeParse(input);
  return r.success ? {} : r.error.flatten().fieldErrors;
};

describe("phone numbers", () => {
  it.each(["+91 98765 43210", "9876543210", "(555) 010-1234", "+1-555-010-1234", "555.010.1234", "1234567"])("accepts %s", (v) => {
    expect(isValidPhone(v)).toBe(true);
  });
  it.each(["987876676332323322222", "12345", "abc", "98765abc43", "++9198765432", "555-CALL-NOW", "1234567890123456", "98765 <b>"])("rejects %s", (v) => {
    expect(isValidPhone(v)).toBe(false);
  });
});

describe("inquiry form validation", () => {
  it("accepts a valid inquiry, with the phone left empty or filled in", () => {
    expect(errorsOf(base)).toEqual({});
    expect(errorsOf({ ...base, contactPhone: "+91 98765 43210" })).toEqual({});
    expect(InquiryFormSchema.safeParse({ ...base, contactPhone: undefined }).success).toBe(true);
  });

  it("rejects the over-long number from the report", () => {
    expect(errorsOf({ ...base, contactPhone: "987876676332323322222" }).contactPhone).toEqual([expect.stringMatching(/valid phone/)]);
  });

  it.each(["markos@martecz", "markos", "@example.com", "markos@.com", "mark os@example.com", "markos@example.c", "a@b@example.com"])("rejects email %s", (email) => {
    expect(errorsOf({ ...base, contactEmail: email }).contactEmail).toEqual([expect.stringMatching(/valid email/)]);
  });

  it("accepts normal and plus-addressed emails and trims whitespace", () => {
    for (const e of ["markos@example.com", "m.k+tag@mail.example.co.uk", "  markos@example.com  "]) {
      expect(errorsOf({ ...base, contactEmail: e })).toEqual({});
    }
  });

  it("still requires a name", () => {
    expect(errorsOf({ ...base, contactName: "M" }).contactName).toBeDefined();
  });

  it("applies the same phone rule for logged-in customers and agent-entered deals", () => {
    expect(CustomerInquirySchema.safeParse({ contactPhone: "98765" }).success).toBe(false);
    expect(CustomerInquirySchema.safeParse({ contactPhone: "" }).success).toBe(true);
    expect(ManualDealSchema.safeParse({ ...base, listingId: "3", contactPhone: "98765" }).success).toBe(false);
    expect(ManualDealSchema.safeParse({ ...base, listingId: "3", contactEmail: "x@y" }).success).toBe(false);
    expect(ManualDealSchema.safeParse({ ...base, listingId: "3" }).success).toBe(true);
  });
});
