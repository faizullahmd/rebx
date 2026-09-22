"use client";

import { useActionState, useState } from "react";
import type {
  Listing,
  ListingImage,
  TransactionType,
  PropertyCategory,
  PropertyType,
} from "@prisma/client";
import type { ListingFormState } from "@/lib/validation/listing";
import { REQUEST_NEW_DEVELOPER_VALUE } from "@/lib/validation/developer-request";
import {
  TRANSACTION_TYPES,
  TRANSACTION_LABELS,
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
  FURNISHING_LABELS,
  FACING_LABELS,
  AVAILABILITY_LABELS,
  FIELD_VISIBILITY,
  categoriesFor,
  typesFor,
} from "@/lib/property-taxonomy";

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
  const [developerSelection, setDeveloperSelection] = useState(listing?.developerId ?? "");
  const isRequestingNewDeveloper = developerSelection === REQUEST_NEW_DEVELOPER_VALUE;

  const [transactionType, setTransactionType] = useState<TransactionType>(
    listing?.transactionType ?? "FOR_SALE"
  );
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory | "">(
    listing?.propertyCategory ?? ""
  );
  const [propertyType, setPropertyType] = useState<PropertyType | "">(listing?.propertyType ?? "");

  const availableCategories = categoriesFor(transactionType);
  const availableTypes = typesFor(transactionType, propertyCategory);
  const visibility = propertyCategory ? FIELD_VISIBILITY[propertyCategory] : null;

  function handleTransactionTypeChange(value: TransactionType) {
    setTransactionType(value);
    const nextCategories = categoriesFor(value);
    if (propertyCategory && !nextCategories.includes(propertyCategory)) {
      setPropertyCategory("");
      setPropertyType("");
    }
  }

  function handleCategoryChange(value: PropertyCategory | "") {
    setPropertyCategory(value);
    const nextTypes = typesFor(transactionType, value);
    if (propertyType && !nextTypes.includes(propertyType)) {
      setPropertyType("");
    }
  }

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm font-medium text-gray-700">What are you listing?</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="transactionType" className="text-sm font-medium text-gray-700">
              Transaction type
            </label>
            <select
              id="transactionType"
              name="transactionType"
              value={transactionType}
              onChange={(e) => handleTransactionTypeChange(e.target.value as TransactionType)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {TRANSACTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TRANSACTION_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="propertyCategory" className="text-sm font-medium text-gray-700">
              Category
            </label>
            <select
              id="propertyCategory"
              name="propertyCategory"
              value={propertyCategory}
              onChange={(e) => handleCategoryChange(e.target.value as PropertyCategory | "")}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select category</option>
              {availableCategories.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="propertyType" className="text-sm font-medium text-gray-700">
              Property type
            </label>
            <select
              id="propertyType"
              name="propertyType"
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value as PropertyType | "")}
              disabled={!propertyCategory}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="">Select type</option>
              {availableTypes.map((value) => (
                <option key={value} value={value}>
                  {PROPERTY_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

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
        {(!propertyCategory || visibility?.bedBath) && (
          <>
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
          </>
        )}
        <Field
          label="Area (sqft)"
          name="areaSqFt"
          type="number"
          defaultValue={listing?.areaSqFt?.toString()}
        />
      </div>

      {visibility && (visibility.furnishing || visibility.parking || visibility.facing || visibility.availability || visibility.age) && (
        <div className="grid grid-cols-3 gap-4">
          {visibility.furnishing && (
            <div className="flex flex-col gap-1">
              <label htmlFor="furnishing" className="text-sm font-medium text-gray-700">
                Furnishing
              </label>
              <select
                id="furnishing"
                name="furnishing"
                defaultValue={listing?.furnishing ?? ""}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {Object.entries(FURNISHING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {visibility.parking && (
            <Field
              label="Parking spots"
              name="parkingSpots"
              type="number"
              defaultValue={listing?.parkingSpots?.toString()}
            />
          )}
          {visibility.facing && (
            <div className="flex flex-col gap-1">
              <label htmlFor="facing" className="text-sm font-medium text-gray-700">
                Facing
              </label>
              <select
                id="facing"
                name="facing"
                defaultValue={listing?.facing ?? ""}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {Object.entries(FACING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {visibility.availability && (
            <div className="flex flex-col gap-1">
              <label htmlFor="availability" className="text-sm font-medium text-gray-700">
                Availability
              </label>
              <select
                id="availability"
                name="availability"
                defaultValue={listing?.availability ?? ""}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {visibility.age && (
            <Field
              label="Property age (years)"
              name="propertyAgeYears"
              type="number"
              defaultValue={listing?.propertyAgeYears?.toString()}
            />
          )}
        </div>
      )}

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
          value={developerSelection}
          onChange={(e) => setDeveloperSelection(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">None</option>
          {developers.map((dev) => (
            <option key={dev.id} value={dev.id}>
              {dev.developerProfile?.companyName ?? dev.name}
            </option>
          ))}
          <option value={REQUEST_NEW_DEVELOPER_VALUE}>+ Request a new developer</option>
        </select>
      </div>

      {isRequestingNewDeveloper && (
        <div className="flex flex-col gap-4 rounded-lg border border-dashed border-gray-300 p-4">
          <p className="text-sm text-gray-600">
            An admin will review this and create the developer&apos;s account.
          </p>
          <Field
            label="Company name"
            name="requestDeveloperCompanyName"
            errors={state?.errors?.requestDeveloperCompanyName}
          />
          <Field
            label="Contact name"
            name="requestDeveloperContactName"
            errors={state?.errors?.requestDeveloperContactName}
          />
          <Field
            label="Contact email"
            name="requestDeveloperEmail"
            type="email"
            errors={state?.errors?.requestDeveloperEmail}
          />
          <Field label="Contact phone (optional)" name="requestDeveloperPhone" />
        </div>
      )}

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
