"use client";

import { useActionState } from "react";
import type { Listing, ListingImage } from "@prisma/client";
import type { ListingFormState } from "@/lib/validation/listing";

type Developer = { id: string; name: string; developerProfile: { companyName: string } | null };

export function ListingForm({
  action,
  listing,
  developers,
  submitLabel,
}: {
  action: (state: ListingFormState, formData: FormData) => Promise<ListingFormState>;
  listing?: Omit<Listing, "price"> & { price: number; images: ListingImage[] };
  developers: Developer[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <Field label="Title" name="title" defaultValue={listing?.title} errors={state?.errors?.title} />
      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={listing?.description}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {state?.errors?.description && <FieldError messages={state.errors.description} />}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Price"
          name="price"
          type="number"
          defaultValue={listing ? String(listing.price) : undefined}
          errors={state?.errors?.price}
        />
        <Field
          label="Currency"
          name="currency"
          defaultValue={listing?.currency ?? "USD"}
          errors={state?.errors?.currency}
        />
      </div>

      <Field
        label="Address"
        name="addressLine"
        defaultValue={listing?.addressLine}
        errors={state?.errors?.addressLine}
      />
      <div className="grid grid-cols-2 gap-4">
        <Field label="City" name="city" defaultValue={listing?.city} errors={state?.errors?.city} />
        <Field label="State / region" name="state" defaultValue={listing?.state ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Country"
          name="country"
          defaultValue={listing?.country}
          errors={state?.errors?.country}
        />
        <Field label="Postal code" name="postalCode" defaultValue={listing?.postalCode ?? ""} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field
          label="Bedrooms"
          name="bedrooms"
          type="number"
          defaultValue={listing?.bedrooms?.toString()}
        />
        <Field
          label="Bathrooms"
          name="bathrooms"
          type="number"
          defaultValue={listing?.bathrooms?.toString()}
        />
        <Field
          label="Area (sqft)"
          name="areaSqFt"
          type="number"
          defaultValue={listing?.areaSqFt?.toString()}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="status" className="text-sm font-medium text-gray-700">
          Status
        </label>
        <select
          id="status"
          name="status"
          defaultValue={listing?.status ?? "DRAFT"}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="UNDER_OFFER">Under offer</option>
          <option value="SOLD">Sold</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="developerId" className="text-sm font-medium text-gray-700">
          Linked developer (optional)
        </label>
        <select
          id="developerId"
          name="developerId"
          defaultValue={listing?.developerId ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">None</option>
          {developers.map((dev) => (
            <option key={dev.id} value={dev.id}>
              {dev.developerProfile?.companyName ?? dev.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="imageUrls" className="text-sm font-medium text-gray-700">
          Image URLs
        </label>
        <textarea
          id="imageUrls"
          name="imageUrls"
          rows={3}
          placeholder="One URL per line"
          defaultValue={listing?.images.map((img) => img.url).join("\n")}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
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
        defaultValue={defaultValue}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {errors && <FieldError messages={errors} />}
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
