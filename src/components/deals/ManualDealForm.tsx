"use client";

import { useActionState } from "react";
import type { Listing } from "@prisma/client";
import { createManualDeal } from "@/lib/actions/deals";
import type { InquiryFormState } from "@/lib/validation/deal";

export function ManualDealForm({ listings }: { listings: Listing[] }) {
  const [state, formAction, pending] = useActionState<InquiryFormState, FormData>(
    createManualDeal,
    undefined
  );

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="listingId" className="text-sm font-medium text-gray-700">
          Listing
        </label>
        <select
          id="listingId"
          name="listingId"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.title}
            </option>
          ))}
        </select>
      </div>

      <Field label="Contact name" name="contactName" errors={state?.errors?.contactName} />
      <Field
        label="Contact email"
        name="contactEmail"
        type="email"
        errors={state?.errors?.contactEmail}
      />
      <Field label="Contact phone (optional)" name="contactPhone" />

      <div className="flex flex-col gap-1">
        <label htmlFor="message" className="text-sm font-medium text-gray-700">
          Notes (optional)
        </label>
        <textarea
          id="message"
          name="message"
          rows={3}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Create deal"}
      </button>
    </form>
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
