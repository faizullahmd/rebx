"use client";

import { useActionState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login } from "@/lib/actions/auth";

function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "";

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <form action={formAction} className="flex flex-col gap-4">
        {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}
        {state?.message && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-gray-500 hover:text-gray-900">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition cursor-pointer"
        >
          {pending ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="text-sm text-gray-600">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="font-medium text-gray-900 underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-sm py-12 text-sm text-gray-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}

