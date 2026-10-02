import { requireUser } from "@/lib/session";
import { getUserWithProfile } from "@/lib/data/users";
import { ProfileForm } from "@/components/account/ProfileForm";
import { PasswordForm } from "@/components/account/PasswordForm";

interface AccountPageProps {
  searchParams?: Promise<{ required?: string }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const user = await requireUser();
  const fullUser = await getUserWithProfile(user.id);
  const showUsernameBanner =
    params?.required === "username" ||
    ((user.role === "AGENT" || user.role === "DEVELOPER") && !user.username);

  return (
    <div className="flex flex-col gap-10">
      {showUsernameBanner && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p className="font-semibold">Portfolio username required</p>
            <p className="mt-0.5 text-xs text-amber-800">
              Please choose a unique username below. This creates your public agent portfolio page and enables you to list properties on REBX.
            </p>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-semibold">Account settings</h1>
        <p className="text-gray-600">Manage your profile and password.</p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        <ProfileForm
          role={user.role}
          name={user.name}
          email={user.email}
          username={fullUser?.username ?? user.username ?? ""}
          agentProfile={fullUser?.agentProfile ?? null}
          developerProfile={fullUser?.developerProfile ?? null}
          customerProfile={fullUser?.customerProfile ?? null}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
