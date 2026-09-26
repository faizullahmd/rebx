import Link from "next/link";
import {
  getPendingDeveloperRequests,
  getResolvedDeveloperRequests,
} from "@/lib/data/developer-requests";
import { approveDeveloperRequest, rejectDeveloperRequest } from "@/lib/actions/developer-requests";

export default async function DeveloperRequestsPage() {
  const [pending, resolved] = await Promise.all([
    getPendingDeveloperRequests(),
    getResolvedDeveloperRequests(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Developer requests</h1>
        <p className="text-gray-600">
          Agents can request a developer account when tagging a company that hasn&apos;t joined
          REBX yet.
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Pending ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">No pending requests.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {pending.map((request) => (
              <div key={request.id} className="rounded-lg border border-gray-200 p-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900">{request.companyName}</p>
                    <p className="text-gray-600">
                      {request.contactName} · {request.contactEmail}
                      {request.contactPhone ? ` · ${request.contactPhone}` : ""}
                    </p>
                    <p className="mt-1 text-gray-500">
                      Requested by {request.requestedBy.name} for{" "}
                      <Link
                        href={`/listings/${request.listing.slug}`}
                        className="underline"
                        target="_blank"
                      >
                        {request.listing.title}
                      </Link>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <form action={approveDeveloperRequest.bind(null, request.id)}>
                      <button
                        type="submit"
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        Approve & create account
                      </button>
                    </form>
                    <RejectForm requestId={request.id} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Recently resolved</h2>
        {resolved.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing resolved yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="py-2 font-medium">Company</th>
                <th className="py-2 font-medium">Listing</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((request) => (
                <tr key={request.id} className="border-b border-gray-100">
                  <td className="py-3">{request.companyName}</td>
                  <td className="py-3 text-gray-600">{request.listing.title}</td>
                  <td className="py-3 text-gray-600">{request.status}</td>
                  <td className="py-3 text-gray-600">
                    {request.reviewedAt
                      ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                          request.reviewedAt
                        )
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RejectForm({ requestId }: { requestId: number }) {
  return (
    <form action={rejectDeveloperRequest.bind(null, requestId)} className="flex flex-col gap-1">
      <input
        name="rejectionReason"
        placeholder="Reason (optional)"
        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        className="rounded-md border border-gray-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
      >
        Reject
      </button>
    </form>
  );
}
