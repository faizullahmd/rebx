import { PrismaClient, DealOfferStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting deal messages backfill migration...");

  const deals = await prisma.deal.findMany({
    include: {
      listing: { select: { currency: true } },
      messages: { select: { id: true, type: true } },
    },
  });

  let offersCreated = 0;
  let notesCreated = 0;

  for (const deal of deals) {
    const hasOfferMessage = deal.messages.some((m) => m.type === "OFFER");
    const hasNoteMessage = deal.messages.some((m) => m.type === "NOTE");

    // 1. Backfill starting offer message if deal has an offerAmount and no OFFER message yet
    if (deal.offerAmount && !hasOfferMessage) {
      let offerStatus: DealOfferStatus = "PENDING";
      if (deal.stage === "UNDER_CONTRACT" || deal.stage === "CLOSED_WON") {
        offerStatus = "ACCEPTED";
      } else if (deal.stage === "CLOSED_LOST") {
        offerStatus = "REJECTED";
      }

      await prisma.dealMessage.create({
        data: {
          dealId: deal.id,
          senderRole: "CUSTOMER",
          senderId: deal.customerId ?? null,
          type: "OFFER",
          text: `Initial offer submitted: ${deal.offerAmount}`,
          amount: deal.offerAmount,
          currency: deal.listing?.currency || "INR",
          offerStatus,
          createdAt: deal.createdAt,
          agentReadAt: deal.createdAt,
          customerReadAt: deal.createdAt,
        },
      });
      offersCreated++;
    }

    // 2. Backfill private note message if deal has notes and no NOTE message yet
    if (deal.notes && deal.notes.trim() && !hasNoteMessage) {
      await prisma.dealMessage.create({
        data: {
          dealId: deal.id,
          senderRole: "AGENT",
          senderId: deal.agentId,
          type: "NOTE",
          text: deal.notes.trim(),
          createdAt: deal.createdAt,
          agentReadAt: deal.createdAt,
        },
      });
      notesCreated++;
    }
  }

  console.log(
    `Migration complete: ${offersCreated} starting offers created, ${notesCreated} private notes created.`
  );
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
