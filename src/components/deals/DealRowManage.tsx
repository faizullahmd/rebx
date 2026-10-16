"use client";

import { useActionState } from "react";
import { updateDeal } from "@/lib/actions/deals";
import { DEAL_STAGES, DEAL_STAGE_LABELS, type UpdateDealState } from "@/lib/validation/deal";

// Quick-manage form for one row of the agent's deals list. It calls the same updateDeal action
// as the full deal page, so closing a deal (booking, listing status, emails) behaves identically.
export function DealRowManage({
  dealId,
  stage,
  offerAmount,
  notes,
}: {
  dealId: number;
  stage: string;
  offerAmount: number | null;
  notes: string | null;
}) {
  const [state, formAction, pending] = useActionState<UpdateDealState, FormData>(
    updateDeal.bind(null, dealId),
    undefined
  );
  const field =
    "w-full min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

  return (
    <form action={formAction} className="flex flex-col gap-1.5">
      <select name="stage" defaultValue={stage} aria-label="Stage" className={field}>
        {DEAL_STAGES.map((s) => (
          <option key={s} value={s}>
            {DEAL_STAGE_LABELS[s]}
          </option>
        ))}
      </select>
      <input
        name="offerAmount"
        type="number"
        step="any"
        min="0"
        defaultValue={offerAmount ? String(offerAmount) : ""}
        placeholder="Offer amount"
        aria-label="Offer amount"
        className={field}
      />
      <input name="notes" defaultValue={notes ?? ""} placeholder="Notes" aria-label="Notes" className={field} />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.message && (
          <span role="status" className={`text-xs ${state.message === "Deal updated." ? "text-green-700" : "text-red-600"}`}>
            {state.message}
          </span>
        )}
      </div>
      {state?.errors?.offerAmount?.map((m) => (
        <p key={m} className="text-xs text-red-600">{m}</p>
      ))}
    </form>
  );
}
