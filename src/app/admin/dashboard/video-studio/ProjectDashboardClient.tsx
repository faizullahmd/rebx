"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIO_CONFIG,
  CONTENT_CATEGORY_LABELS,
  RENDER_JOB_STATUS_LABELS,
  STATUS_LABELS,
  type AspectRatio,
  type ContentCategory,
  type ProjectStatus,
  type RenderJobStatus,
} from "@/lib/video-studio/schemas";
import { deleteProjectAction, duplicateProjectAction } from "@/lib/actions/video-studio";

type ProjectRow = {
  id: string;
  schemaVersion: string;
  title: string;
  topic: string;
  category: ContentCategory;
  aspectRatio: AspectRatio;
  dimensions: string;
  targetAudience: string;
  language: string;
  tone: string;
  status: ProjectStatus;
  sceneCount: number;
  duration: number;
  thumbnail: string | null;
  latestRenderJob?: {
    id: string;
    status: RenderJobStatus;
    progress: number;
    outputStorageKey?: string | null;
    createdAt: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
};

type Props = {
  counts: {
    total: number;
    draft: number;
    processing: number;
    completed: number;
    failed: number;
  };
  projects: ProjectRow[];
  currentStatus: string;
  currentSort: "updated" | "created";
  searchQuery: string;
};

export default function ProjectDashboardClient({
  counts,
  projects,
  currentStatus,
  currentSort,
  searchQuery,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const statusTabs = [
    { label: "All", value: "ALL", count: counts.total },
    { label: "Drafts", value: "DRAFT", count: counts.draft },
    { label: "Processing", value: "PROCESSING", count: counts.processing },
    { label: "Completed", value: "COMPLETED", count: counts.completed },
    { label: "Failed", value: "FAILED", count: counts.failed },
  ];

  function handleFilter(statusValue: string) {
    const params = new URLSearchParams(window.location.search);
    if (statusValue && statusValue !== "ALL") {
      params.set("status", statusValue);
    } else {
      params.delete("status");
    }
    router.push(`?${params.toString()}`);
  }

  function handleSort(sortValue: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("sort", sortValue);
    router.push(`?${params.toString()}`);
  }

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = (fd.get("q") as string) || "";
    const params = new URLSearchParams(window.location.search);
    if (q.trim()) {
      params.set("q", q.trim());
    } else {
      params.delete("q");
    }
    router.push(`?${params.toString()}`);
  }

  async function handleDuplicate(id: string) {
    setBusyId(id);
    setFeedback(null);
    const res = await duplicateProjectAction(id);
    setBusyId(null);
    if (!res.ok) {
      setFeedback({ type: "error", message: res.error });
      return;
    }
    setFeedback({ type: "success", message: "Project duplicated successfully." });
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setFeedback(null);
    const res = await deleteProjectAction(id);
    setBusyId(null);
    setDeleteConfirmId(null);
    if (!res.ok) {
      setFeedback({ type: "error", message: res.error });
      return;
    }
    setFeedback({ type: "success", message: "Project deleted successfully." });
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">AI Video Studio</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Create, script, manage and edit short-form real estate video projects.
          </p>
        </div>
        <Link
          href="/admin/dashboard/video-studio/new"
          className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create New Project
        </Link>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ${
            feedback.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total Videos</span>
          <p className="mt-1.5 text-3xl font-bold text-neutral-900">{counts.total}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">Drafts</span>
          <p className="mt-1.5 text-3xl font-bold text-neutral-900">{counts.draft}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-amber-600">Processing</span>
          <p className="mt-1.5 text-3xl font-bold text-amber-700">{counts.processing}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-emerald-600">Completed</span>
          <p className="mt-1.5 text-3xl font-bold text-emerald-700">{counts.completed}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-xs">
          <span className="text-xs font-medium uppercase tracking-wider text-red-600">Failed</span>
          <p className="mt-1.5 text-3xl font-bold text-red-700">{counts.failed}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-4">
          {/* Status Tabs */}
          <nav className="flex flex-wrap gap-1">
            {statusTabs.map((t) => {
              const active = (currentStatus || "ALL") === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleFilter(t.value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                  }`}
                >
                  {t.label} <span className="ml-1 opacity-60">({t.count})</span>
                </button>
              );
            })}
          </nav>

          {/* Search & Sort Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="sortSelect" className="text-xs font-medium text-neutral-500">
                Sort:
              </label>
              <select
                id="sortSelect"
                value={currentSort}
                onChange={(e) => handleSort(e.target.value)}
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
              >
                <option value="updated">Recently updated</option>
                <option value="created">Recently created</option>
              </select>
            </div>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                name="q"
                defaultValue={searchQuery}
                placeholder="Search by title..."
                className="w-48 sm:w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Search
              </button>
            </form>
          </div>
        </div>

        {/* Projects List */}
        {projects.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-neutral-900">No video projects found</h3>
            <p className="mt-1 text-xs text-neutral-500">
              Get started by creating your first video project from a custom script or REBX listing.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/dashboard/video-studio/new"
                className="rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-neutral-800"
              >
                Create Project
              </Link>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {projects.map((p) => {
              const status = p.status;
              const statusPill =
                status === "COMPLETED"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : status === "PROCESSING"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : status === "FAILED"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-neutral-100 text-neutral-700 border-neutral-200";

              return (
                <li key={p.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between hover:bg-neutral-50/70 transition">
                  {/* Left: Thumbnail & Project Meta */}
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center">
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-neutral-400">
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/dashboard/video-studio/${p.id}`}
                          className="font-semibold text-neutral-900 hover:text-neutral-700 truncate"
                        >
                          {p.title}
                        </Link>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusPill}`}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                        <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                          {p.aspectRatio} · {p.dimensions}
                        </span>
                        {p.latestRenderJob && (
                          <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                            Render: {RENDER_JOB_STATUS_LABELS[p.latestRenderJob.status] ?? p.latestRenderJob.status} ({p.latestRenderJob.progress}%)
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        <span>{CONTENT_CATEGORY_LABELS[p.category] ?? p.category}</span>
                        <span>•</span>
                        <span>{p.sceneCount} scene{p.sceneCount === 1 ? "" : "s"}</span>
                        <span>•</span>
                        <span>{p.duration}s</span>
                        <span>•</span>
                        <span>Language: {p.language}</span>
                        <span>•</span>
                        <span>
                          Updated{" "}
                          {new Date(p.updatedAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {p.latestRenderJob?.status === "COMPLETED" && p.latestRenderJob.outputStorageKey && (
                      <a
                        href={`/api/admin/video-studio/render-jobs/${encodeURIComponent(p.latestRenderJob.id)}/video?download=1`}
                        download
                        className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition"
                      >
                        Download MP4
                      </a>
                    )}
                    <Link
                      href={`/admin/dashboard/video-studio/${p.id}`}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition"
                    >
                      Open & Edit
                    </Link>

                    <button
                      type="button"
                      disabled={busyId === p.id}
                      onClick={() => handleDuplicate(p.id)}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition disabled:opacity-50"
                    >
                      {busyId === p.id ? "Duplicating..." : "Duplicate"}
                    </button>

                    {deleteConfirmId === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id)}
                          disabled={busyId === p.id}
                          className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(p.id)}
                        className="rounded-lg border border-neutral-200 p-1.5 text-neutral-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition"
                        title="Delete project"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

