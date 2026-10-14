import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { deleteReview, toggleReviewVerified } from "@/lib/actions/admin";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  Badge, Empty, PAGE_SIZE, PageHeader, Pagination, SearchBar, TableShell, Td, Th, formatDate, parsePage,
} from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const where: Prisma.ReviewWhereInput = q
    ? { OR: [{ name: { contains: q } }, { comment: { contains: q } }, { agent: { name: { contains: q } } }] }
    : {};

  const [total, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        agent: { select: { name: true } },
        listing: { select: { title: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reviews" description={`${total} review(s). Moderate what appears on agent profiles and listings.`} />
      <SearchBar placeholder="Search reviewer, comment, or agent" q={q} />
      {reviews.length === 0 ? (
        <Empty>No reviews yet.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Review</Th><Th>For</Th><Th>Rating</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <tr key={r.id}>
                <Td>
                  <p className="font-medium">{r.name} <span className="font-normal text-neutral-400">· {r.role}</span></p>
                  <p className="mt-1 max-w-md whitespace-pre-wrap text-neutral-700">{r.comment}</p>
                  <p className="mt-1 text-xs text-neutral-400">#{r.id} · {formatDate(r.createdAt)}</p>
                </Td>
                <Td className="text-xs text-neutral-600">
                  <p className="font-medium text-neutral-800">Agent: {r.agent.name}</p>
                  {r.listing && <p>Listing: {r.listing.title}</p>}
                </Td>
                <Td>
                  <p className="font-medium">{r.rating} / 5</p>
                  <Badge tone={r.isVerified ? "green" : "gray"}>{r.isVerified ? "verified" : "unverified"}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-col items-start gap-2">
                    <ActionForm action={toggleReviewVerified.bind(null, r.id)}>
                      <SubmitButton>{r.isVerified ? "Mark unverified" : "Mark verified"}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteReview.bind(null, r.id)} confirmMessage="Delete this review permanently?">
                      <SubmitButton variant="danger">Delete</SubmitButton>
                    </ActionForm>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/reviews" page={page} pageCount={Math.ceil(total / PAGE_SIZE)} params={{ q }} />
    </div>
  );
}
