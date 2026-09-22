"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/actions/password-reset";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, undefined);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <p className="text-sm text-gray-600">
        Enter your account email and we&apos;ll send you a link to reset your password.
      </p>
      <form action={formAction} className="flex flex-col gap-4">
        {state?.message && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{state.message}</p>
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
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="text-sm text-gray-600">
        <Link href="/login" className="font-medium text-gray-900 underline">
          Back to log in
        </Link>
      </p>
    </div>
  );
}
