"use client";

import { useActionState, useState } from "react";
import { createInquiry } from "@/lib/actions/deals";
import type { InquiryFormState } from "@/lib/validation/deal";

export function InquiryForm({
  listingId,
  isLoggedInCustomer,
}: {
  listingId: number;
  isLoggedInCustomer: boolean;
}) {
  const action = createInquiry.bind(null, listingId);
  const [state, formAction, pending] = useActionState<InquiryFormState, FormData>(
    action,
    undefined
  );
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 p-3 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Interested in this property?</h2>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        {state?.message && (
          <p className="rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-700">{state.message}</p>
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
          <label htmlFor="message" className="text-xs font-medium text-gray-600">
            Message (optional)
          </label>
          <textarea
            id="message"
            name="message"
            rows={2}
            placeholder="I'd like to schedule a viewing…"
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <label className="mt-1 flex items-start gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 flex-none rounded border-gray-300"
          />
          I agree to be contacted about this inquiry and accept the Terms &amp; Conditions.
        </label>

        <button
          type="submit"
          disabled={pending || !agreedToTerms}
          className="mt-1 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
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
      <label htmlFor={name} className="text-xs font-medium text-gray-600">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm"
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
