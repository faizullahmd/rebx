"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/lib/actions/auth";

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, undefined);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 py-12">
      <h1 className="text-2xl font-semibold">Sign up</h1>
      <form action={formAction} className="flex flex-col gap-4">
        {state?.message && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            name="name"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {state?.errors?.name && <FieldError messages={state.errors.name} />}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {state?.errors?.email && <FieldError messages={state.errors.email} />}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {state?.errors?.password && <FieldError messages={state.errors.password} />}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-gray-700">I am a…</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="role" value="AGENT" defaultChecked />
              Agent
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="role" value="CUSTOMER" />
              Customer
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "Creating account…" : "Sign up"}
        </button>
      </form>
      <p className="text-sm text-gray-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-gray-900 underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

function FieldError({ messages }: { messages: string[] }) {
  return (
    <ul className="text-xs text-red-600">
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
