import { PrismaClient } from "@/generated/prisma-client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaVersion?: number;
};

const PRISMA_CLIENT_VERSION = 4;

export const prisma =
  globalForPrisma.prismaVersion === PRISMA_CLIENT_VERSION && globalForPrisma.prisma
    ? globalForPrisma.prisma
    : new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaVersion = PRISMA_CLIENT_VERSION;
}
