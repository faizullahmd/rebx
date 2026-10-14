import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="text-lg font-semibold tracking-tight">REBX</p>
        <h1 className="mt-1 text-2xl font-semibold">Admin sign in</h1>
        <p className="mt-1 text-sm text-neutral-500">Restricted area. Administrator accounts only.</p>
        <AdminLoginForm callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
