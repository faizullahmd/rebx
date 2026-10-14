"use client";

import { useEffect, useRef, useState } from "react";
import { previewTemplateAction } from "@/lib/actions/email-templates";
import { sampleDataFor, variablesForTemplate } from "@/lib/email/definitions";
import { analyseContent } from "@/lib/email/analysis";
import type { PreviewResult } from "@/lib/email/template-service";
import { PreviewPane, type Device } from "@/components/admin/email/PreviewPane";
import { SampleDataEditor } from "@/components/admin/email/SampleDataEditor";
import { TestEmailDialog } from "@/components/admin/email/TestEmailDialog";

/** Read-only preview of a template's current content with an editable sample-data panel. */
export function PreviewPageClient({
  templateId,
  templateKey,
  fields,
  canTest,
}: {
  templateId: number;
  templateKey: string;
  fields: Record<string, unknown>;
  canTest: boolean;
}) {
  const [sample, setSample] = useState<Record<string, string>>(() => sampleDataFor(variablesForTemplate(templateKey)));
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const used = new Set(
    analyseContent({
      key: templateKey,
      subject: String(fields.subject ?? ""),
      htmlBody: String(fields.htmlBody ?? ""),
      textBody: (fields.textBody as string | null) ?? null,
    }).used
  );
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await previewTemplateAction(templateId, fields, sample);
      if (id !== seq.current) return;
      setLoading(false);
      if (res.ok) { setPreview(res.preview); setError(null); } else setError(res.message);
    }, 300);
    return () => clearTimeout(t);
  }, [templateId, fields, sample]);

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Sample data">
        <h2 className="text-sm font-semibold">Sample data</h2>
        <SampleDataEditor templateKey={templateKey} data={sample} onChange={setSample} only={used} />
        {canTest && <TestEmailDialog templateId={templateId} label="Send test email" getData={() => sampleRef.current} className="mt-2 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50" />}
      </aside>
      <section aria-label="Preview">
        <PreviewPane preview={preview} loading={loading} error={error} device={device} onDevice={setDevice} />
      </section>
    </div>
  );
}
