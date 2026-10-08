// Removes the demo data created by prisma/seed.ts (the *@rebx.dev accounts and everything
// they own). Dry run by default; pass --apply to actually delete.
//
//   DATABASE_URL="mysql://..." npx tsx prisma/cleanup-demo-data.ts          # preview
//   DATABASE_URL="mysql://..." npx tsx prisma/cleanup-demo-data.ts --apply  # delete
import { PrismaClient } from "@prisma/client";

const DEMO_EMAILS = [
  "admin@rebx.dev",
  "agent1@rebx.dev",
  "agent2@rebx.dev",
  "developer@rebx.dev",
  "customer1@rebx.dev",
  "customer2@rebx.dev",
];

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "mysql://unset").host;
  console.log(`Target database host: ${host}`);
  console.log(apply ? "MODE: APPLY (will delete)\n" : "MODE: dry run (nothing will be deleted)\n");

  const users = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true, email: true, role: true },
  });
  if (users.length === 0) {
    console.log("No demo users found. Nothing to do.");
    return;
  }
  const ids = users.map((u) => u.id);
  console.log("Demo users:", users.map((u) => `${u.email} (#${u.id})`).join(", "));

  const dealWhere = { OR: [{ agentId: { in: ids } }, { listing: { agentId: { in: ids } } }] };
  const listingWhere = { agentId: { in: ids } };

  const [listings, deals, commissions, devRequests, reviews, videos] = await Promise.all([
    prisma.listing.count({ where: listingWhere }),
    prisma.deal.count({ where: dealWhere }),
    prisma.commission.count({
      where: { OR: [{ agentId: { in: ids } }, { deal: dealWhere }] },
    }),
    prisma.developerRequest.count({
      where: { OR: [{ requestedById: { in: ids } }, { listing: listingWhere }] },
    }),
    prisma.review.count({ where: { OR: [{ agentId: { in: ids } }, { listing: listingWhere }] } }),
    prisma.video.count({ where: { createdById: { in: ids } } }),
  ]);

  // Deals on demo listings that belong to real (non-demo) agents or customers would be
  // cascade-deleted with the listing; surface them so that is never a surprise.
  const foreignDeals = await prisma.deal.count({
    where: { listing: listingWhere, agentId: { notIn: ids } },
  });

  console.log(
    `Will delete: ${users.length} users, ${listings} listings, ${deals} deals, ` +
      `${commissions} commissions, ${devRequests} developer requests, ${reviews} reviews, ${videos} videos ` +
      `(plus their bookings, images and listing videos via cascade).`
  );
  if (foreignDeals > 0) {
    console.log(`WARNING: ${foreignDeals} deal(s) from non-demo agents sit on demo listings and would be deleted too.`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to delete.");
    return;
  }
  if (foreignDeals > 0 && !process.argv.includes("--force")) {
    console.log("\nRefusing to apply because of the warning above. Re-run with --apply --force to proceed.");
    process.exitCode = 1;
    return;
  }

  // Order matters: Deal/Commission/DeveloperRequest/Listing reference User with ON DELETE RESTRICT.
  await prisma.$transaction(async (tx) => {
    await tx.commission.deleteMany({ where: { OR: [{ agentId: { in: ids } }, { deal: dealWhere }] } });
    await tx.deal.deleteMany({ where: dealWhere });
    await tx.developerRequest.deleteMany({
      where: { OR: [{ requestedById: { in: ids } }, { listing: listingWhere }] },
    });
    await tx.listing.deleteMany({ where: listingWhere });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });

  const left = await prisma.user.count({ where: { email: { in: DEMO_EMAILS } } });
  console.log(`\nDone. Demo users remaining: ${left}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
