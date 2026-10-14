import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { DealStage, Prisma } from "@prisma/client";
import { deleteDealAdmin, updateDealAdmin } from "@/lib/actions/admin";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  Badge, Empty, PAGE_SIZE, PageHeader, Pagination, SearchBar, TableShell, Td, Th, formatDate, parsePage,
} from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

const STAGES: DealStage[] = [
  "NEW", "CONTACTED", "VIEWING_SCHEDULED", "OFFER_MADE", "NEGOTIATION", "UNDER_CONTRACT", "CLOSED_WON", "CLOSED_LOST",
];
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();
const stageTone = (s: DealStage) => (s === "CLOSED_WON" ? "green" : s === "CLOSED_LOST" ? "red" : "amber");

export default async function AdminDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; stage?: string; page?: string }>;
}) {
  const { q, stage, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const stageFilter = STAGES.includes(stage as DealStage) ? (stage as DealStage) : undefined;

  const where: Prisma.DealWhereInput = {
    ...(stageFilter ? { stage: stageFilter } : {}),
    ...(q
      ? {
          OR: [
            { contactName: { contains: q } },
            { contactEmail: { contains: q } },
            { listing: { title: { contains: q } } },
            { agent: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const [total, deals] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        listing: { select: { title: true, slug: true } },
        agent: { select: { name: true, email: true } },
        customer: { select: { name: true, email: true } },
        booking: { select: { status: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Deals & inquiries" description={`${total} record(s). Every inquiry from the public site and every deal agents track.`} />
      <SearchBar
        placeholder="Search contact, listing, or agent"
        q={q}
        extra={
          <select name="stage" defaultValue={stageFilter ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        }
      />

      {deals.length === 0 ? (
        <Empty>No deals match.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Contact</Th><Th>Listing / agent</Th><Th>Stage</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id}>
                <Td>
                  <p className="font-medium">{d.contactName}</p>
                  <p className="text-xs text-neutral-500">{d.contactEmail}</p>
                  {d.contactPhone && <p className="text-xs text-neutral-500">{d.contactPhone}</p>}
                  {d.customer && <p className="text-xs text-neutral-400">Account: {d.customer.email}</p>}
                  {d.message && <p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-neutral-600">“{d.message}”</p>}
                  <p className="mt-1 text-xs text-neutral-400">#{d.id} · {formatDate(d.createdAt)}</p>
                </Td>
                <Td className="text-xs text-neutral-600">
                  <Link href={`/listings/${d.listing.slug}`} target="_blank" className="font-medium text-neutral-800 hover:underline">{d.listing.title}</Link>
                  <p>Agent: {d.agent.name}</p>
                  <p className="text-neutral-400">{d.agent.email}</p>
                </Td>
                <Td>
                  <div className="flex flex-col gap-1">
                    <Badge tone={stageTone(d.stage)}>{label(d.stage)}</Badge>
                    {d.booking && <Badge tone={d.booking.status === "CONFIRMED" ? "green" : "amber"}>booking {label(d.booking.status)}</Badge>}
                    {d.offerAmount && <span className="text-xs text-neutral-500">Offer: {Number(d.offerAmount).toLocaleString()}</span>}
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col gap-2">
                    <ActionForm key={`${d.id}-${d.updatedAt.getTime()}`} action={updateDealAdmin.bind(null, d.id)} className="flex flex-col items-start gap-1.5">
                      <select name="stage" defaultValue={d.stage} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
                        {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                      </select>
                      <input name="offerAmount" type="number" step="any" min="0" defaultValue={d.offerAmount ? String(d.offerAmount) : ""} placeholder="Offer amount" className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                      <input name="notes" defaultValue={d.notes ?? ""} placeholder="Notes" className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                      <SubmitButton>Save</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteDealAdmin.bind(null, d.id)} confirmMessage={`Delete this deal with ${d.contactName}? Its booking and commissions are deleted too.`}>
                      <SubmitButton variant="danger">Delete</SubmitButton>
                    </ActionForm>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/deals" page={page} pageCount={Math.ceil(total / PAGE_SIZE)} params={{ q, stage: stageFilter }} />
    </div>
  );
}
