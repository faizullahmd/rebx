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

  await prisma.user.upsert({
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

  for (const [index, data] of listings.entries()) {
    const slug = slugify(data.title, String(index + 1));
    await prisma.listing.upsert({
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
  }

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
