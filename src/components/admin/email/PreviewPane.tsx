"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewResult } from "@/lib/email/template-service";

export type Device = "desktop" | "mobile";

function frameDoc(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0}body{padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#18181b;background:#ffffff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
}

/**
 * Rendered email preview. The iframe has no scripts and no forms (sandbox without
 * allow-scripts), so even unsafe content could not execute; `allow-same-origin` is only used to
 * read the document height. Content here is already sanitized server-side.
 */
export function PreviewPane({
  preview,
  loading,
  error,
  device,
  onDevice,
  to = "sample.recipient@example.com",
}: {
  preview: PreviewResult | null;
  loading: boolean;
  error: string | null;
  device: Device;
  onDevice: (d: Device) => void;
  to?: string;
}) {
  const [tab, setTab] = useState<"html" | "text">("html");
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(360);

  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.min(1400, Math.max(240, doc.documentElement.scrollHeight + 4)));
  };
  useEffect(() => {
    const t = setTimeout(fit, 60);
    return () => clearTimeout(t);
  }, [preview, device, tab]);

  const errors = preview?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === "warning") ?? [];
  const seg = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium ${active ? "bg-gray-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`;

  return (
    <div className="flex flex-col gap-3" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Preview device" className="flex gap-1">
          <button type="button" className={seg(device === "desktop")} aria-pressed={device === "desktop"} onClick={() => onDevice("desktop")}>Desktop</button>
          <button type="button" className={seg(device === "mobile")} aria-pressed={device === "mobile"} onClick={() => onDevice("mobile")}>Mobile</button>
        </div>
        <div role="group" aria-label="Preview format" className="flex gap-1">
          <button type="button" className={seg(tab === "html")} aria-pressed={tab === "html"} onClick={() => setTab("html")}>HTML</button>
          <button type="button" className={seg(tab === "text")} aria-pressed={tab === "text"} onClick={() => setTab("text")}>Plain text</button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {preview && (
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 rounded-md border border-neutral-200 bg-white p-3 text-xs">
          <dt className="text-neutral-500">From</dt><dd className="break-all">{preview.from}</dd>
          <dt className="text-neutral-500">To</dt><dd className="break-all">{to}</dd>
          {preview.replyTo && (<><dt className="text-neutral-500">Reply-to</dt><dd className="break-all">{preview.replyTo}</dd></>)}
          {preview.cc.length > 0 && (<><dt className="text-neutral-500">Cc</dt><dd className="break-all">{preview.cc.join(", ")}</dd></>)}
          {preview.bcc.length > 0 && (<><dt className="text-neutral-500">Bcc</dt><dd className="break-all">{preview.bcc.join(", ")}</dd></>)}
          <dt className="text-neutral-500">Subject</dt><dd className="font-medium text-neutral-900">{preview.subject || <em className="text-neutral-400">(empty)</em>}</dd>
        </dl>
      )}

      <div className={`rounded-lg bg-neutral-100 p-3 ${loading ? "opacity-60" : ""}`}>
        <div className="mx-auto overflow-hidden rounded-md border border-neutral-300 bg-white shadow-sm" style={{ width: device === "mobile" ? 375 : "100%", maxWidth: "100%" }}>
          {!preview ? (
            <p className="p-6 text-center text-sm text-neutral-500">{loading ? "Rendering preview…" : "Nothing to preview yet."}</p>
          ) : tab === "html" ? (
            <iframe
              ref={frame}
              title="Email preview"
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              srcDoc={frameDoc(preview.html)}
              onLoad={fit}
              style={{ width: "100%", height, border: 0, display: "block" }}
            />
          ) : (
            <div className="p-4">
              {preview.textIsGenerated && <p className="mb-2 text-[11px] text-amber-700">No plain-text version is set, so none will be sent. This is what one generated from the HTML would look like.</p>}
              <pre className="whitespace-pre-wrap break-words text-xs text-neutral-800">{preview.text}</pre>
            </div>
          )}
        </div>
      </div>

      {preview && (errors.length > 0 || warnings.length > 0 || preview.warnings.length > 0) && (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Preview issues">
          {errors.map((i, n) => <li key={`e${n}`} className="rounded bg-red-50 px-2 py-1 text-red-700">✕ {i.message}</li>)}
          {preview.warnings.map((w, n) => <li key={`w${n}`} className="rounded bg-amber-50 px-2 py-1 text-amber-800">⚠ {w}</li>)}
          {warnings.map((i, n) => <li key={`x${n}`} className="rounded bg-amber-50 px-2 py-1 text-amber-800">⚠ {i.message}</li>)}
        </ul>
      )}
    </div>
  );
}
