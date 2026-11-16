import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

let sessionUserId: number | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => (sessionUserId ? { user: { id: String(sessionUserId), role: "CUSTOMER" } } : null)),
}));

import { POST as addShortlist } from "@/app/api/shortlist/route";
import { POST as mergeShortlist } from "@/app/api/shortlist/merge/route";
import { PATCH as saveNote } from "@/app/api/shortlist/[listingId]/route";
import { getShortlistForCustomer } from "@/lib/data/shortlist";

const AGENT_ID = 930001;
const CUSTOMER_ID = 930002;
const ACTIVE_ID = 930011;
const DRAFT_ID = 930012;

function jsonRequest(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function listing(id: number, status: "ACTIVE" | "DRAFT") {
  return {
    id,
    title: status === "DRAFT" ? "Secret Draft Villa" : "Public Villa",
    slug: `shortlist-test-${id}`,
    description: "d",
    addressLine: "1 Test Road",
    city: "Mumbai",
    state: "Maharashtra",
    country: "India",
    postalCode: "400001",
    agentId: AGENT_ID,
    status,
  };
}

async function cleanup() {
  await prisma.shortlist.deleteMany({ where: { customerId: CUSTOMER_ID } });
  await prisma.listing.deleteMany({ where: { id: { in: [ACTIVE_ID, DRAFT_ID] } } });
  await prisma.user.deleteMany({ where: { id: { in: [AGENT_ID, CUSTOMER_ID] } } });
}

describe("shortlist", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.create({
      data: { id: AGENT_ID, name: "Agent", email: "shortlist-agent@example.com", role: "AGENT", passwordHash: "x" },
    });
    await prisma.user.create({
      data: { id: CUSTOMER_ID, name: "Customer", email: "shortlist-customer@example.com", role: "CUSTOMER", passwordHash: "x" },
    });
    await prisma.listing.create({ data: listing(ACTIVE_ID, "ACTIVE") });
    await prisma.listing.create({ data: listing(DRAFT_ID, "DRAFT") });
  });

  beforeEach(async () => {
    sessionUserId = CUSTOMER_ID;
    await prisma.shortlist.deleteMany({ where: { customerId: CUSTOMER_ID } });
  });

  afterAll(cleanup);

  it("rejects anonymous requests", async () => {
    sessionUserId = null;
    const res = await addShortlist(jsonRequest("/api/shortlist", { listingId: ACTIVE_ID }));
    expect(res.status).toBe(401);
  });

  it("adds a public listing idempotently", async () => {
    expect((await addShortlist(jsonRequest("/api/shortlist", { listingId: ACTIVE_ID }))).status).toBe(201);
    expect((await addShortlist(jsonRequest("/api/shortlist", { listingId: ACTIVE_ID }))).status).toBe(201);
    expect(await prisma.shortlist.count({ where: { customerId: CUSTOMER_ID } })).toBe(1);
  });

  it("does not let a draft listing be shortlisted by id", async () => {
    const res = await addShortlist(jsonRequest("/api/shortlist", { listingId: DRAFT_ID }));
    expect(res.status).toBe(404);
    expect(await prisma.shortlist.count({ where: { customerId: CUSTOMER_ID } })).toBe(0);
  });

  it("merge keeps only public listings", async () => {
    const res = await mergeShortlist(
      jsonRequest("/api/shortlist/merge", { listingIds: [ACTIVE_ID, DRAFT_ID, 999999999] })
    );
    expect(res.status).toBe(200);
    const rows = await prisma.shortlist.findMany({ where: { customerId: CUSTOMER_ID } });
    expect(rows.map((r) => r.listingId)).toEqual([ACTIVE_ID]);
  });

  it("hides the details of a listing that went back to draft", async () => {
    await prisma.shortlist.create({ data: { customerId: CUSTOMER_ID, listingId: DRAFT_ID } });
    const items = await getShortlistForCustomer(CUSTOMER_ID);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Property unavailable");
    expect(items[0].agent).toBeNull();
    expect(items[0].status).toBe("Unavailable");
  });

  describe("private notes", () => {
    const patch = (listingId: number, body: unknown) =>
      saveNote(
        new Request(`http://localhost/api/shortlist/${listingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ listingId: String(listingId) }) }
      );

    it("saves and clears a note on a shortlisted listing", async () => {
      await prisma.shortlist.create({ data: { customerId: CUSTOMER_ID, listingId: ACTIVE_ID } });
      expect((await patch(ACTIVE_ID, { notes: "  near metro  " })).status).toBe(200);
      expect((await getShortlistForCustomer(CUSTOMER_ID))[0].notes).toBe("near metro");
      expect((await patch(ACTIVE_ID, { notes: "" })).status).toBe(200);
      expect((await getShortlistForCustomer(CUSTOMER_ID))[0].notes).toBeNull();
    });

    it("never creates a shortlist entry (so drafts stay unreachable)", async () => {
      expect((await patch(DRAFT_ID, { notes: "sneaky" })).status).toBe(404);
      expect((await patch(ACTIVE_ID, { notes: "not shortlisted" })).status).toBe(404);
      expect(await prisma.shortlist.count({ where: { customerId: CUSTOMER_ID } })).toBe(0);
    });

    it("rejects oversized or non-text notes", async () => {
      await prisma.shortlist.create({ data: { customerId: CUSTOMER_ID, listingId: ACTIVE_ID } });
      expect((await patch(ACTIVE_ID, { notes: "x".repeat(2001) })).status).toBe(400);
      expect((await patch(ACTIVE_ID, { notes: { a: 1 } })).status).toBe(400);
    });

    it("cannot touch another customer's note", async () => {
      await prisma.shortlist.create({ data: { customerId: CUSTOMER_ID, listingId: ACTIVE_ID, notes: "mine" } });
      const OTHER_ID = 930003;
      await prisma.user.create({
        data: { id: OTHER_ID, name: "Other", email: "shortlist-other@example.com", role: "CUSTOMER", passwordHash: "x" },
      });
      try {
        sessionUserId = OTHER_ID;
        expect((await patch(ACTIVE_ID, { notes: "hijack" })).status).toBe(404);
        const row = await prisma.shortlist.findFirst({ where: { customerId: CUSTOMER_ID } });
        expect(row?.notes).toBe("mine");
      } finally {
        await prisma.user.delete({ where: { id: OTHER_ID } });
      }
    });
  });
});
