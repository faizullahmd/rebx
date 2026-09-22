"use client";

import { useActionState } from "react";
import { createInquiry } from "@/lib/actions/deals";
import type { InquiryFormState } from "@/lib/validation/deal";

export function InquiryForm({
  listingId,
  isLoggedInCustomer,
}: {
  listingId: string;
  isLoggedInCustomer: boolean;
}) {
  const action = createInquiry.bind(null, listingId);
  const [state, formAction, pending] = useActionState<InquiryFormState, FormData>(
    action,
    undefined
  );

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h2 className="font-medium text-gray-900">Interested in this property?</h2>
      <form action={formAction} className="mt-3 flex flex-col gap-3">
        {state?.message && (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{state.message}</p>
        )}

        {!isLoggedInCustomer && (
          <>
            <Field label="Name" name="contactName" errors={state?.errors?.contactName} />
            <Field
              label="Email"
              name="contactEmail"
              type="email"
              errors={state?.errors?.contactEmail}
            />
          </>
        )}

        <Field label="Phone (optional)" name="contactPhone" />
        <div className="flex flex-col gap-1">
          <label htmlFor="message" className="text-sm font-medium text-gray-700">
            Message (optional)
          </label>
          <textarea
            id="message"
            name="message"
            rows={3}
            placeholder="I'd like to schedule a viewing…"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Contact agent"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  errors,
}: {
  label: string;
  name: string;
  type?: string;
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
        type={type}
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
