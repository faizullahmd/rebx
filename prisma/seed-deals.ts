import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { nextUserId } from "../src/lib/user-id";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run test seed in production environment!");
  process.exit(1);
}

const prisma = new PrismaClient();
const SEED_PASSWORD = "password123";

async function upsertCustomer(email: string, name: string, username: string, passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const id = await nextUserId(tx, "CUSTOMER");
    return tx.user.create({
      data: {
        id,
        email,
        name,
        username,
        role: "CUSTOMER",
        passwordHash,
        customerProfile: {
          create: {
            phone: "+1 (512) 555-0" + Math.floor(100 + Math.random() * 900),
          },
        },
      },
    });
  });
}

async function main() {
  console.log("Seeding test negotiation deals...");

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // 1. Get or create agent (prefer agent1@rebx.dev or any AGENT)
  let agent = await prisma.user.findUnique({
    where: { email: "agent1@rebx.dev" },
  });

  if (!agent) {
    agent = await prisma.user.findFirst({
      where: { role: "AGENT" },
    });
  }

  if (!agent) {
    console.log("No agent found. Creating demo agent...");
    agent = await prisma.$transaction(async (tx) => {
      const id = await nextUserId(tx, "AGENT");
      return tx.user.create({
        data: {
          id,
          email: "agent1@rebx.dev",
          name: "Alex Agent",
          username: "alex-agent-test",
          role: "AGENT",
          passwordHash,
          agentProfile: {
            create: {
              agencyName: "Skyline Realty",
              phone: "+1 (512) 555-0143",
            },
          },
        },
      });
    });
  }

  // 2. Find listings
  const listings = await prisma.listing.findMany({
    take: 3,
    orderBy: { id: "asc" },
  });

  if (listings.length === 0) {
    console.error("No listings found in database. Run `npm run db:seed` first.");
    process.exit(1);
  }

  const listingA = listings[0];
  const listingB = listings[1] || listings[0];
  const listingC = listings[2] || listings[0];

  // 3. Upsert 3 Test Customers
  const customerA = await upsertCustomer(
    "test.customer1@example.com",
    "Alex Taylor",
    "alex-taylor-test",
    passwordHash
  );

  const customerB = await upsertCustomer(
    "test.customer2@example.com",
    "Jordan Smith",
    "jordan-smith-test",
    passwordHash
  );

  const customerC = await upsertCustomer(
    "test.customer3@example.com",
    "Morgan Lee",
    "morgan-lee-test",
    passwordHash
  );

  // ---------------------------------------------------------------------------
  // DEAL A: Stage OFFER_MADE (Customer submitted offer, awaiting agent review)
  // ---------------------------------------------------------------------------
  let dealA = await prisma.deal.findFirst({
    where: { contactEmail: customerA.email, listingId: listingA.id },
  });

  if (!dealA) {
    dealA = await prisma.deal.create({
      data: {
        stage: "OFFER_MADE",
        listingId: listingA.id,
        agentId: agent.id,
        customerId: customerA.id,
        contactName: customerA.name,
        contactEmail: customerA.email,
        contactPhone: "+1 (512) 555-0111",
        offerAmount: 650000,
        notes: "Buyer seems well-qualified. Pre-approval letter checked.",
      },
    });
  } else {
    dealA = await prisma.deal.update({
      where: { id: dealA.id },
      data: {
        stage: "OFFER_MADE",
        offerAmount: 650000,
      },
    });
  }

  // Idempotently ensure Deal A messages
  await prisma.dealMessage.deleteMany({ where: { dealId: dealA.id } });
  await prisma.dealMessage.createMany({
    data: [
      {
        dealId: dealA.id,
        senderRole: "CUSTOMER",
        senderId: customerA.id,
        type: "MESSAGE",
        text: "Hi, I viewed this property online and I am very interested. Can we discuss a cash purchase with quick closing?",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 5),
      },
      {
        dealId: dealA.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "MESSAGE",
        text: "Hello Alex! Yes, the seller is open to a fast turnaround. What price did you have in mind?",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 3),
      },
      {
        dealId: dealA.id,
        senderRole: "CUSTOMER",
        senderId: customerA.id,
        type: "OFFER",
        amount: 650000,
        currency: listingA.currency || "INR",
        offerStatus: "PENDING",
        text: "Submitting formal offer of ₹6,50,000 for seller review. Pre-approval attached.",
        agentReadAt: null,
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 1),
      },
      {
        dealId: dealA.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "NOTE",
        text: "Internal note: Buyer has verified funds with Chase. Seller floor price is 640k, so this is workable.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 1800000),
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // DEAL B: Stage NEGOTIATION (Agent sent counter-offer with 48h expiry, pending)
  // ---------------------------------------------------------------------------
  let dealB = await prisma.deal.findFirst({
    where: { contactEmail: customerB.email, listingId: listingB.id },
  });

  if (!dealB) {
    dealB = await prisma.deal.create({
      data: {
        stage: "NEGOTIATION",
        listingId: listingB.id,
        agentId: agent.id,
        customerId: customerB.id,
        contactName: customerB.name,
        contactEmail: customerB.email,
        contactPhone: "+1 (512) 555-0222",
        offerAmount: 720000,
        notes: "Negotiating counter offer with 48-hour window.",
      },
    });
  } else {
    dealB = await prisma.deal.update({
      where: { id: dealB.id },
      data: {
        stage: "NEGOTIATION",
        offerAmount: 720000,
      },
    });
  }

  await prisma.dealMessage.deleteMany({ where: { dealId: dealB.id } });
  await prisma.dealMessage.createMany({
    data: [
      {
        dealId: dealB.id,
        senderRole: "CUSTOMER",
        senderId: customerB.id,
        type: "MESSAGE",
        text: "Hello, we loved the architectural layout during the open house. Ready to move quickly.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 24),
      },
      {
        dealId: dealB.id,
        senderRole: "CUSTOMER",
        senderId: customerB.id,
        type: "OFFER",
        amount: 700000,
        currency: listingB.currency || "INR",
        offerStatus: "COUNTERED",
        text: "Initial offer: ₹7,00,000 subject to standard inspection.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 20),
      },
      {
        dealId: dealB.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "MESSAGE",
        text: "Thank you Jordan. The seller appreciates the strong interest, but ₹7,00,000 is slightly below expectation given recent neighborhood comps.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 12),
      },
      {
        dealId: dealB.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "OFFER",
        amount: 720000,
        currency: listingB.currency || "INR",
        offerStatus: "PENDING",
        expiresAt: new Date(Date.now() + 48 * 3600000), // 48 hours in future
        text: "Official counter-offer: ₹7,20,000 with closing within 30 days and including all modular kitchen fixtures.",
        agentReadAt: new Date(),
        customerReadAt: null,
        createdAt: new Date(Date.now() - 3600000 * 2),
      },
    ],
  });

  // ---------------------------------------------------------------------------
  // DEAL C: Stage UNDER_CONTRACT (Offer accepted, booking confirmed)
  // ---------------------------------------------------------------------------
  let dealC = await prisma.deal.findFirst({
    where: { contactEmail: customerC.email, listingId: listingC.id },
  });

  if (!dealC) {
    dealC = await prisma.deal.create({
      data: {
        stage: "UNDER_CONTRACT",
        listingId: listingC.id,
        agentId: agent.id,
        customerId: customerC.id,
        contactName: customerC.name,
        contactEmail: customerC.email,
        contactPhone: "+1 (512) 555-0333",
        offerAmount: 850000,
        notes: "Offer accepted. Token deposit in escrow.",
      },
    });
  } else {
    dealC = await prisma.deal.update({
      where: { id: dealC.id },
      data: {
        stage: "UNDER_CONTRACT",
        offerAmount: 850000,
      },
    });
  }

  await prisma.dealMessage.deleteMany({ where: { dealId: dealC.id } });
  await prisma.dealMessage.createMany({
    data: [
      {
        dealId: dealC.id,
        senderRole: "CUSTOMER",
        senderId: customerC.id,
        type: "MESSAGE",
        text: "Good afternoon, we would like to present our best and final offer on this property.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 48),
      },
      {
        dealId: dealC.id,
        senderRole: "CUSTOMER",
        senderId: customerC.id,
        type: "OFFER",
        amount: 850000,
        currency: listingC.currency || "INR",
        offerStatus: "ACCEPTED",
        text: "Final offer of ₹8,50,000 with 10% immediate deposit.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 36),
      },
      {
        dealId: dealC.id,
        senderRole: "AGENT",
        senderId: agent.id,
        type: "MESSAGE",
        text: "Great news Morgan! The seller has officially accepted your offer. We are processing the booking paperwork.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 24),
      },
      {
        dealId: dealC.id,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: "Offer of ₹8,50,000 was accepted. Deal stage updated to Under Contract.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 24),
      },
    ],
  });

  // Upsert confirmed booking on Deal C (No advance recorded)
  const bookingC = await prisma.booking.upsert({
    where: { dealId: dealC.id },
    update: {
      status: "CONFIRMED",
      saleAmount: 850000,
      unitNumber: "Unit 402",
      notes: "Token deposit received into escrow. Agreement drafting underway.",
    },
    create: {
      dealId: dealC.id,
      status: "CONFIRMED",
      saleAmount: 850000,
      unitNumber: "Unit 402",
      bookingDate: new Date(),
      confirmedAt: new Date(),
      notes: "Token deposit received into escrow. Agreement drafting underway.",
    },
  });
  await prisma.bookingAdvance.deleteMany({ where: { bookingId: bookingC.id } });

  // ---------------------------------------------------------------------------
  // DEAL D: Stage UNDER_CONTRACT (Offer accepted, with PENDING advance at 10%)
  // ---------------------------------------------------------------------------
  const customerD = await upsertCustomer(
    "test.customer4@example.com",
    "Devon Vance",
    "devon-vance-test",
    passwordHash
  );

  let dealD = await prisma.deal.findFirst({
    where: { contactEmail: customerD.email, listingId: listingB.id },
  });

  if (!dealD) {
    dealD = await prisma.deal.create({
      data: {
        stage: "UNDER_CONTRACT",
        listingId: listingB.id,
        agentId: agent.id,
        customerId: customerD.id,
        contactName: customerD.name,
        contactEmail: customerD.email,
        contactPhone: "+1 (512) 555-0444",
        offerAmount: 950000,
        notes: "Offer agreed with 10% token advance requested.",
      },
    });
  } else {
    dealD = await prisma.deal.update({
      where: { id: dealD.id },
      data: {
        stage: "UNDER_CONTRACT",
        offerAmount: 950000,
      },
    });
  }

  await prisma.dealMessage.deleteMany({ where: { dealId: dealD.id } });
  await prisma.dealMessage.createMany({
    data: [
      {
        dealId: dealD.id,
        senderRole: "CUSTOMER",
        senderId: customerD.id,
        type: "OFFER",
        amount: 950000,
        currency: listingB.currency || "INR",
        offerStatus: "ACCEPTED",
        text: "Offer of ₹9,50,000 for the property.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 30),
      },
      {
        dealId: dealD.id,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: "Offer accepted: ₹9,50,000. Stage changed to Under contract",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 28),
      },
    ],
  });

  const bookingD = await prisma.booking.upsert({
    where: { dealId: dealD.id },
    update: {
      status: "CONFIRMED",
      saleAmount: 950000,
      unitNumber: "Unit 301",
      notes: "Awaiting token advance deposit.",
    },
    create: {
      dealId: dealD.id,
      status: "CONFIRMED",
      saleAmount: 950000,
      unitNumber: "Unit 301",
      bookingDate: new Date(),
      confirmedAt: new Date(),
      notes: "Awaiting token advance deposit.",
    },
  });

  const advanceD = await prisma.bookingAdvance.upsert({
    where: { bookingId: bookingD.id },
    update: {
      dealId: dealD.id,
      amount: 95000,
      percentUsed: 10.0,
      currency: listingB.currency || "INR",
      status: "PENDING",
      paidAt: null,
      notes: "10% token advance requested via bank transfer.",
      markedPaidBy: null,
    },
    create: {
      bookingId: bookingD.id,
      dealId: dealD.id,
      amount: 95000,
      percentUsed: 10.0,
      currency: listingB.currency || "INR",
      status: "PENDING",
      notes: "10% token advance requested via bank transfer.",
    },
  });

  await prisma.bookingAdvanceHistory.deleteMany({ where: { advanceId: advanceD.id } });
  await prisma.bookingAdvanceHistory.create({
    data: {
      advanceId: advanceD.id,
      action: "CREATED",
      oldValue: null,
      newValue: JSON.stringify({ amount: 95000, percentUsed: 10, status: "PENDING" }),
      reason: "Initial 10% advance record",
      actorId: agent.id,
    },
  });

  // ---------------------------------------------------------------------------
  // DEAL E: Stage CLOSED_WON (Deal won with a PAID advance a few days ago)
  // ---------------------------------------------------------------------------
  const customerE = await upsertCustomer(
    "test.customer5@example.com",
    "Elena Rostova",
    "elena-rostova-test",
    passwordHash
  );

  let dealE = await prisma.deal.findFirst({
    where: { contactEmail: customerE.email, listingId: listingC.id },
  });

  if (!dealE) {
    dealE = await prisma.deal.create({
      data: {
        stage: "CLOSED_WON",
        listingId: listingC.id,
        agentId: agent.id,
        customerId: customerE.id,
        contactName: customerE.name,
        contactEmail: customerE.email,
        contactPhone: "+1 (512) 555-0555",
        offerAmount: 1200000,
        closedAt: new Date(Date.now() - 3600000 * 48),
        notes: "Deal successfully closed won. Advance cleared and final settlement complete.",
      },
    });
  } else {
    dealE = await prisma.deal.update({
      where: { id: dealE.id },
      data: {
        stage: "CLOSED_WON",
        offerAmount: 1200000,
        closedAt: new Date(Date.now() - 3600000 * 48),
      },
    });
  }

  await prisma.dealMessage.deleteMany({ where: { dealId: dealE.id } });
  await prisma.dealMessage.createMany({
    data: [
      {
        dealId: dealE.id,
        senderRole: "CUSTOMER",
        senderId: customerE.id,
        type: "OFFER",
        amount: 1200000,
        currency: listingC.currency || "INR",
        offerStatus: "ACCEPTED",
        text: "Final offer agreed at ₹12,00,000.",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 96),
      },
      {
        dealId: dealE.id,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: "Offer accepted: ₹12,00,000. Stage changed to Under contract",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 90),
      },
      {
        dealId: dealE.id,
        senderRole: "SYSTEM",
        type: "EVENT",
        text: "Advance of ₹1,20,000 marked as paid",
        agentReadAt: new Date(),
        customerReadAt: new Date(),
        createdAt: new Date(Date.now() - 3600000 * 72),
      },
    ],
  });

  const bookingE = await prisma.booking.upsert({
    where: { dealId: dealE.id },
    update: {
      status: "CONFIRMED",
      saleAmount: 1200000,
      unitNumber: "Penthouse 1",
      bookingDate: new Date(Date.now() - 3600000 * 90),
      confirmedAt: new Date(Date.now() - 3600000 * 85),
      notes: "Full advance received. Registration done.",
    },
    create: {
      dealId: dealE.id,
      status: "CONFIRMED",
      saleAmount: 1200000,
      unitNumber: "Penthouse 1",
      bookingDate: new Date(Date.now() - 3600000 * 90),
      confirmedAt: new Date(Date.now() - 3600000 * 85),
      notes: "Full advance received. Registration done.",
    },
  });

  const advancePaidDate = new Date(Date.now() - 3 * 86400000); // 3 days ago

  const advanceE = await prisma.bookingAdvance.upsert({
    where: { bookingId: bookingE.id },
    update: {
      dealId: dealE.id,
      amount: 120000,
      percentUsed: 10.0,
      currency: listingC.currency || "INR",
      status: "PAID",
      paidAt: advancePaidDate,
      notes: "10% advance verified in escrow.",
      markedPaidBy: agent.id,
    },
    create: {
      bookingId: bookingE.id,
      dealId: dealE.id,
      amount: 120000,
      percentUsed: 10.0,
      currency: listingC.currency || "INR",
      status: "PAID",
      paidAt: advancePaidDate,
      notes: "10% advance verified in escrow.",
      markedPaidBy: agent.id,
    },
  });

  await prisma.bookingAdvanceHistory.deleteMany({ where: { advanceId: advanceE.id } });
  await prisma.bookingAdvanceHistory.createMany({
    data: [
      {
        advanceId: advanceE.id,
        action: "CREATED",
        oldValue: null,
        newValue: JSON.stringify({ amount: 120000, percentUsed: 10, status: "PENDING" }),
        reason: "Initial advance record",
        actorId: agent.id,
        createdAt: new Date(Date.now() - 4 * 86400000),
      },
      {
        advanceId: advanceE.id,
        action: "MARKED_PAID",
        oldValue: JSON.stringify({ status: "PENDING" }),
        newValue: JSON.stringify({ status: "PAID", paidAt: advancePaidDate.toISOString() }),
        reason: "Cheque cleared",
        actorId: agent.id,
        createdAt: advancePaidDate,
      },
    ],
  });

  console.log("\n Negotiation test seed completed successfully!");
  console.log("------------------------------------------------------------------");
  console.log(`Agent:      ${agent.email} / ${SEED_PASSWORD}`);
  console.log(`Deal A:     ID #${dealA.id} [OFFER_MADE]     Customer: ${customerA.email} / ${SEED_PASSWORD}`);
  console.log(`Deal B:     ID #${dealB.id} [NEGOTIATION]    Customer: ${customerB.email} / ${SEED_PASSWORD}`);
  console.log(`Deal C:     ID #${dealC.id} [UNDER_CONTRACT] Customer: ${customerC.email} / ${SEED_PASSWORD}`);
  console.log(`Deal D:     ID #${dealD.id} [UNDER_CONTRACT] (Pending 10% Advance) Customer: ${customerD.email}`);
  console.log(`Deal E:     ID #${dealE.id} [CLOSED_WON]     (Paid Advance)        Customer: ${customerE.email}`);
  console.log("------------------------------------------------------------------");
}

main()
  .catch((error) => {
    console.error("Error running test seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
