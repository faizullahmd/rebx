"use client";

import { useRef, useState, useTransition } from "react";
import { sendTestEmailAction } from "@/lib/actions/email-templates";

/**
 * Modal for sending a clearly-labelled test email. Reused by the list (tests the published
 * version) and the editor (tests the content currently on screen, unsaved edits included).
 */
export function TestEmailDialog({
  templateId,
  label = "Test email",
  getFields,
  getData,
  className,
  disabled,
}: {
  templateId: number;
  label?: string;
  getFields?: () => Record<string, unknown>;
  getData?: () => Record<string, string>;
  className?: string;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [recipient, setRecipient] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const open = () => {
    setResult(null);
    setNeedsConfirm(false);
    setConfirmed(false);
    dialog.current?.showModal();
  };

  const send = () => {
    setResult(null);
    start(async () => {
      const res = await sendTestEmailAction(templateId, {
        recipient,
        fields: getFields?.(),
        data: getData?.(),
        confirmAccountRecipient: confirmed,
      });
      if (!res.ok && /belongs to a/.test(res.message)) setNeedsConfirm(true);
      setResult({ ok: res.ok, message: res.ok ? (res.message ?? "Sent.") : res.message });
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={disabled}
        className={className ?? "rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`test-title-${templateId}`}
        className="m-auto w-full max-w-md rounded-xl border border-neutral-200 p-0 shadow-xl backdrop:bg-black/40"
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) send();
          }}
          className="flex flex-col gap-4 p-6"
        >
          <div>
            <h2 id={`test-title-${templateId}`} className="text-lg font-semibold">Send a test email</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Uses sample data, is labelled [TEST], and never triggers a real action. Links in test emails point to example.com.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Recipient
            <input
              type="email"
              required
              autoFocus
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="you@yourcompany.com"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal"
            />
          </label>
          {needsConfirm && (
            <label className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
              This address belongs to a real user account. I understand and want to send the test there.
            </label>
          )}
          {result && (
            <p role="status" className={`rounded-md px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
              {result.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">
              Close
            </button>
            <button
              type="submit"
              disabled={pending || (needsConfirm && !confirmed)}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send test"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
