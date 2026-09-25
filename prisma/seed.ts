import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SEED_PASSWORD = "password123";

function slugify(title: string, suffix: string) {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${suffix}`;
}

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@rebx.dev" },
    update: {},
    create: {
      name: "Ava Admin",
      email: "admin@rebx.dev",
      passwordHash,
      role: "ADMIN",
    },
  });

  const agent1 = await prisma.user.upsert({
    where: { email: "agent1@rebx.dev" },
    update: {},
    create: {
      name: "Alex Agent",
      email: "agent1@rebx.dev",
      passwordHash,
      role: "AGENT",
      agentProfile: { create: { agencyName: "Skyline Realty" } },
    },
  });

  const agent2 = await prisma.user.upsert({
    where: { email: "agent2@rebx.dev" },
    update: {},
    create: {
      name: "Bailey Broker",
      email: "agent2@rebx.dev",
      passwordHash,
      role: "AGENT",
      agentProfile: { create: { agencyName: "Harbor Homes" } },
    },
  });

  const developer = await prisma.user.upsert({
    where: { email: "developer@rebx.dev" },
    update: {},
    create: {
      name: "Devon Developer",
      email: "developer@rebx.dev",
      passwordHash,
      role: "DEVELOPER",
      developerProfile: { create: { companyName: "Northgate Developments" } },
    },
  });

  const customer1 = await prisma.user.upsert({
    where: { email: "customer1@rebx.dev" },
    update: {},
    create: {
      name: "Casey Customer",
      email: "customer1@rebx.dev",
      passwordHash,
      role: "CUSTOMER",
      customerProfile: { create: {} },
    },
  });

  await prisma.user.upsert({
    where: { email: "customer2@rebx.dev" },
    update: {},
    create: {
      name: "Riley Renter",
      email: "customer2@rebx.dev",
      passwordHash,
      role: "CUSTOMER",
      customerProfile: { create: {} },
    },
  });

  const listings = [
    {
      title: "Downtown 2BR Condo",
      agentId: agent1.id,
      developerId: null,
      status: "ACTIVE" as const,
      city: "Austin",
      price: 425000,
      bedrooms: 2,
      bathrooms: 2,
      areaSqFt: 1100,
    },
    {
      title: "Lakeside Family Home",
      agentId: agent1.id,
      developerId: null,
      status: "ACTIVE" as const,
      city: "Austin",
      price: 689000,
      bedrooms: 4,
      bathrooms: 3,
      areaSqFt: 2600,
    },
    {
      title: "Riverside Studio",
      agentId: agent1.id,
      developerId: null,
      status: "DRAFT" as const,
      city: "Austin",
      price: 210000,
      bedrooms: 0,
      bathrooms: 1,
      areaSqFt: 520,
    },
    {
      title: "Northgate Tower Unit 12B",
      agentId: agent1.id,
      developerId: developer.id,
      status: "ACTIVE" as const,
      city: "Austin",
      price: 512000,
      bedrooms: 3,
      bathrooms: 2,
      areaSqFt: 1450,
    },
    {
      title: "Suburban Ranch House",
      agentId: agent2.id,
      developerId: null,
      status: "ACTIVE" as const,
      city: "Round Rock",
      price: 375000,
      bedrooms: 3,
      bathrooms: 2,
      areaSqFt: 1800,
    },
    {
      title: "Modern Townhome",
      agentId: agent2.id,
      developerId: null,
      status: "UNDER_OFFER" as const,
      city: "Round Rock",
      price: 449000,
      bedrooms: 3,
      bathrooms: 3,
      areaSqFt: 1950,
    },
    {
      title: "Historic Bungalow",
      agentId: agent2.id,
      developerId: null,
      status: "SOLD" as const,
      city: "Round Rock",
      price: 315000,
      bedrooms: 2,
      bathrooms: 1,
      areaSqFt: 1200,
    },
    {
      title: "Northgate Tower Unit 4A",
      agentId: agent2.id,
      developerId: developer.id,
      status: "DRAFT" as const,
      city: "Austin",
      price: 498000,
      bedrooms: 3,
      bathrooms: 2,
      areaSqFt: 1420,
    },
  ];

  const seededListings: Record<string, { id: string; slug: string }> = {};

  for (const [index, data] of listings.entries()) {
    const slug = slugify(data.title, String(index + 1));
    const listing = await prisma.listing.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: data.title,
        description: `A beautiful property in ${data.city}. Contact the listing agent for a private tour.`,
        price: data.price,
        currency: "USD",
        addressLine: `${100 + index} Main Street`,
        city: data.city,
        state: "TX",
        country: "USA",
        postalCode: "78701",
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        areaSqFt: data.areaSqFt,
        status: data.status,
        agentId: data.agentId,
        developerId: data.developerId,
      },
    });
    seededListings[data.title] = { id: listing.id, slug: listing.slug };
  }

  // Demo deals + commissions, so the pipeline has example data beyond raw listings.
  const northgate12B = seededListings["Northgate Tower Unit 12B"];
  const historicBungalow = seededListings["Historic Bungalow"];

  const dealDeveloperSale = await prisma.deal.upsert({
    where: { id: "seed-deal-northgate-12b" },
    update: {},
    create: {
      id: "seed-deal-northgate-12b",
      listingId: northgate12B.id,
      agentId: agent1.id,
      stage: "CLOSED_WON",
      contactName: "Jordan Buyer",
      contactEmail: "jordan.buyer@example.com",
      contactPhone: "555-0142",
      offerAmount: 512000,
      closedAt: new Date(),
    },
  });
  await prisma.listing.update({
    where: { id: northgate12B.id },
    data: { status: "SOLD" },
  });

  await prisma.booking.upsert({
    where: { dealId: dealDeveloperSale.id },
    update: {},
    create: {
      dealId: dealDeveloperSale.id,
      status: "CONFIRMED",
      saleAmount: 512000,
      confirmedAt: new Date(),
    },
  });

  await prisma.commission.upsert({
    where: { dealId_source: { dealId: dealDeveloperSale.id, source: "DEVELOPER" } },
    update: {},
    create: {
      dealId: dealDeveloperSale.id,
      agentId: agent1.id,
      source: "DEVELOPER",
      amount: 15360,
      status: "INVOICED",
      invoicedAt: new Date(),
    },
  });
  await prisma.commission.upsert({
    where: { dealId_source: { dealId: dealDeveloperSale.id, source: "CUSTOMER" } },
    update: {},
    create: {
      dealId: dealDeveloperSale.id,
      agentId: agent1.id,
      source: "CUSTOMER",
      amount: 5120,
      status: "PENDING",
    },
  });

  const dealResale = await prisma.deal.upsert({
    where: { id: "seed-deal-historic-bungalow" },
    update: {},
    create: {
      id: "seed-deal-historic-bungalow",
      listingId: historicBungalow.id,
      agentId: agent2.id,
      stage: "CLOSED_WON",
      contactName: "Morgan Buyer",
      contactEmail: "morgan.buyer@example.com",
      offerAmount: 315000,
      closedAt: new Date(),
    },
  });

  await prisma.booking.upsert({
    where: { dealId: dealResale.id },
    update: {},
    create: {
      dealId: dealResale.id,
      status: "CONFIRMED",
      saleAmount: 315000,
      confirmedAt: new Date(),
    },
  });

  await prisma.commission.upsert({
    where: { dealId_source: { dealId: dealResale.id, source: "CUSTOMER" } },
    update: {},
    create: {
      dealId: dealResale.id,
      agentId: agent2.id,
      source: "CUSTOMER",
      amount: 9450,
      status: "RECEIVED",
      invoicedAt: new Date(),
      receivedAt: new Date(),
    },
  });

  // Lead pipeline test data — one deal per DealStage (plus guest vs. logged-in-customer
  // variants and the three Booking substates) so the agent dashboard, developer dashboard,
  // and admin views all have realistic data to exercise.
  const downtown = seededListings["Downtown 2BR Condo"];
  const lakeside = seededListings["Lakeside Family Home"];
  const suburbanRanch = seededListings["Suburban Ranch House"];

  await prisma.deal.upsert({
    where: { id: "seed-lead-new-guest" },
    update: {},
    create: {
      id: "seed-lead-new-guest",
      listingId: downtown.id,
      agentId: agent1.id,
      stage: "NEW",
      contactName: "Taylor Prospect",
      contactEmail: "taylor.prospect@example.com",
      contactPhone: "555-0101",
      message: "Is this still available? I'd love a weekend tour.",
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-new-customer" },
    update: {},
    create: {
      id: "seed-lead-new-customer",
      listingId: downtown.id,
      agentId: agent1.id,
      customerId: customer1.id,
      stage: "NEW",
      contactName: customer1.name,
      contactEmail: customer1.email,
      message: "Submitted through my account — interested in financing options.",
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-contacted" },
    update: {},
    create: {
      id: "seed-lead-contacted",
      listingId: downtown.id,
      agentId: agent1.id,
      stage: "CONTACTED",
      contactName: "Jamie Inquirer",
      contactEmail: "jamie.inquirer@example.com",
      notes: "Left a voicemail, waiting to hear back.",
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-under-contract" },
    update: {},
    create: {
      id: "seed-lead-under-contract",
      listingId: downtown.id,
      agentId: agent1.id,
      stage: "UNDER_CONTRACT",
      contactName: "Drew Buyer",
      contactEmail: "drew.buyer@example.com",
      offerAmount: 420000,
      notes: "Inspection scheduled for next week.",
    },
  });
  await prisma.listing.update({ where: { id: downtown.id }, data: { status: "UNDER_OFFER" } });

  await prisma.deal.upsert({
    where: { id: "seed-lead-viewing" },
    update: {},
    create: {
      id: "seed-lead-viewing",
      listingId: lakeside.id,
      agentId: agent1.id,
      stage: "VIEWING_SCHEDULED",
      contactName: "Sam Looker",
      contactEmail: "sam.looker@example.com",
      contactPhone: "555-0117",
      notes: "Touring Saturday at 2pm.",
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-offer" },
    update: {},
    create: {
      id: "seed-lead-offer",
      listingId: lakeside.id,
      agentId: agent1.id,
      stage: "OFFER_MADE",
      contactName: "Robin Hopeful",
      contactEmail: "robin.hopeful@example.com",
      offerAmount: 670000,
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-negotiation" },
    update: {},
    create: {
      id: "seed-lead-negotiation",
      listingId: lakeside.id,
      agentId: agent1.id,
      stage: "NEGOTIATION",
      contactName: "Casey Bargainer",
      contactEmail: "casey.bargainer@example.com",
      offerAmount: 675000,
      notes: "Buyer negotiating on closing costs.",
    },
  });

  await prisma.deal.upsert({
    where: { id: "seed-lead-closed-lost" },
    update: {},
    create: {
      id: "seed-lead-closed-lost",
      listingId: lakeside.id,
      agentId: agent1.id,
      stage: "CLOSED_LOST",
      contactName: "Pat Walkedaway",
      contactEmail: "pat.walkedaway@example.com",
      offerAmount: 660000,
      notes: "Buyer chose another property.",
      closedAt: new Date(),
    },
  });

  // Booking pending developer confirmation — no commission possible yet.
  const dealBookingPending = await prisma.deal.upsert({
    where: { id: "seed-lead-booking-pending" },
    update: {},
    create: {
      id: "seed-lead-booking-pending",
      listingId: northgate12B.id,
      agentId: agent1.id,
      stage: "CLOSED_WON",
      contactName: "Harper Newowner",
      contactEmail: "harper.newowner@example.com",
      offerAmount: 520000,
      closedAt: new Date(),
    },
  });
  await prisma.booking.upsert({
    where: { dealId: dealBookingPending.id },
    update: {},
    create: {
      dealId: dealBookingPending.id,
      status: "PENDING_CONFIRMATION",
      saleAmount: 520000,
    },
  });

  // Booking confirmed but no commission logged yet.
  const dealBookingConfirmed = await prisma.deal.upsert({
    where: { id: "seed-lead-booking-confirmed" },
    update: {},
    create: {
      id: "seed-lead-booking-confirmed",
      listingId: northgate12B.id,
      agentId: agent1.id,
      stage: "CLOSED_WON",
      contactName: "Quinn Settledup",
      contactEmail: "quinn.settledup@example.com",
      offerAmount: 530000,
      closedAt: new Date(),
    },
  });
  await prisma.booking.upsert({
    where: { dealId: dealBookingConfirmed.id },
    update: {},
    create: {
      dealId: dealBookingConfirmed.id,
      status: "CONFIRMED",
      saleAmount: 530000,
      confirmedAt: new Date(),
    },
  });

  // A lead on agent2's listing, to verify agent1 cannot see it.
  await prisma.deal.upsert({
    where: { id: "seed-lead-agent2-new" },
    update: {},
    create: {
      id: "seed-lead-agent2-new",
      listingId: suburbanRanch.id,
      agentId: agent2.id,
      stage: "NEW",
      contactName: "Avery Other",
      contactEmail: "avery.other@example.com",
    },
  });

  console.log("Seed complete.");
  console.log(`Admin:     ${admin.email} / ${SEED_PASSWORD}`);
  console.log(`Agent:     ${agent1.email} / ${SEED_PASSWORD}`);
  console.log(`Agent:     ${agent2.email} / ${SEED_PASSWORD}`);
  console.log(`Developer: ${developer.email} / ${SEED_PASSWORD}`);
  console.log(`Customer:  customer1@rebx.dev / ${SEED_PASSWORD}`);
  console.log(`Customer:  customer2@rebx.dev / ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
