import "server-only";
import { prisma } from "@/lib/prisma";
import { sendDealOfferExpiredEmail } from "@/lib/email";
import { formatListingPrice } from "@/lib/price";

export async function getDealsForAgent(agentId: number) {
  const deals = await prisma.deal.findMany({
    where: { agentId },
    include: {
      listing: { select: { id: true, title: true, slug: true } },
      booking: { select: { status: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          type: true,
          text: true,
          amount: true,
          offerStatus: true,
          senderRole: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          messages: {
            where: {
              agentReadAt: null,
              senderRole: "CUSTOMER",
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return deals.map((d) => ({
    ...d,
    lastMessage: d.messages[0] || null,
    unreadCount: d._count.messages,
  }));
}

export function getDealById(id: number) {
  return prisma.deal.findUnique({
    where: { id },
    include: {
      listing: {
        select: { id: true, title: true, slug: true, agentId: true, developerId: true },
      },
      commissions: true,
      booking: true,
    },
  });
}

export async function getDealsForCustomer(customerId: number, customerEmail?: string) {
  const deals = await prisma.deal.findMany({
    where: customerEmail
      ? {
          OR: [
            { customerId },
            { contactEmail: customerEmail },
          ],
        }
      : { customerId },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          price: true,
          priceDisplay: true,
          currency: true,
          city: true,
          images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
      agent: { select: { name: true, email: true } },
      messages: {
        where: { type: { not: "NOTE" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          type: true,
          text: true,
          amount: true,
          offerStatus: true,
          senderRole: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          messages: {
            where: {
              type: { not: "NOTE" },
              customerReadAt: null,
              senderRole: "AGENT",
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return deals.map((d) => ({
    ...d,
    lastMessage: d.messages[0] || null,
    unreadCount: d._count.messages,
  }));
}

export function getAllDealsAdmin() {
  return prisma.deal.findMany({
    include: {
      listing: { select: { id: true, title: true, slug: true } },
      agent: { select: { name: true, email: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Fetch deal for the conversation negotiation page.
 * Strictly checks that:
 * - If role is AGENT: deal belongs to agent's listing.
 * - If role is CUSTOMER: deal belongs to customer (by customerId or contactEmail).
 */
export async function getDealForConversation(
  dealId: number,
  userRole: "AGENT" | "CUSTOMER" | "ADMIN",
  userId: number,
  userEmail?: string
) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          slug: true,
          price: true,
          priceDisplay: true,
          currency: true,
          city: true,
          state: true,
          propertyType: true,
          transactionType: true,
          agentId: true,
          developerId: true,
          images: {
            take: 1,
            orderBy: { sortOrder: "asc" },
            select: { url: true },
          },
        },
      },
      agent: { select: { id: true, name: true, email: true } },
      customer: { select: { id: true, name: true, email: true } },
      booking: true,
      commissions: true,
    },
  });

  if (!deal) return null;

  // Authorization check
  if (userRole === "AGENT") {
    if (deal.agentId !== userId && deal.listing.agentId !== userId) {
      return null;
    }
  } else if (userRole === "CUSTOMER") {
    const isOwner =
      deal.customerId === userId ||
      (userEmail && deal.contactEmail.toLowerCase() === userEmail.toLowerCase());
    if (!isOwner) {
      return null;
    }
  }

  return deal;
}

/**
 * Fetch all messages for a deal conversation.
 * - Enforces role authorization.
 * - Converts any expired PENDING offers to EXPIRED on read.
 * - Strips PRIVATE NOTES if viewer is CUSTOMER.
 * - Marks thread as read for the viewing role.
 */
export async function getDealMessages(
  dealId: number,
  userRole: "AGENT" | "CUSTOMER" | "ADMIN",
  userId: number,
  userEmail?: string
) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { agentId: true, customerId: true, contactEmail: true },
  });

  if (!deal) return [];

  // Authorization check
  if (userRole === "AGENT") {
    if (deal.agentId !== userId) return [];
  } else if (userRole === "CUSTOMER") {
    const isOwner =
      deal.customerId === userId ||
      (userEmail && deal.contactEmail.toLowerCase() === userEmail.toLowerCase());
    if (!isOwner) return [];
  }

  const now = new Date();

  // Expire any pending offers whose expiresAt has passed
  const expiredOffers = await prisma.dealMessage.findMany({
    where: {
      dealId,
      type: "OFFER",
      offerStatus: "PENDING",
      expiresAt: { lt: now },
    },
    include: {
      deal: {
        include: {
          listing: { select: { title: true, currency: true } },
          agent: { select: { name: true, email: true } },
          customer: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (expiredOffers.length > 0) {
    await prisma.$transaction([
      prisma.dealMessage.updateMany({
        where: { id: { in: expiredOffers.map((o) => o.id) } },
        data: { offerStatus: "EXPIRED" },
      }),
      ...expiredOffers.map((o) =>
        prisma.dealMessage.create({
          data: {
            dealId,
            senderRole: "SYSTEM",
            type: "EVENT",
            text: `Offer of ${formatListingPrice(o.amount, o.deal.listing.currency)} expired`,
          },
        })
      ),
    ]);

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    for (const exp of expiredOffers) {
      try {
        const formattedAmount = formatListingPrice(exp.amount, exp.deal.listing.currency);
        if (exp.senderRole === "CUSTOMER") {
          const recipientEmail = exp.deal.customer?.email || exp.deal.contactEmail;
          const recipientName = exp.deal.customer?.name || exp.deal.contactName;
          if (recipientEmail) {
            await sendDealOfferExpiredEmail(recipientEmail, {
              recipient_name: recipientName,
              sender_name: recipientName,
              listing_title: exp.deal.listing.title,
              amount: formattedAmount,
              deal_link: `${baseUrl}/customer/dashboard/deals/${dealId}`,
            });
          }
        } else {
          if (exp.deal.agent?.email) {
            await sendDealOfferExpiredEmail(exp.deal.agent.email, {
              recipient_name: exp.deal.agent.name,
              sender_name: exp.deal.agent.name,
              listing_title: exp.deal.listing.title,
              amount: formattedAmount,
              deal_link: `${baseUrl}/agent/dashboard/deals/${dealId}`,
            });
          }
        }
      } catch (err) {
        console.error("Failed to send offer expired email on read:", err);
      }
    }
  }

  // Mark unread messages as read for this user
  if (userRole === "AGENT" || userRole === "ADMIN") {
    await prisma.dealMessage.updateMany({
      where: {
        dealId,
        agentReadAt: null,
      },
      data: {
        agentReadAt: now,
      },
    });
  } else if (userRole === "CUSTOMER") {
    await prisma.dealMessage.updateMany({
      where: {
        dealId,
        type: { not: "NOTE" },
        customerReadAt: null,
      },
      data: {
        customerReadAt: now,
      },
    });
  }

  // Fetch messages: CUSTOMERS NEVER SEE NOTES
  const messages = await prisma.dealMessage.findMany({
    where: {
      dealId,
      ...(userRole === "CUSTOMER" ? { type: { not: "NOTE" } } : {}),
    },
    include: {
      sender: {
        select: { id: true, name: true, role: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return messages.map((m) => ({
    ...m,
    amount: m.amount ? Number(m.amount) : null,
  }));
}
