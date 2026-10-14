import { requireRole } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getLayoutState } from "@/lib/email/layout-service";
import { PageHeader } from "@/components/admin/AdminUi";
import { LayoutEditor } from "@/components/admin/email/LayoutEditor";

export const dynamic = "force-dynamic";

export default async function EmailLayoutPage() {
  const user = await requireRole("ADMIN");
  const actor = { id: user.id, role: user.role, email: user.email };
  const state = await getLayoutState(actor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Email layout"
        description="One shared layout (logo, content card and footer) wraps every email the platform sends, including templates you create later. Edit it here once and all emails follow."
      />
      <LayoutEditor
        initial={state.settings}
        version={state.version}
        isDefault={state.isDefault}
        updatedBy={state.updatedBy}
        updatedAt={state.updatedAt}
        canEdit={hasPermission(actor, "email.layout")}
      />
    </div>
  );
}
