"use client";

import { useActionState, useEffect, useState } from "react";
import type {
  Listing,
  ListingImage,
  TransactionType,
  PropertyCategory,
  PropertyType,
} from "@prisma/client";
import type { ListingFormState } from "@/lib/validation/listing";
import { REQUEST_NEW_DEVELOPER_VALUE } from "@/lib/validation/developer-request";
import { ImageUploader } from "@/components/listings/ImageUploader";
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
type ListingWithImages = Omit<Listing, "price"> & { price: number; images: ListingImage[] };

const STEPS = ["What are you listing", "Location", "Details & attributes", "Photos", "Title & review"];

const FIELD_STEP: Record<string, number> = {
  transactionType: 0,
  propertyCategory: 0,
  propertyType: 0,
  addressLine: 1,
  city: 1,
  state: 1,
  country: 1,
  postalCode: 1,
  price: 2,
  currency: 2,
  bedrooms: 2,
  bathrooms: 2,
  areaSqFt: 2,
  furnishing: 2,
  parkingSpots: 2,
  facing: 2,
  propertyAgeYears: 2,
  availability: 2,
  status: 2,
  developerId: 2,
  requestDeveloperCompanyName: 2,
  requestDeveloperContactName: 2,
  requestDeveloperEmail: 2,
  requestDeveloperPhone: 2,
  imageUrls: 3,
  title: 4,
  description: 4,
};

function initialValues(listing?: ListingWithImages) {
  return {
    title: listing?.title ?? "",
    description: listing?.description ?? "",
    price: listing ? String(listing.price) : "",
    currency: listing?.currency ?? "USD",
    addressLine: listing?.addressLine ?? "",
    city: listing?.city ?? "",
    state: listing?.state ?? "",
    country: listing?.country ?? "",
    postalCode: listing?.postalCode ?? "",
    bedrooms: listing?.bedrooms?.toString() ?? "",
    bathrooms: listing?.bathrooms?.toString() ?? "",
    areaSqFt: listing?.areaSqFt?.toString() ?? "",
    furnishing: listing?.furnishing ?? "",
    parkingSpots: listing?.parkingSpots?.toString() ?? "",
    facing: listing?.facing ?? "",
    propertyAgeYears: listing?.propertyAgeYears?.toString() ?? "",
    availability: listing?.availability ?? "",
    status: listing?.status ?? "DRAFT",
    requestDeveloperCompanyName: "",
    requestDeveloperContactName: "",
    requestDeveloperEmail: "",
    requestDeveloperPhone: "",
  };
}

type Values = ReturnType<typeof initialValues>;

