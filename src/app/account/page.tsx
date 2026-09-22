import { requireUser } from "@/lib/session";
import { getUserWithProfile } from "@/lib/data/users";
import { ProfileForm } from "@/components/account/ProfileForm";
import { PasswordForm } from "@/components/account/PasswordForm";

export default async function AccountPage() {
  const user = await requireUser();
  const fullUser = await getUserWithProfile(user.id);

  return (
    <div className="flex flex-col gap-10">
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
