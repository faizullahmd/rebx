"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/account";
import type { ChangePasswordState } from "@/lib/validation/account";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    undefined
  );

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <Field
        label="Current password"
        name="currentPassword"
        errors={state?.errors?.currentPassword}
      />
      <Field label="New password" name="newPassword" errors={state?.errors?.newPassword} />
      <Field
        label="Confirm new password"
        name="confirmPassword"
        errors={state?.errors?.confirmPassword}
      />

      <p className="text-xs text-gray-500">
        Changing your password will sign you out of this session — you&apos;ll need to log back in
        with the new one.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  errors,
}: {
  label: string;
  name: string;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="password"
        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {errors && (
        <ul className="text-xs text-red-600">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
