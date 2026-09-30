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
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-gray-900">Interested in this property?</h2>
      <form action={formAction} className="mt-3 flex flex-col gap-2.5">
        {state?.message && (
          <p className="rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700 border border-gray-200">
            {state.message}
          </p>
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
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <label className="mt-0.5 flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 flex-none rounded border-gray-300 text-gray-900 focus:ring-gray-900"
          />
          <span>I agree to be contacted about this inquiry and accept the Terms &amp; Conditions.</span>
        </label>

        <button
          type="submit"
          disabled={pending || !agreedToTerms}
          className="mt-1 w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer"
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
        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm shadow-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
      />
      {errors && (
        <ul className="text-xs text-red-600">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
