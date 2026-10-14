"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreVersionAction } from "@/lib/actions/email-templates";

export function RestoreButton({
  templateId,
  version,
  currentVersion,
}: {
  templateId: number;
  version: number;
  currentVersion: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const restore = () =>
    start(async () => {
      const res = await restoreVersionAction(templateId, version, currentVersion, summary);
      setResult({ ok: res.ok, message: res.ok ? (res.message ?? "Restored.") : res.message });
      if (res.ok) {
        dialog.current?.close();
        router.refresh();
      }
    });

  return (
    <>
      <button type="button" onClick={() => { setResult(null); dialog.current?.showModal(); }} className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium hover:bg-gray-50">
        Restore
      </button>
      <dialog ref={dialog} aria-labelledby={`restore-${version}`} className="m-auto w-full max-w-md rounded-xl border border-neutral-200 p-0 shadow-xl backdrop:bg-black/40">
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id={`restore-${version}`} className="text-lg font-semibold">Restore version {version}?</h2>
            <p className="mt-1 text-sm text-neutral-500">
              This publishes the content of version {version} as a <strong>new version {currentVersion + 1}</strong>, so production uses it right away. Any unpublished draft is discarded. Nothing is deleted from history.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            Note (optional)
            <input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={300} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" placeholder={`Restored version ${version}.`} />
          </label>
          {result && !result.ok && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Cancel</button>
            <button type="button" disabled={pending} onClick={restore} className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {pending ? "Restoring…" : "Restore and publish"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