export function ListingForm({
  action,
  listing,
  developers,
  submitLabel,
}: {
  action: (state: ListingFormState, formData: FormData) => Promise<ListingFormState>;
  listing?: ListingWithImages;
  developers: Developer[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [step, setStep] = useState(0);
  const [developerSelection, setDeveloperSelection] = useState(listing?.developerId ?? "");
  const isRequestingNewDeveloper = developerSelection === REQUEST_NEW_DEVELOPER_VALUE;

  const [transactionType, setTransactionType] = useState<TransactionType>(
    listing?.transactionType ?? "FOR_SALE"
  );
  const [propertyCategory, setPropertyCategory] = useState<PropertyCategory | "">(
    listing?.propertyCategory ?? ""
  );
  const [propertyType, setPropertyType] = useState<PropertyType | "">(listing?.propertyType ?? "");

  // React 19 resets uncontrolled <form> fields after every action call — including a
  // validation failure that just returns error state, not only on a real success. Since the
  // wizard keeps every step's fields mounted in one shared form, an error on step 2 would
  // otherwise silently wipe whatever the agent already typed on steps 1, 3, and 5. Keeping
  // values here (instead of defaultValue) makes them immune to that reset.
  const [values, setValues] = useState<Values>(() => initialValues(listing));

  function setField<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const availableCategories = categoriesFor(transactionType);
  const availableTypes = typesFor(transactionType, propertyCategory);
  const visibility = propertyCategory ? FIELD_VISIBILITY[propertyCategory] : null;

  useEffect(() => {
    if (!state?.errors) return;
    const erroredFields = Object.keys(state.errors);
    if (erroredFields.length === 0) return;
    const earliestStep = Math.min(...erroredFields.map((field) => FIELD_STEP[field] ?? 0));
    setStep(earliestStep);
  }, [state]);

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

  function stepClass(index: number) {
    return step === index ? "flex flex-col gap-4" : "hidden";
  }

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>
      )}

      <ol className="flex items-center gap-2">
        {STEPS.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => setStep(index)}
              className="flex items-center gap-2 text-left"
            >
              <span
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-semibold ${
                  index === step
                    ? "bg-gray-900 text-white"
                    : index < step
                      ? "bg-gray-200 text-gray-700"
                      : "border border-gray-300 text-gray-400"
                }`}
              >
                {index + 1}
              </span>
              <span
                className={`hidden text-xs font-medium sm:inline ${
                  index === step ? "text-gray-900" : "text-gray-400"
                }`}
              >
                {label}
              </span>
            </button>
            {index < STEPS.length - 1 && <span className="h-px flex-1 bg-gray-200" />}
          </li>
        ))}
      </ol>

      {/* Step 1: What are you listing */}
      <div className={stepClass(0)}>
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

      {/* Step 2: Location */}
      <div className={stepClass(1)}>
        <Field
          label="Address"
          name="addressLine"
          value={values.addressLine}
          onChange={(v) => setField("addressLine", v)}
          errors={state?.errors?.addressLine}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="City"
            name="city"
            value={values.city}
            onChange={(v) => setField("city", v)}
            errors={state?.errors?.city}
          />
          <Field
            label="State / region"
            name="state"
            value={values.state}
            onChange={(v) => setField("state", v)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Country"
            name="country"
            value={values.country}
            onChange={(v) => setField("country", v)}
            errors={state?.errors?.country}
          />
          <Field
            label="Postal code"
            name="postalCode"
            value={values.postalCode}
            onChange={(v) => setField("postalCode", v)}
          />
        </div>
      </div>

      {/* Step 3: Details & attributes */}
      <div className={stepClass(2)}>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Price"
            name="price"
            type="number"
            value={values.price}
            onChange={(v) => setField("price", v)}
            errors={state?.errors?.price}
          />
          <Field
            label="Currency"
            name="currency"
            value={values.currency}
            onChange={(v) => setField("currency", v)}
            errors={state?.errors?.currency}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {(!propertyCategory || visibility?.bedBath) && (
            <>
              <Field
                label="Bedrooms"
                name="bedrooms"
                type="number"
                value={values.bedrooms}
                onChange={(v) => setField("bedrooms", v)}
              />
              <Field
                label="Bathrooms"
                name="bathrooms"
                type="number"
                value={values.bathrooms}
                onChange={(v) => setField("bathrooms", v)}
              />
            </>
          )}
          <Field
            label="Area (sqft)"
            name="areaSqFt"
            type="number"
            value={values.areaSqFt}
            onChange={(v) => setField("areaSqFt", v)}
          />
        </div>

        {visibility &&
          (visibility.furnishing || visibility.parking || visibility.facing || visibility.availability || visibility.age) && (
            <div className="grid grid-cols-3 gap-4">
              {visibility.furnishing && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="furnishing" className="text-sm font-medium text-gray-700">
                    Furnishing
                  </label>
                  <select
                    id="furnishing"
                    name="furnishing"
                    value={values.furnishing}
                    onChange={(e) => setField("furnishing", e.target.value as Values["furnishing"])}
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
                  value={values.parkingSpots}
                  onChange={(v) => setField("parkingSpots", v)}
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
                    value={values.facing}
                    onChange={(e) => setField("facing", e.target.value as Values["facing"])}
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
                    value={values.availability}
                    onChange={(e) => setField("availability", e.target.value as Values["availability"])}
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
                  value={values.propertyAgeYears}
                  onChange={(v) => setField("propertyAgeYears", v)}
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
            value={values.status}
            onChange={(e) => setField("status", e.target.value as Values["status"])}
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
              value={values.requestDeveloperCompanyName}
              onChange={(v) => setField("requestDeveloperCompanyName", v)}
              errors={state?.errors?.requestDeveloperCompanyName}
            />
            <Field
              label="Contact name"
              name="requestDeveloperContactName"
              value={values.requestDeveloperContactName}
              onChange={(v) => setField("requestDeveloperContactName", v)}
              errors={state?.errors?.requestDeveloperContactName}
            />
            <Field
              label="Contact email"
              name="requestDeveloperEmail"
              type="email"
              value={values.requestDeveloperEmail}
              onChange={(v) => setField("requestDeveloperEmail", v)}
              errors={state?.errors?.requestDeveloperEmail}
            />
            <Field
              label="Contact phone (optional)"
              name="requestDeveloperPhone"
              value={values.requestDeveloperPhone}
              onChange={(v) => setField("requestDeveloperPhone", v)}
            />
          </div>
        )}
      </div>

      {/* Step 4: Photos */}
      <div className={stepClass(3)}>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Photos</label>
          <ImageUploader name="imageUrls" initialImages={listing?.images.map((img) => img.url) ?? []} />
        </div>
      </div>

      {/* Step 5: Title, description & review */}
      <div className={stepClass(4)}>
        <Field
          label="Title"
          name="title"
          value={values.title}
          onChange={(v) => setField("title", v)}
          errors={state?.errors?.title}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="description" className="text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={4}
            value={values.description}
            onChange={(e) => setField("description", e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          {state?.errors?.description && <FieldError messages={state.errors.description} />}
        </div>

        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">
          {[
            propertyType ? PROPERTY_TYPE_LABELS[propertyType] : null,
            propertyCategory ? CATEGORY_LABELS[propertyCategory] : null,
            TRANSACTION_LABELS[transactionType],
            values.price ? `${values.currency} ${values.price}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="mt-2 flex items-center justify-between">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back
          </button>
        ) : (
          <span />
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Next
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
  errors,
}: {
  label: string;
  name: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
