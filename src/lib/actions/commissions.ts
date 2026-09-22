"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import {
  CommissionFormSchema,
  UpdateCommissionStatusSchema,
  type CommissionFormState,
  type UpdateCommissionStatusState,
} from "@/lib/validation/commission";
import type { CommissionSource } from "@prisma/client";

function revalidateCommissionPaths(dealId: string) {
  revalidatePath(`/agent/dashboard/deals/${dealId}`);
  revalidatePath("/agent/dashboard/commissions");
  revalidatePath("/agent/dashboard");
  revalidatePath("/developer/dashboard");
  revalidatePath("/admin/dashboard/commissions");
}

export async function createCommission(
  dealId: string,
  source: CommissionSource,
  _prevState: CommissionFormState,
  formData: FormData
): Promise<CommissionFormState> {
  const user = await requireUser();

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { message: "Deal not found." };
  }
  if (user.role !== "ADMIN" && deal.agentId !== user.id) {
    return { message: "You are not allowed to add commission to this deal." };
  }
  if (deal.stage !== "CLOSED_WON") {
    return { message: "Commission can only be logged once a deal is closed won." };
  }

  const validatedFields = CommissionFormSchema.safeParse({
    ...Object.fromEntries(formData),
    source,
  });
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  try {
    await prisma.commission.create({
      data: {
        dealId,
        agentId: deal.agentId,
        source: validatedFields.data.source,
        amount: validatedFields.data.amount,
        notes: validatedFields.data.notes || null,
      },
    });
  } catch {
    return { message: "A commission for this source already exists on this deal." };
  }

  revalidateCommissionPaths(dealId);
  return { message: "Commission added." };
}

export async function updateCommissionStatus(
  commissionId: string,
  _prevState: UpdateCommissionStatusState,
  formData: FormData
): Promise<UpdateCommissionStatusState> {
  const user = await requireUser();

  const existing = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!existing) {
    return { message: "Commission not found." };
  }
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    return { message: "You are not allowed to edit this commission." };
  }

  const validatedFields = UpdateCommissionStatusSchema.safeParse(Object.fromEntries(formData));
  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors };
  }

  const { status, amount, notes } = validatedFields.data;

  await prisma.commission.update({
    where: { id: commissionId },
    data: {
      status,
      amount,
      notes: notes || null,
      ...(status === "INVOICED" && existing.status !== "INVOICED"
        ? { invoicedAt: new Date() }
        : {}),
      ...(status === "RECEIVED" && existing.status !== "RECEIVED"
        ? { receivedAt: new Date() }
        : {}),
    },
  });

  revalidateCommissionPaths(existing.dealId);
  return { message: "Commission updated." };
}

export async function deleteCommission(commissionId: string) {
  const user = await requireUser();

  const existing = await prisma.commission.findUnique({ where: { id: commissionId } });
  if (!existing) return;
  if (user.role !== "ADMIN" && existing.agentId !== user.id) {
    throw new Error("You are not allowed to delete this commission.");
  }

  await prisma.commission.delete({ where: { id: commissionId } });

  revalidateCommissionPaths(existing.dealId);
}
