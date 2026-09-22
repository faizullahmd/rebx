"use client";

import { useActionState } from "react";
import { resetPassword } from "@/lib/actions/password-reset";
import type { ResetPasswordState } from "@/lib/validation/account";

export function ResetPasswordForm({ token }: { token: string }) {
  const action = resetPassword.bind(null, token);
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="newPassword" className="text-sm font-medium text-gray-700">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {state?.errors?.newPassword && (
          <ul className="text-xs text-red-600">
            {state.errors.newPassword.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {state?.errors?.confirmPassword && (
          <ul className="text-xs text-red-600">
            {state.errors.confirmPassword.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Reset password"}
      </button>
    </form>
  );
}
