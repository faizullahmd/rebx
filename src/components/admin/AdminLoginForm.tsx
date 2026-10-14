"use client";

import { useActionState } from "react";
import { adminLogin } from "@/lib/actions/auth";

export function AdminLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState(adminLogin, undefined);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
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
          autoComplete="username"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
