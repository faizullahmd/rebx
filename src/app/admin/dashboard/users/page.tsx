import { getAllUsers } from "@/lib/data/users";
import { updateUserRole } from "@/lib/actions/admin";

export default async function AdminUsersPage() {
  const users = await getAllUsers();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b border-gray-100">
              <td className="py-3">{user.name}</td>
              <td className="py-3 text-gray-600">{user.email}</td>
              <td className="py-3 text-gray-600">{user.role}</td>
              <td className="py-3">
                <form action={updateUserRole.bind(null, user.id)} className="flex gap-2">
                  <select
                    name="role"
                    defaultValue={user.role}
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="AGENT">Agent</option>
                    <option value="DEVELOPER">Developer</option>
                    <option value="CUSTOMER">Customer</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Update
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
