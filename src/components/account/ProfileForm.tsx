"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import { updateProfile } from "@/lib/actions/account";
import type { ProfileFormState } from "@/lib/validation/account";
import type { Role, AgentProfile, DeveloperProfile, CustomerProfile } from "@prisma/client";

export function ProfileForm({
  role,
  name,
  email,
  username: initialUsername = "",
  agentProfile,
  developerProfile,
  customerProfile,
}: {
  role: Role;
  name: string;
  email: string;
  username?: string | null;
  agentProfile: AgentProfile | null;
  developerProfile: DeveloperProfile | null;
  customerProfile: CustomerProfile | null;
}) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    updateProfile,
    undefined
  );

  const [username, setUsername] = useState(initialUsername ?? "");
  const [availability, setAvailability] = useState<{
    status: "idle" | "checking" | "available" | "current" | "taken" | "invalid";
    message?: string;
  }>({
    status: initialUsername ? "current" : "idle",
    message: initialUsername ? "This is your current username." : undefined,
  });

  const checkTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const trimmed = username.trim().toLowerCase();

    if (!trimmed) {
      setAvailability({ status: "idle" });
      return;
    }

    if (initialUsername && trimmed === initialUsername.toLowerCase()) {
      setAvailability({ status: "current", message: "This is your current username." });
      return;
    }

    setAvailability({ status: "checking", message: "Checking availability…" });

    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
    }

    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/username/check?value=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (data.state === "available" || data.state === "current") {
          setAvailability({ status: data.state, message: data.message || "✓ Available" });
        } else if (data.state === "taken") {
          setAvailability({ status: "taken", message: data.error || "✗ Username is already taken" });
        } else {
          setAvailability({ status: "invalid", message: data.error || "✗ Invalid username format" });
        }
      } catch {
        setAvailability({ status: "idle" });
      }
    }, 500);

    return () => {
      if (checkTimerRef.current) {
        clearTimeout(checkTimerRef.current);
      }
    };
  }, [username, initialUsername]);

  const hasUsernameChanged =
    Boolean(initialUsername) &&
    username.trim().toLowerCase() !== initialUsername?.toLowerCase();

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

      {/* Username field (required for Agents and Developers) */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3.5">
        <div className="flex items-center justify-between">
          <label htmlFor="username" className="text-sm font-medium text-gray-900">
            Username <span className="text-red-500">*</span>
          </label>
          {availability.status === "checking" && (
            <span className="text-xs text-neutral-500 animate-pulse">Checking…</span>
          )}
          {availability.status === "available" && (
            <span className="text-xs font-medium text-emerald-600">✓ Available</span>
          )}
          {availability.status === "current" && (
            <span className="text-xs font-medium text-neutral-500">Current</span>
          )}
          {availability.status === "taken" && (
            <span className="text-xs font-medium text-red-600">✗ Already taken</span>
          )}
          {availability.status === "invalid" && (
            <span className="text-xs font-medium text-red-600">✗ Invalid format</span>
          )}
        </div>

        <input
          id="username"
          name="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          placeholder="your-username"
          required={role === "AGENT" || role === "DEVELOPER"}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono lowercase"
        />

        <p className="text-xs text-neutral-500">
          This is your public portfolio URL:{" "}
          <span className="font-mono font-medium text-neutral-700">
            rebx.app/portfolio/{username.trim() ? username.trim().toLowerCase() : "your-username"}
          </span>
        </p>

        {availability.message && availability.status !== "idle" && (
          <p
            className={`text-xs ${
              availability.status === "available" || availability.status === "current"
                ? "text-emerald-700"
                : availability.status === "checking"
                  ? "text-neutral-500"
                  : "text-red-600"
            }`}
          >
            {availability.message}
          </p>
        )}

        {hasUsernameChanged && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            ⚠️ <strong>Warning:</strong> Changing your username will permanently break your previous portfolio link.
          </p>
        )}

        {state?.errors?.username && (
          <ul className="text-xs text-red-600">
            {state.errors.username.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>

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
        disabled={pending || availability.status === "taken" || availability.status === "invalid"}
        className="mt-1 w-fit rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
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

