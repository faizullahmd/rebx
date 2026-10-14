"use client";

import { useActionState } from "react";

type State = { ok?: boolean; message?: string } | undefined;

/**
 * Wraps a server action with pending state, an optional confirm() prompt, and inline
 * success/error feedback, so admin row actions don't need their own client components.
 */
export function ActionForm({
  action,
  children,
  confirmMessage,
  className,
}: {
  action: (prev: State, formData: FormData) => Promise<State>;
  children: React.ReactNode;
  confirmMessage?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined as State);

  return (
    <form
      action={formAction}
      className={className ?? "flex flex-wrap items-center gap-2"}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.message && (
        <span
          role="status"
          className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-600"}`}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "danger" | "primary";
}) {
  const styles = {
    default: "border border-gray-300 text-gray-700 hover:bg-gray-50",
    danger: "border border-red-200 text-red-600 hover:bg-red-50",
    primary: "bg-gray-900 text-white hover:bg-gray-700",
  }[variant];
  return (
    <button type="submit" className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}
