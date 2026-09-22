import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Reset password</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
