import { prisma } from "@/lib/prisma";
import type { Prisma, Role } from "@prisma/client";
import { requireRole } from "@/lib/session";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  updateUserRole,
} from "@/lib/actions/admin";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  Badge, Card, Empty, PAGE_SIZE, PageHeader, Pagination, SearchBar, TableShell, Td, Th,
  formatDate, parsePage,
} from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

const ROLES: Role[] = ["AGENT", "DEVELOPER", "CUSTOMER", "ADMIN"];
const roleTone = { ADMIN: "purple", DEVELOPER: "blue", AGENT: "green", CUSTOMER: "gray" } as const;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; page?: string }>;
}) {
  const me = await requireRole("ADMIN");
  const { q, role, page: rawPage } = await searchParams;
  const page = parsePage(rawPage);
  const roleFilter = ROLES.includes(role as Role) ? (role as Role) : undefined;

  const where: Prisma.UserWhereInput = {
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(q
      ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { username: { contains: q } }] }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, email: true, username: true, role: true, createdAt: true,
        _count: { select: { listingsAsAgent: true, dealsAsAgent: true, dealsAsCustomer: true } },
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Users" description={`${total} account(s). Create users, change roles, reset passwords, or remove accounts.`} />

      <Card title="Create user">
        <ActionForm action={createUser} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <input name="name" placeholder="Full name" required className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <input name="email" type="email" placeholder="Email" required className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <input name="password" type="text" placeholder="Temporary password" required autoComplete="off" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <select name="role" defaultValue="AGENT" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
          </select>
          <input name="username" placeholder="Username (optional)" className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          <div className="flex items-center gap-2">
            <SubmitButton variant="primary">Create user</SubmitButton>
          </div>
        </ActionForm>
        <p className="mt-2 text-xs text-neutral-500">Password needs 8+ characters with a letter and a number. Share it securely and ask the user to change it.</p>
      </Card>

      <SearchBar
        placeholder="Search name, email, or username"
        q={q}
        extra={
          <select name="role" defaultValue={roleFilter ?? ""} className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
          </select>
        }
      />

      {users.length === 0 ? (
        <Empty>No users match.</Empty>
      ) : (
        <TableShell>
          <thead>
            <tr><Th>User</Th><Th>Role</Th><Th>Activity</Th><Th>Joined</Th><Th>Manage</Th></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isMe = u.id === me.id;
              return (
                <tr key={u.id}>
                  <Td>
                    <p className="font-medium">{u.name}{isMe && <span className="ml-1 text-xs text-neutral-400">(you)</span>}</p>
                    <p className="text-xs text-neutral-500">{u.email}</p>
                    {u.username && <p className="text-xs text-neutral-400">@{u.username}</p>}
                    <p className="text-xs text-neutral-400">ID {u.id}</p>
                  </Td>
                  <Td><Badge tone={roleTone[u.role]}>{u.role.toLowerCase()}</Badge></Td>
                  <Td className="text-xs text-neutral-600">
                    {u._count.listingsAsAgent} listings<br />
                    {u._count.dealsAsAgent + u._count.dealsAsCustomer} deals
                  </Td>
                  <Td className="whitespace-nowrap text-neutral-600">{formatDate(u.createdAt)}</Td>
                  <Td>
                    <div className="flex flex-col gap-2">
                      <ActionForm key={`${u.id}-${u.role}`} action={updateUserRole.bind(null, u.id)}>
                        <select name="role" defaultValue={u.role} disabled={isMe} className="rounded-md border border-gray-300 px-2 py-1 text-xs">
                          {ROLES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
                        </select>
                        {!isMe && <SubmitButton>Set role</SubmitButton>}
                      </ActionForm>
                      <ActionForm action={resetUserPassword.bind(null, u.id)}>
                        <input name="password" type="text" placeholder="New password" autoComplete="off" required className="w-32 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                        <SubmitButton>Reset password</SubmitButton>
                      </ActionForm>
                      {!isMe && (
                        <ActionForm action={deleteUser.bind(null, u.id)} confirmMessage={`Delete ${u.email}? This cannot be undone.`}>
                          <SubmitButton variant="danger">Delete user</SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination basePath="/admin/dashboard/users" page={page} pageCount={Math.ceil(total / PAGE_SIZE)} params={{ q, role: roleFilter }} />
    </div>
  );
}
