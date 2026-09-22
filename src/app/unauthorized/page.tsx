import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Not authorized</h1>
      <p className="text-gray-600">
        You don&apos;t have permission to view that page.
      </p>
      <Link
        href="/dashboard"
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Go to my dashboard
      </Link>
    </div>
  );
}
