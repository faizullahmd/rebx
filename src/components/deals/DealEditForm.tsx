"use client";

import { useActionState } from "react";
import type { Deal } from "@prisma/client";
import { DEAL_STAGES, type UpdateDealState } from "@/lib/validation/deal";

const stageLabels: Record<(typeof DEAL_STAGES)[number], string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  VIEWING_SCHEDULED: "Viewing scheduled",
  OFFER_MADE: "Offer made",
  NEGOTIATION: "Negotiation",
  UNDER_CONTRACT: "Under contract",
  CLOSED_WON: "Closed won",
  CLOSED_LOST: "Closed lost",
};

export function DealEditForm({
  deal,
  action,
}: {
  deal: Deal;
  action: (state: UpdateDealState, formData: FormData) => Promise<UpdateDealState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      {state?.message && (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{state.message}</p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="stage" className="text-sm font-medium text-gray-700">
          Stage
        </label>
        <select
          id="stage"
          name="stage"
          defaultValue={deal.stage}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {DEAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {stageLabels[stage]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="offerAmount" className="text-sm font-medium text-gray-700">
          Offer amount
        </label>
        <input
          id="offerAmount"
          name="offerAmount"
          type="number"
          defaultValue={deal.offerAmount ? String(deal.offerAmount) : undefined}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {state?.errors?.offerAmount && (
          <ul className="text-xs text-red-600">
            {state.errors.offerAmount.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium text-gray-700">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={deal.notes ?? ""}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

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
