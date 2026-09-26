"use client";

import { useActionState } from "react";
import type { Commission, CommissionSource } from "@prisma/client";
import { createCommission, updateCommissionStatus, deleteCommission } from "@/lib/actions/commissions";
import type { CommissionFormState, UpdateCommissionStatusState } from "@/lib/validation/commission";

const sourceLabels: Record<CommissionSource, string> = {
  DEVELOPER: "Developer",
  CUSTOMER: "Customer",
};

type ClientCommission = Omit<Commission, "amount"> & { amount: number };

export function CommissionPanel({
  dealId,
  hasDeveloper,
  commissions,
}: {
  dealId: number;
  hasDeveloper: boolean;
  commissions: ClientCommission[];
}) {
  const sources: CommissionSource[] = hasDeveloper ? ["DEVELOPER", "CUSTOMER"] : ["CUSTOMER"];

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Commission</h2>
      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {sources.map((source) => {
          const existing = commissions.find((commission) => commission.source === source);
          return existing ? (
            <ExistingCommissionCard key={source} commission={existing} />
          ) : (
            <NewCommissionForm key={source} dealId={dealId} source={source} />
          );
        })}
      </div>
    </div>
  );
}

function NewCommissionForm({ dealId, source }: { dealId: number; source: CommissionSource }) {
  const action = createCommission.bind(null, dealId, source);
  const [state, formAction, pending] = useActionState<CommissionFormState, FormData>(
    action,
    undefined
  );

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2 rounded-lg border border-dashed border-gray-300 p-4"
    >
      <p className="text-sm font-medium text-gray-900">{sourceLabels[source]} commission</p>
      {state?.message && <p className="text-xs text-red-600">{state.message}</p>}
      <div className="flex flex-col gap-1">
        <label htmlFor={`amount-${source}`} className="text-xs text-gray-500">
          Amount
        </label>
        <input
          id={`amount-${source}`}
          name="amount"
          type="number"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        {state?.errors?.amount && <p className="text-xs text-red-600">{state.errors.amount[0]}</p>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`notes-${source}`} className="text-xs text-gray-500">
          Notes (optional)
        </label>
        <textarea
          id={`notes-${source}`}
          name="notes"
          rows={2}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add commission"}
      </button>
    </form>
  );
}

function ExistingCommissionCard({ commission }: { commission: ClientCommission }) {
  const [state, formAction, pending] = useActionState<UpdateCommissionStatusState, FormData>(
    updateCommissionStatus.bind(null, commission.id),
    undefined
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-medium text-gray-900">
        {sourceLabels[commission.source]} commission
      </p>
      {state?.message && <p className="text-xs text-gray-600">{state.message}</p>}
      <form action={formAction} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`amount-${commission.id}`} className="text-xs text-gray-500">
            Amount
          </label>
          <input
            id={`amount-${commission.id}`}
            name="amount"
            type="number"
            defaultValue={String(commission.amount)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm font-semibold"
          />
          {state?.errors?.amount && (
            <p className="text-xs text-red-600">{state.errors.amount[0]}</p>
          )}
        </div>
        <select
          name="status"
          defaultValue={commission.status}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
        >
          <option value="PENDING">Pending</option>
          <option value="INVOICED">Invoiced</option>
          <option value="RECEIVED">Received</option>
        </select>
        <textarea
          name="notes"
          rows={2}
          defaultValue={commission.notes ?? ""}
          placeholder="Notes"
          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Update"}
        </button>
      </form>
      <form action={deleteCommission.bind(null, commission.id)}>
        <button type="submit" className="text-xs text-red-600 hover:text-red-800">
          Delete
        </button>
      </form>
    </div>
  );
}
