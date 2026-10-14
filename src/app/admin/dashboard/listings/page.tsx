import Link from "next/link";
import { prisma } from "@/lib/prisma";
import type { ListingStatus, Prisma } from "@prisma/client";
import { deleteListingAdmin, updateListingStatus } from "@/lib/actions/admin";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  Badge, Empty, PAGE_SIZE, PageHeader, Pagination, SearchBar, TableShell, Td, Th, formatDate, parsePage,
} from "@/components/admin/AdminUi";
import { formatListingPrice } from "@/lib/price";

export const dynamic = "force-dynamic";

const STATUSES: ListingStatus[] = ["DRAFT", "ACTIVE", "UNDER_OFFER", "SOLD"];
const statusTone = { DRAFT: "gray", ACTIVE: "green", UNDER_OFFER: "amber", SOLD: "blue" } as const;

export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const statusFilter = STATUSES.includes(status as ListingStatus) ? (status as ListingStatus) : undefined;

  const where: Prisma.ListingWhereInput = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(q
      ? { OR: [{ title: { contains: q } }, { city: { contains: q } }, { slug: { contains: q } }, { agent: { name: { contains: q } } }] }
      : {}),
  };

  const [total, listings] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        images: { orderBy: { sortOrder: "asc" }, take: 1 },
        agent: { select: { id: true, name: true, email: true } },
        developer: { select: { name: true } },
        tag: { select: { name: true } },
        _count: { select: { deals: true, images: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Listings" description={`${total} listing(s). Edit any listing, change its status, or remove it.`} />
      <SearchBar
        placeholder="Search title, city, slug, or agent"
        q={q}
        extra={
          <select name="status" defaultValue={statusFilter ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
          </select>
        }
      />

      {listings.length === 0 ? (
        <Empty>No listings match.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Listing</Th><Th>Owner</Th><Th>Price</Th><Th>Status</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id}>
                <Td>
                  <div className="flex gap-3">
                    {l.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.images[0].url} alt="" className="h-12 w-16 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-12 w-16 items-center justify-center rounded-md bg-neutral-100 text-[10px] text-neutral-400">No photo</div>
                    )}
                    <div className="min-w-0">
                      <Link href={`/listings/${l.slug}`} target="_blank" className="font-medium hover:underline">{l.title}</Link>
                      <p className="text-xs text-neutral-500">{l.city} · #{l.id} · {formatDate(l.createdAt)}</p>
                      <p className="text-xs text-neutral-400">{l._count.images} photo(s) · {l._count.deals} deal(s){l.tag ? ` · ${l.tag.name}` : ""}</p>
                    </div>
                  </div>
                </Td>
                <Td className="text-xs text-neutral-600">
                  <p className="font-medium text-neutral-800">{l.agent.name}</p>
                  <p>{l.agent.email}</p>
                  {l.developer && <p className="text-neutral-400">Dev: {l.developer.name}</p>}
                </Td>
                <Td className="whitespace-nowrap text-neutral-700">
                  {formatListingPrice(l.price, l.currency, l.priceDisplay, l.priceOnRequest)}
                </Td>
                <Td>
                  <div className="flex flex-col gap-2">
                    <Badge tone={statusTone[l.status]}>{l.status.replace("_", " ").toLowerCase()}</Badge>
                    <ActionForm key={`${l.id}-${l.status}`} action={updateListingStatus.bind(null, l.id)}>
                      <select name="status" defaultValue={l.status} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
                        {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}
                      </select>
                      <SubmitButton>Set</SubmitButton>
                    </ActionForm>
                  </div>
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-2">
                    <Link href={`/admin/dashboard/listings/${l.id}/edit`} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Edit listing
                    </Link>
                    <ActionForm action={deleteListingAdmin.bind(null, l.id)} confirmMessage={`Delete “${l.title}”, its photos, and its ${l._count.deals} deal(s)? This cannot be undone.`}>
                      <SubmitButton variant="danger">Delete</SubmitButton>
                    </ActionForm>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/listings" page={page} pageCount={Math.ceil(total / PAGE_SIZE)} params={{ q, status: statusFilter }} />
    </div>
  );
}
