"use client";

import { useActionState, useState } from "react";
import { createInquiry, expressInterest, forgetSavedDetails } from "@/lib/actions/deals";
import type { InquiryFormState } from "@/lib/validation/deal";
import { PHONE_MESSAGE, EMAIL_MESSAGE, isValidPhone } from "@/lib/validation/contact";

export function InquiryForm({
  listingId,
  isLoggedInCustomer,
}: {
  listingId: number;
  isLoggedInCustomer: boolean;
  returningName?: string | null;
  alreadyInterested?: boolean;
}) {
  return <FullInquiryForm listingId={listingId} isLoggedInCustomer={isLoggedInCustomer} />;
}

function InterestedButton({
  listingId,
  name,
  isLoggedInCustomer,
  onUseForm,
}: {
  listingId: number;
  name: string;
  isLoggedInCustomer: boolean;
  onUseForm: () => void;
}) {
  const action = expressInterest.bind(null, listingId);
  const [state, formAction, pending] = useActionState<InquiryFormState, FormData>(action, undefined);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-gray-900">Interested in this property?</h2>
      <p className="mt-1 text-xs text-gray-600">
        Hi {name.split(" ")[0]}, we&apos;ll share the contact details you gave earlier with the listing agent.
      </p>
      {state?.message && (
        <p role="status" className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
          {state.message}
        </p>
      )}
      <form action={formAction} className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-gray-800 disabled:opacity-50 transition cursor-pointer"
        >
          {pending ? "Sending…" : "I'm Interested"}
        </button>
      </form>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-500">
        <button type="button" onClick={onUseForm} className="underline hover:text-gray-800 cursor-pointer">
          Add a message instead
        </button>
        {!isLoggedInCustomer && (
          <form action={forgetSavedDetails}>
            <button type="submit" className="underline hover:text-gray-800 cursor-pointer">
              Not you? Use different details
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function FullInquiryForm({
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
          <div className="rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-800 border border-green-200" role="status">
            {state.message}
          </div>
        )}

        {!isLoggedInCustomer && (
          <>
            <Field label="Name" name="contactName" errors={state?.errors?.contactName} defaultValue={state?.values?.contactName} required minLength={2} autoComplete="name" />
            <Field
              label="Email"
              name="contactEmail"
              type="email"
              errors={state?.errors?.contactEmail}
              defaultValue={state?.values?.contactEmail}
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              pattern="[^\s@]+@[^\s@]+\.[A-Za-z]{2,}"
              title={EMAIL_MESSAGE}
            />
          </>
        )}

        <Field
          label="Phone (optional)"
          name="contactPhone"
          type="tel"
          errors={state?.errors?.contactPhone}
          defaultValue={state?.values?.contactPhone}
          maxLength={30}
          autoComplete="tel"
          inputMode="tel"
          onInput={(e) => {
            // Same rule as the server (a `pattern` can't count digits). Empty is allowed.
            const v = e.currentTarget.value.trim();
            e.currentTarget.setCustomValidity(v === "" || isValidPhone(v) ? "" : PHONE_MESSAGE);
          }}
          title={PHONE_MESSAGE}
          placeholder="+91 98765 43210"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="message" className="text-xs font-medium text-gray-600">
            Message (optional)
          </label>
          <textarea
            id="message"
            name="message"
            rows={2}
            defaultValue={state?.values?.message}
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
  ...inputProps
}: {
  label: string;
  name: string;
  type?: string;
  errors?: string[];
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name" | "type" | "id" | "className">) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-xs font-medium text-gray-600">
        {label}
      </label>
      <input
        {...inputProps}
        id={name}
        name={name}
        type={type}
        aria-invalid={errors?.length ? true : undefined}
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
