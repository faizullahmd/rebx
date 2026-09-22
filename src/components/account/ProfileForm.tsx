"use client";

import { useActionState } from "react";
import { updateProfile } from "@/lib/actions/account";
import type { ProfileFormState } from "@/lib/validation/account";
import type { Role, AgentProfile, DeveloperProfile, CustomerProfile } from "@prisma/client";

export function ProfileForm({
  role,
  name,
  email,
  agentProfile,
  developerProfile,
  customerProfile,
}: {
  role: Role;
  name: string;
  email: string;
  agentProfile: AgentProfile | null;
  developerProfile: DeveloperProfile | null;
  customerProfile: CustomerProfile | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    updateProfile,
    undefined
  );

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{state.message}</p>
      )}

      <Field label="Name" name="name" defaultValue={name} errors={state?.errors?.name} />
      <Field
        label="Email"
        name="email"
        type="email"
        defaultValue={email}
        errors={state?.errors?.email}
      />

      {role === "AGENT" && (
        <>
          <Field
            label="Agency name"
            name="agencyName"
            defaultValue={agentProfile?.agencyName ?? ""}
          />
          <Field
            label="License number"
            name="licenseNo"
            defaultValue={agentProfile?.licenseNo ?? ""}
          />
          <Field label="Phone" name="phone" defaultValue={agentProfile?.phone ?? ""} />
          <div className="flex flex-col gap-1">
            <label htmlFor="bio" className="text-sm font-medium text-gray-700">
              Bio
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={3}
              defaultValue={agentProfile?.bio ?? ""}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </>
      )}

      {role === "DEVELOPER" && (
        <>
          <Field
            label="Company name"
            name="companyName"
            defaultValue={developerProfile?.companyName ?? ""}
          />
          <Field label="Phone" name="phone" defaultValue={developerProfile?.phone ?? ""} />
          <Field label="Website" name="website" defaultValue={developerProfile?.website ?? ""} />
        </>
      )}

      {role === "CUSTOMER" && (
        <Field label="Phone" name="phone" defaultValue={customerProfile?.phone ?? ""} />
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save changes"}
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
