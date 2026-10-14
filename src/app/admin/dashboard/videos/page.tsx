import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { deleteVideoAdmin } from "@/lib/actions/admin";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  Empty, PAGE_SIZE, PageHeader, Pagination, SearchBar, TableShell, Td, Th, formatDate, parsePage,
} from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

export default async function AdminVideosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const where: Prisma.VideoWhereInput = q
    ? { OR: [{ title: { contains: q } }, { createdBy: { name: { contains: q } } }] }
    : {};

  const [total, videos] = await Promise.all([
    prisma.video.count({ where }),
    prisma.video.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        createdBy: { select: { name: true, email: true } },
        _count: { select: { listings: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Videos" description={`${total} gallery video(s) added by agents and developers.`} />
      <SearchBar placeholder="Search title or owner" q={q} />
      {videos.length === 0 ? (
        <Empty>No videos yet.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>Video</Th><Th>Owner</Th><Th>Used by</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id}>
                <Td>
                  <div className="flex gap-3">
                    {v.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.thumbnailUrl} alt="" className="h-12 w-20 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-12 w-20 items-center justify-center rounded-md bg-neutral-100 text-[10px] text-neutral-400">No thumb</div>
                    )}
                    <div className="min-w-0">
                      <a href={v.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{v.title}</a>
                      <p className="text-xs text-neutral-500">{v.provider} · #{v.id} · {formatDate(v.createdAt)}</p>
                    </div>
                  </div>
                </Td>
                <Td className="text-xs text-neutral-600">
                  <p className="font-medium text-neutral-800">{v.createdBy.name}</p>
                  <p>{v.createdBy.email}</p>
                </Td>
                <Td className="text-xs text-neutral-600">{v._count.listings} listing(s)</Td>
                <Td>
                  <ActionForm action={deleteVideoAdmin.bind(null, v.id)} confirmMessage={`Delete “${v.title}”? Listings using it will lose the video.`}>
                    <SubmitButton variant="danger">Delete</SubmitButton>
                  </ActionForm>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/videos" page={page} pageCount={Math.ceil(total / PAGE_SIZE)} params={{ q }} />
    </div>
  );
}
