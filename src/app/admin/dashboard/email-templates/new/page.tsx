import Link from "next/link";
import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/admin/AdminUi";
import { NewTemplateForm } from "@/components/admin/email/NewTemplateForm";

export default async function NewEmailTemplatePage() {
  await requireRole("ADMIN");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/dashboard/email-templates" className="text-sm text-neutral-500 hover:text-neutral-900">← Back to templates</Link>
      </div>
      <PageHeader title="New email template" description="Start with the basics. You'll design the content in the editor next." />
      <NewTemplateForm />
    </div>
  );
}
