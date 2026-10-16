import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { emailAddress, optionalPhone } from "@/lib/validation/contact";

// Remembers, for the length of the browser session, that a visitor has already sent an inquiry:
// who they are (so a one-click "I'm Interested" can reuse their details) and which properties
// they have already contacted. It is a session cookie (no expiry, gone when the browser closes),
// httpOnly and never used to identify or authenticate anyone, only to save re-typing.

const COOKIE = "rebx_inquiry";
const MAX_LISTINGS = 50;

const SessionSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: emailAddress.optional(),
  phone: optionalPhone,
  listings: z.array(z.number().int().positive()).max(MAX_LISTINGS),
});

export type InquirySession = z.infer<typeof SessionSchema>;

const EMPTY: InquirySession = { listings: [] };

export async function readInquirySession(): Promise<InquirySession> {
  try {
    const raw = (await cookies()).get(COOKIE)?.value;
    if (!raw) return EMPTY;
    const parsed = SessionSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Merges new details and marks a listing as contacted. Only callable from a server action. */
export async function rememberInquiry(
  update: { name?: string; email?: string; phone?: string | null },
  listingId: number
) {
  const current = await readInquirySession();
  const next: InquirySession = {
    name: update.name ?? current.name,
    email: update.email ?? current.email,
    phone: update.phone === undefined ? current.phone : update.phone || undefined,
    listings: [...new Set([...current.listings, listingId])].slice(-MAX_LISTINGS),
  };
  const store = await cookies();
  store.set(COOKIE, Buffer.from(JSON.stringify(next), "utf8").toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

/** "Not you?": forgets the saved details but keeps the record of properties already contacted. */
export async function forgetInquirer() {
  const current = await readInquirySession();
  const store = await cookies();
  store.set(COOKIE, Buffer.from(JSON.stringify({ listings: current.listings }), "utf8").toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
