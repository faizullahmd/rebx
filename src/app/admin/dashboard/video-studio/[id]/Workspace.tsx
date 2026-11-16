"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_CONFIG,
  CAMERA_MOTION_EFFECTS,
  CAMERA_MOTION_EFFECT_LABELS,
  CAMERA_MOTION_INTENSITIES,
  CAMERA_MOTION_INTENSITY_LABELS,
  FOCAL_POSITIONS,
  FOCAL_POSITION_LABELS,
  CONTENT_CATEGORY_LABELS,
  PROJECT_STATUSES,
  RENDER_JOB_STATUS_LABELS,
  SARVAM_AUDIO_FORMATS,
  SARVAM_LANGUAGES,
  SARVAM_MAX_NARRATION_CHARS,
  SARVAM_VOICES,
  STATUS_LABELS,
  DEFAULT_WATERMARK_CONFIG,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_LABELS,
  WATERMARK_SIZES,
  WATERMARK_SIZE_LABELS,
  resolveSarvamLanguageCode,
  resolveSceneCameraMotion,
  type AspectRatio,
  type CameraMotionEffect,
  type CameraMotionIntensity,
  type FocalPosition,
  type ContentCategory,
  type EditorScene,
  type Language,
  type ProjectStatus,
  type ProjectThumbnailMetadata,
  type RenderJobStatus,
  type RenderJobSummary,
  type RenderValidationReport,
  type SarvamAudioFormat,
  type SceneCameraMotion,
  type Tone,
  type VersionedProjectJson,
  type WatermarkConfig,
  type WatermarkPosition,
  type WatermarkSize,
} from "@/lib/video-studio/schemas";
import {
  canCancelRenderJob,
  canRetryRenderJob,
  validateProjectForRender,
} from "@/lib/video-studio/render-validation";
import {
  buildVersionedProjectJson,
  countWords,
  estimateDurationSec,
  getProjectWarnings,
  hashNarrationText,
  newTempId,
  totalDuration,
} from "@/lib/video-studio/script-utils";
import {
  cancelRenderJobAction,
  checkSarvamStatusAction,
  createRenderJobAction,
  deleteProjectAction,
  deleteSceneAudioAction,
  deleteSceneImageAction,
  duplicateProjectAction,
  generateSceneVoiceoverAction,
  getRenderJobAction,
  listRenderJobsAction,
  removeProjectThumbnailAction,
  restoreVersionAction,
  retryRenderJobAction,
  saveDraftAction,
  syncProjectAudioTimingAction,
  updateProjectStatusAction,
  uploadProjectThumbnailAction,
  uploadSceneAudioAction,
  uploadSceneImageAction,
  validateProjectRenderReadinessAction,
} from "@/lib/actions/video-studio";
import type { ProjectVersionSummary } from "@/lib/data/video-studio";

type Props = {
  project: {
    id: string;
    schemaVersion: string;
    title: string;
    topic: string;
    category: ContentCategory;
    status: ProjectStatus;
    aspectRatio: AspectRatio;
    dimensions: string;
    targetAudience: string;
    language: Language;
    tone: Tone;
    desiredDuration: number;
    customThumbnail?: ProjectThumbnailMetadata | null;
    thumbnailPrompt?: string;
    defaultCameraMotion?: SceneCameraMotion;
    watermark?: WatermarkConfig;
    createdAt: Date;
    updatedAt: Date;
  };
  initialScenes: EditorScene[];
  versionedJson?: VersionedProjectJson;
  initialVersions: ProjectVersionSummary[];
  initialRenderJobs?: RenderJobSummary[];
};

type BulkUploadProgress = {
  active: boolean;
  completed: number;
  total: number;
  currentFileName: string;
  currentSceneTitle: string;
  assignedCount: number;
  failures: { fileName: string; sceneTitle: string; error: string }[];
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/webm",
]);

function isTempSceneId(sceneId: string): boolean {
  return sceneId.startsWith("scene_") || sceneId.startsWith("init_") || sceneId.startsWith("restored_");
}

function validateAudioFile(file: File): string | null {
  if (!ALLOWED_AUDIO_TYPES.has(file.type)) {
    return "Must be MP3, WAV, OGG, or WebM audio";
  }
  if (file.size <= 0) {
    return "File is empty";
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return "Exceeds 15 MB limit";
  }
  return null;
}

function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Must be JPG, PNG, or WebP";
  }
  if (file.size <= 0) {
    return "File is empty";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Exceeds 10 MB limit";
  }
  return null;
}

function renderJobStatusBadgeClass(status: RenderJobStatus): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PROCESSING":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "QUEUED":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "PENDING":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "FAILED":
      return "bg-red-50 text-red-700 border-red-200";
    case "CANCELLED":
      return "bg-neutral-100 text-neutral-600 border-neutral-300";
  }
}

function formatVideoFileSize(bytes?: number | null): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getAdminRenderVideoUrl(jobId: string, download = false): string {
  const base = `/api/admin/video-studio/render-jobs/${encodeURIComponent(jobId)}/video`;
  return download ? `${base}?download=1` : base;
}

function getVideoInstanceKey(job: Pick<RenderJobSummary, "id" | "completedAt">): string {
  return `${job.id}:${job.completedAt ?? ""}`;
}

function getVideoPreviewFrameClass(aspectRatio: AspectRatio): string {
  switch (aspectRatio) {
    case "9:16":
      return "mx-auto w-full max-w-[260px] aspect-[9/16]";
    case "1:1":
      return "mx-auto w-full max-w-[340px] aspect-square";
    case "16:9":
    default:
      return "w-full aspect-video";
  }
}

const card = "rounded-xl border border-neutral-200 bg-white shadow-xs";
const labelStyle = "mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500";
const inputStyle =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none transition";
const btn =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 transition";
const btnPrimary =
  "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 shadow-xs transition";
const tabStyle = (on: boolean) =>
  `rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
    on ? "bg-neutral-900 text-white shadow-xs" : "text-neutral-600 hover:bg-neutral-100"
  }`;

export default function Workspace({
  project,
  initialScenes,
  initialVersions,
  initialRenderJobs = [],
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Project Settings State
  const [title, setTitle] = useState(project.title);
  const [topic] = useState(project.topic);
  const [category] = useState<ContentCategory>(project.category);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(project.aspectRatio);
  const [targetAudience] = useState(project.targetAudience);
  const [language] = useState<Language>(project.language);
  const [tone] = useState<Tone>(project.tone);
  const [desiredDuration] = useState(project.desiredDuration);
  const [defaultCameraMotion, setDefaultCameraMotion] = useState<SceneCameraMotion | undefined>(
    project.defaultCameraMotion,
  );
  const [watermark, setWatermark] = useState<WatermarkConfig>(
    project.watermark ?? DEFAULT_WATERMARK_CONFIG,
  );

  // Scenes, Versions & Selection State
  const [scenes, setScenes] = useState<EditorScene[]>(initialScenes);
  const [versions, setVersions] = useState<ProjectVersionSummary[]>(initialVersions);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  // Modals & Panels
  const [viewMode, setViewMode] = useState<"edit" | "flow" | "json" | "history" | "renders">("edit");
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkProgress, setBulkProgress] = useState<BulkUploadProgress | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // User Notifications
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Render Jobs & Pre-Render Validation State (Phase 3 Part C2)
  const [renderJobs, setRenderJobs] = useState<RenderJobSummary[]>(initialRenderJobs);
  const [renderReadiness, setRenderReadiness] = useState<{
    loading: boolean;
    report: RenderValidationReport | null;
    error: string | null;
  }>({
    loading: false,
    report: null,
    error: null,
  });
  const [renderBusy, setRenderBusy] = useState(false);
  const [expandedSnapshotJobId, setExpandedSnapshotJobId] = useState<string | null>(null);
  const [brokenVideoJobIds, setBrokenVideoJobIds] = useState<Record<string, boolean>>({});
  const [browserAudioDurationByScene, setBrowserAudioDurationByScene] = useState<Record<string, number>>({});

  // Thumbnail Management State
  const [customThumbnail, setCustomThumbnail] = useState<ProjectThumbnailMetadata | null>(
    project.customThumbnail ?? null,
  );
  const [thumbnailPrompt, setThumbnailPrompt] = useState<string>(project.thumbnailPrompt || "");
  const [thumbnailPromptCopied, setThumbnailPromptCopied] = useState(false);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState<string | null>(null);
  const [thumbnailSuccess, setThumbnailSuccess] = useState<string | null>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);

  async function handleCopyThumbnailPrompt() {
    if (!thumbnailPrompt.trim()) return;
    try {
      await navigator.clipboard.writeText(thumbnailPrompt.trim());
      setThumbnailPromptCopied(true);
      setTimeout(() => setThumbnailPromptCopied(false), 2000);
    } catch {
      // ignore clipboard write failure in unsupported environments
    }
  }

  const autoGeneratedThumbnailUrl = useMemo(() => {
    const firstWithImg = scenes.find((s) => Boolean(s.imageUrl));
    return firstWithImg ? firstWithImg.imageUrl : null;
  }, [scenes]);

  const effectiveThumbnailUrl = useMemo(() => {
    if (customThumbnail?.url) {
      return `${customThumbnail.url}?t=${encodeURIComponent(customThumbnail.uploadedAt)}`;
    }
    return autoGeneratedThumbnailUrl;
  }, [customThumbnail, autoGeneratedThumbnailUrl]);

  // Sarvam AI Voiceover State (Phase 3 Part B)
  const [sarvamStatus, setSarvamStatus] = useState<{
    loading: boolean;
    configured: boolean;
    model: string;
    configError: string | null;
  }>({
    loading: true,
    configured: false,
    model: "bulbul:v3",
    configError: null,
  });

  const [voiceOptionsByScene, setVoiceOptionsByScene] = useState<
    Record<string, { languageCode: string; voice: string; format: SarvamAudioFormat }>
  >({});
  const [audioGenStateByScene, setAudioGenStateByScene] = useState<
    Record<string, { status: "idle" | "generating" | "ready" | "failed"; error?: string }>
  >({});

  const latestJobSnapshotRef = useRef<{ id: string | null; status: RenderJobStatus | null }>({
    id: initialRenderJobs[0]?.id ?? null,
    status: initialRenderJobs[0]?.status ?? null,
  });

  useEffect(() => {
    setStatus(project.status);
  }, [project.status]);

  useEffect(() => {
    setVersions(initialVersions);
  }, [initialVersions]);

  useEffect(() => {
    setRenderJobs(initialRenderJobs);
  }, [initialRenderJobs]);

  useEffect(() => {
    latestJobSnapshotRef.current = {
      id: renderJobs[0]?.id ?? null,
      status: renderJobs[0]?.status ?? null,
    };
  }, [renderJobs]);

  async function refreshRenderValidationAndJobs(opts?: { silent?: boolean }) {
    if (!opts?.silent) {
      setRenderReadiness((prev) => ({ ...prev, loading: true, error: null }));
    }
    try {
      const [readinessRes, jobsRes] = await Promise.all([
        validateProjectRenderReadinessAction(project.id),
        listRenderJobsAction({ projectId: project.id }),
      ]);

      if (readinessRes.ok) {
        setRenderReadiness({ loading: false, report: readinessRes.data, error: null });
      } else {
        setRenderReadiness({ loading: false, report: null, error: readinessRes.error });
      }

      if (jobsRes.ok) {
        const prevLatest = latestJobSnapshotRef.current;
        const nextLatest = jobsRes.data[0] ?? null;
        setRenderJobs(jobsRes.data);
        setBrokenVideoJobIds({});

        if (
          (nextLatest?.id ?? null) !== prevLatest.id ||
          (nextLatest?.status ?? null) !== prevLatest.status
        ) {
          if (nextLatest?.status === "COMPLETED") {
            setStatus("COMPLETED");
          } else if (
            nextLatest?.status === "PENDING" ||
            nextLatest?.status === "QUEUED" ||
            nextLatest?.status === "PROCESSING"
          ) {
            setStatus("PROCESSING");
          } else if (nextLatest?.status === "FAILED") {
            setStatus("FAILED");
          }
          startTransition(() => {
            router.refresh();
          });
        }
      }
    } catch {
      setRenderReadiness((prev) => ({
        loading: false,
        report: prev.report,
        error: "Unable to verify render readiness.",
      }));
    }
  }

  useEffect(() => {
    void refreshRenderValidationAndJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const hasActiveRenderJobs = useMemo(
    () =>
      renderJobs.some(
        (j) => j.status === "PENDING" || j.status === "QUEUED" || j.status === "PROCESSING",
      ),
    [renderJobs],
  );

  useEffect(() => {
    if (!hasActiveRenderJobs) return;
    const timer = window.setInterval(() => {
      void refreshRenderValidationAndJobs({ silent: true });
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveRenderJobs, project.id]);

  useEffect(() => {
    let active = true;
    checkSarvamStatusAction()
      .then((res) => {
        if (!active) return;
        if (res.ok) {
          setSarvamStatus({
            loading: false,
            configured: res.data.configured,
            model: res.data.model,
            configError: res.data.configError,
          });
        } else {
          setSarvamStatus((prev) => ({ ...prev, loading: false, configured: false }));
        }
      })
      .catch(() => {
        if (active) {
          setSarvamStatus((prev) => ({ ...prev, loading: false, configured: false }));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedScene = scenes[selectedIndex] ?? scenes[0];
  const ratioConfig = ASPECT_RATIO_CONFIG[aspectRatio] ?? ASPECT_RATIO_CONFIG["16:9"];
  const warnings = useMemo(() => getProjectWarnings(scenes, aspectRatio), [scenes, aspectRatio]);
  const localRenderCheck = useMemo(
    () =>
      validateProjectForRender({
        id: project.id,
        schemaVersion: project.schemaVersion,
        title,
        topic,
        targetAudience,
        category,
        status,
        aspectRatio,
        language,
        tone,
        desiredDuration,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        scenes: scenes.map((s, idx) => ({
          ...s,
          order: s.order || idx + 1,
        })),
      }),
    [
      project.id,
      project.schemaVersion,
      project.createdAt,
      project.updatedAt,
      title,
      topic,
      targetAudience,
      category,
      status,
      aspectRatio,
      language,
      tone,
      desiredDuration,
      scenes,
    ],
  );
  const effectiveRenderReport = isDirty
    ? localRenderCheck.report
    : renderReadiness.report ?? localRenderCheck.report;
  const latestRenderJob = renderJobs[0] ?? null;
  const currentTotalDuration = totalDuration(scenes);
  const emptyScenes = useMemo(() => scenes.filter((s) => !s.imageUrl), [scenes]);

  const bulkFilePreviews = useMemo(() => {
    return bulkFiles.map((file, idx) => {
      const validationError = validateImageFile(file);
      const targetScene = emptyScenes[idx] ?? null;
      return {
        file,
        validationError,
        targetScene,
        targetOrder: targetScene ? scenes.findIndex((s) => s.id === targetScene.id) + 1 : null,
      };
    });
  }, [bulkFiles, emptyScenes, scenes]);

  const hasInvalidBulkFiles = bulkFilePreviews.some((p) => Boolean(p.validationError));

  const currentJson = useMemo<VersionedProjectJson>(
    () =>
      buildVersionedProjectJson({
        projectId: project.id,
        title,
        category,
        status,
        aspectRatio,
        desiredDuration,
        targetAudience,
        language,
        tone,
        topic,
        defaultCameraMotion,
        watermark,
        scenes,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      }),
    [
      project.id,
      project.createdAt,
      project.updatedAt,
      title,
      category,
      status,
      aspectRatio,
      desiredDuration,
      targetAudience,
      language,
      tone,
      topic,
      defaultCameraMotion,
      watermark,
      scenes,
    ],
  );

  // Prompt before leaving if changes unsaved
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /* ---------- Scene Modifications ---------- */

  function updateScene(id: string, patch: Partial<EditorScene>) {
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setIsDirty(true);
  }

  function addScene() {
    const newScene: EditorScene = {
      id: newTempId(),
      order: scenes.length + 1,
      title: `Scene ${scenes.length + 1}`,
      narration: "",
      imagePrompt: "",
      imageUrl: null,
      duration: 6,
      locked: false,
      cameraMotion: defaultCameraMotion
        ? { ...defaultCameraMotion }
        : { effect: "AUTO", intensity: "SUBTLE", focalPosition: "CENTER" },
    };
    setScenes([...scenes, newScene]);
    setSelectedIndex(scenes.length);
    setIsDirty(true);
  }

  function duplicateScene(index: number) {
    const target = scenes[index];
    if (!target) return;
    const duplicated: EditorScene = {
      ...target,
      id: newTempId(),
      title: `${target.title} (Copy)`,
      order: index + 2,
      audio: null,
      cameraMotion: target.cameraMotion ? { ...target.cameraMotion } : undefined,
    };
    const nextScenes = [...scenes];
    nextScenes.splice(index + 1, 0, duplicated);
    setScenes(nextScenes.map((s, i) => ({ ...s, order: i + 1 })));
    setSelectedIndex(index + 1);
    setIsDirty(true);
  }

  function deleteScene(index: number) {
    if (scenes.length <= 1) return;
    const target = scenes[index];
    if (!window.confirm(`Delete Scene ${index + 1}: "${target.title}"?`)) return;
    const nextScenes = scenes.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    setScenes(nextScenes);
    setSelectedIndex(Math.max(0, index - 1));
    setIsDirty(true);
  }

  function moveScene(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= scenes.length) return;
    const next = [...scenes];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setScenes(next.map((s, i) => ({ ...s, order: i + 1 })));
    setSelectedIndex(toIndex);
    setIsDirty(true);
  }

  /* ---------- Server Actions ---------- */

  async function handleSaveDraft() {
    setBusyMessage("Saving draft...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await saveDraftAction({
      projectId: project.id,
      title,
      topic,
      category,
      status,
      targetAudience,
      language,
      tone,
      duration: desiredDuration,
      aspectRatio,
      thumbnailPrompt: thumbnailPrompt.trim() || null,
      defaultCameraMotion,
      watermark,
      scenes,
    });

    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes(res.data.scenes);
    setVersions(res.data.versions);
    setIsDirty(false);
    setSuccessMessage("Draft updated successfully. Snapshot stored in history.");
    void refreshRenderValidationAndJobs({ silent: true });
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleDuplicateProject() {
    setBusyMessage("Duplicating project...");
    setErrorMessage(null);
    const res = await duplicateProjectAction(project.id);
    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }
    router.push(`/admin/dashboard/video-studio/${res.data.id}`);
  }

  async function handleDeleteProject() {
    setBusyMessage("Deleting project...");
    setErrorMessage(null);
    const res = await deleteProjectAction(project.id);
    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }
    router.push("/admin/dashboard/video-studio");
  }

  async function handleStatusChange(newStatus: ProjectStatus) {
    setBusyMessage(`Updating status to ${newStatus}...`);
    setErrorMessage(null);
    const previousStatus = status;
    setStatus(newStatus);
    const res = await updateProjectStatusAction(project.id, newStatus);
    setBusyMessage(null);
    if (!res.ok) {
      setStatus(previousStatus);
      setErrorMessage(res.error);
      return;
    }
    setSuccessMessage(`Project status updated to ${STATUS_LABELS[newStatus]}.`);
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleUploadSingleImage(file: File) {
    if (!selectedScene) return;
    const validationErr = validateImageFile(file);
    if (validationErr) {
      setErrorMessage(`${file.name}: ${validationErr}.`);
      return;
    }

    const targetSceneId = selectedScene.id;
    const previousImageUrl = selectedScene.imageUrl;

    setBusyMessage("Uploading scene image...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("sceneId", targetSceneId);
    fd.set("file", file);
    if (previousImageUrl) {
      fd.set("previousImageUrl", previousImageUrl);
    }

    const res = await uploadSceneImageAction(fd);
    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes((prev) =>
      prev.map((s) => (s.id === targetSceneId ? { ...s, imageUrl: res.data.imageUrl } : s)),
    );

    if (isTempSceneId(targetSceneId)) {
      setIsDirty(true);
      setSuccessMessage("Image uploaded. Click Save as Draft to attach this new scene.");
    } else {
      setSuccessMessage("Image uploaded successfully.");
      void refreshRenderValidationAndJobs({ silent: true });
    }
  }

  async function handleDeleteSingleImage() {
    if (!selectedScene?.imageUrl) return;

    const targetSceneId = selectedScene.id;
    const targetImageUrl = selectedScene.imageUrl;

    setBusyMessage("Removing scene image...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await deleteSceneImageAction({
      projectId: project.id,
      sceneId: targetSceneId,
      imageUrl: targetImageUrl,
    });

    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes((prev) => prev.map((s) => (s.id === targetSceneId ? { ...s, imageUrl: null } : s)));
    setSuccessMessage("Scene image removed.");
    if (!isTempSceneId(targetSceneId)) {
      void refreshRenderValidationAndJobs({ silent: true });
    }
  }

  async function handleBulkUpload() {
    if (!bulkFiles.length || !emptyScenes.length || hasInvalidBulkFiles) return;

    const pairs = bulkFiles.slice(0, emptyScenes.length).map((file, i) => ({
      file,
      targetScene: emptyScenes[i],
    }));

    setErrorMessage(null);
    setSuccessMessage(null);
    setBusyMessage(`Bulk uploading ${pairs.length} image(s)...`);
    setBulkProgress({
      active: true,
      completed: 0,
      total: pairs.length,
      currentFileName: pairs[0].file.name,
      currentSceneTitle: pairs[0].targetScene.title,
      assignedCount: 0,
      failures: [],
    });

    let assignedCount = 0;
    let touchedTempScene = false;
    const failures: { fileName: string; sceneTitle: string; error: string }[] = [];

    for (let i = 0; i < pairs.length; i++) {
      const { file, targetScene } = pairs[i];
      setBulkProgress({
        active: true,
        completed: i,
        total: pairs.length,
        currentFileName: file.name,
        currentSceneTitle: targetScene.title,
        assignedCount,
        failures: [...failures],
      });

      const fd = new FormData();
      fd.set("projectId", project.id);
      fd.set("sceneId", targetScene.id);
      fd.set("file", file);

      const res = await uploadSceneImageAction(fd);
      if (!res.ok) {
        failures.push({
          fileName: file.name,
          sceneTitle: targetScene.title,
          error: res.error,
        });
      } else {
        assignedCount++;
        if (isTempSceneId(targetScene.id)) {
          touchedTempScene = true;
        }
        // Merge only this target scene's imageUrl so unsaved edits/reorders stay intact
        setScenes((prev) =>
          prev.map((s) => (s.id === targetScene.id ? { ...s, imageUrl: res.data.imageUrl } : s)),
        );
      }
    }

    if (touchedTempScene) {
      setIsDirty(true);
    }

    const skippedCount = Math.max(0, bulkFiles.length - pairs.length);

    setBusyMessage(null);
    setBulkProgress({
      active: false,
      completed: pairs.length,
      total: pairs.length,
      currentFileName: "",
      currentSceneTitle: "",
      assignedCount,
      failures,
    });

    if (failures.length === 0) {
      setBulkFiles([]);
      setShowBulkUpload(false);
      setSuccessMessage(
        `Assigned ${assignedCount} image(s) without overwriting unsaved edits.${
          skippedCount ? ` ${skippedCount} extra file(s) skipped (no empty scenes left).` : ""
        }${touchedTempScene ? " Click Save as Draft to store newly added scenes." : ""}`,
      );
      if (!touchedTempScene) {
        void refreshRenderValidationAndJobs({ silent: true });
      }
    } else {
      setErrorMessage(
        `Uploaded ${assignedCount} of ${pairs.length} image(s); ${failures.length} failed. See bulk upload details.`,
      );
    }
  }

  async function handleRestoreVersion(version: ProjectVersionSummary) {
    const confirmMsg = isDirty
      ? `You have unsaved changes. Restore snapshot "${version.reason}" from ${new Date(
          version.createdAt,
        ).toLocaleString("en-IN")}? Unsaved edits will be replaced.`
      : `Restore scenes from snapshot "${version.reason}" (${new Date(version.createdAt).toLocaleString("en-IN")})?`;

    if (!window.confirm(confirmMsg)) return;

    setBusyMessage("Restoring version snapshot...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await restoreVersionAction(project.id, version.id);
    setBusyMessage(null);

    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes(res.data.scenes);
    setVersions(res.data.versions);
    setSelectedIndex(0);
    setIsDirty(false);
    setViewMode("edit");
    setSuccessMessage(`Restored snapshot "${version.reason}". A restore checkpoint has been recorded.`);
    void refreshRenderValidationAndJobs({ silent: true });
    startTransition(() => {
      router.refresh();
    });
  }

  /* ---------- Helpers ---------- */

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMessage(`${label} copied to clipboard.`);
    } catch {
      setErrorMessage("Could not copy automatically. Please copy manually.");
    }
  }

  function speakNarration(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setErrorMessage("Text-to-speech preview is not supported by your browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  /* ---------- Voiceover Audio Controls (Sarvam AI & Manual) ---------- */

  const defaultSarvamLangCode = resolveSarvamLanguageCode(language) ?? "en-IN";

  function getSceneVoiceOptions(scene: EditorScene): {
    languageCode: string;
    voice: string;
    format: SarvamAudioFormat;
  } {
    const saved = voiceOptionsByScene[scene.id];
    if (saved) return saved;
    const initialFormat: SarvamAudioFormat = scene.audio?.format === "wav" ? "wav" : "mp3";
    return {
      languageCode: scene.audio?.languageCode || defaultSarvamLangCode,
      voice: scene.audio?.voice || "shubh",
      format: initialFormat,
    };
  }

  function updateSceneVoiceOptions(
    sceneId: string,
    patch: Partial<{ languageCode: string; voice: string; format: SarvamAudioFormat }>,
    current: { languageCode: string; voice: string; format: SarvamAudioFormat },
  ) {
    setVoiceOptionsByScene((prev) => ({
      ...prev,
      [sceneId]: { ...current, ...patch },
    }));
  }

  async function handleGenerateVoiceover() {
    if (!selectedScene) return;
    const targetSceneId = selectedScene.id;
    const opts = getSceneVoiceOptions(selectedScene);

    if (isTempSceneId(targetSceneId)) {
      setErrorMessage("Save this new scene as a draft before generating its Sarvam AI voiceover.");
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setAudioGenStateByScene((prev) => ({
      ...prev,
      [targetSceneId]: { status: "generating" },
    }));

    const res = await generateSceneVoiceoverAction({
      projectId: project.id,
      sceneId: targetSceneId,
      narration: selectedScene.narration,
      language: opts.languageCode,
      voice: opts.voice,
      format: opts.format,
    });

    if (!res.ok) {
      // Never overwrite existing audio or scene narration when generation fails
      setAudioGenStateByScene((prev) => ({
        ...prev,
        [targetSceneId]: { status: "failed", error: res.error },
      }));
      setErrorMessage(res.error);
      return;
    }

    setScenes((prev) =>
      prev.map((s) => (s.id === targetSceneId ? { ...s, audio: res.data.audio } : s)),
    );
    setAudioGenStateByScene((prev) => ({
      ...prev,
      [targetSceneId]: { status: "ready" },
    }));
    setSuccessMessage(
      `Generated ${res.data.audio.format.toUpperCase()} voiceover (${res.data.audio.voice}, ${res.data.audio.durationSec.toFixed(1)}s).`,
    );
    void refreshRenderValidationAndJobs({ silent: true });
  }

  async function handleUploadManualAudio(file: File) {
    if (!selectedScene) return;
    const targetSceneId = selectedScene.id;
    if (isTempSceneId(targetSceneId)) {
      setErrorMessage("Save this new scene as a draft before uploading an audio file.");
      return;
    }

    const validationErr = validateAudioFile(file);
    if (validationErr) {
      setErrorMessage(`${file.name}: ${validationErr}.`);
      return;
    }

    const opts = getSceneVoiceOptions(selectedScene);
    setErrorMessage(null);
    setSuccessMessage(null);
    setAudioGenStateByScene((prev) => ({
      ...prev,
      [targetSceneId]: { status: "generating" },
    }));

    const fd = new FormData();
    fd.set("projectId", project.id);
    fd.set("sceneId", targetSceneId);
    fd.set("file", file);
    fd.set("language", opts.languageCode);

    const res = await uploadSceneAudioAction(fd);
    if (!res.ok) {
      setAudioGenStateByScene((prev) => ({
        ...prev,
        [targetSceneId]: { status: "failed", error: res.error },
      }));
      setErrorMessage(res.error);
      return;
    }

    setScenes((prev) =>
      prev.map((s) => (s.id === targetSceneId ? { ...s, audio: res.data.audio } : s)),
    );
    setAudioGenStateByScene((prev) => ({
      ...prev,
      [targetSceneId]: { status: "ready" },
    }));
    setSuccessMessage(`Uploaded custom audio (${res.data.audio.format.toUpperCase()}) for scene.`);
    void refreshRenderValidationAndJobs({ silent: true });
  }

  async function handleDeleteSceneAudio() {
    if (!selectedScene?.audio) return;
    const targetSceneId = selectedScene.id;

    setBusyMessage("Removing scene audio...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await deleteSceneAudioAction({
      projectId: project.id,
      sceneId: targetSceneId,
    });

    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes((prev) =>
      prev.map((s) => (s.id === targetSceneId ? { ...s, audio: null } : s)),
    );
    setAudioGenStateByScene((prev) => ({
      ...prev,
      [targetSceneId]: { status: "idle" },
    }));
    setSuccessMessage("Scene voiceover audio removed.");
    void refreshRenderValidationAndJobs({ silent: true });
  }

  async function handleSyncProjectAudioTiming(fitSceneDurations = true) {
    if (isDirty) {
      setErrorMessage("Save Draft First before syncing stored audio & scene durations.");
      return;
    }

    setBusyMessage("Recalculating voiceover durations and syncing scene timing...");
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await syncProjectAudioTimingAction({
      projectId: project.id,
      fitSceneDurations,
    });

    setBusyMessage(null);
    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setScenes(res.data.scenes);
    setSuccessMessage(
      res.data.updatedAudioCount === 0 && res.data.updatedSceneDurationCount === 0
        ? "All scene voiceover durations and scene timings are already up to date."
        : `Updated ${res.data.updatedAudioCount} audio duration(s) and fitted ${res.data.updatedSceneDurationCount} scene duration(s).`,
    );
    await refreshRenderValidationAndJobs({ silent: true });
  }

  /* ---------- Thumbnail Management Actions ---------- */

  function handleSelectThumbnailFile(e: React.ChangeEvent<HTMLInputElement>) {
    setThumbnailError(null);
    setThumbnailSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setThumbnailError("Invalid file type. Please select a JPG, PNG, or WebP image.");
      e.target.value = "";
      return;
    }
    if (file.size <= 0) {
      setThumbnailError("Selected file is empty.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setThumbnailError("Thumbnail must be under 10 MB.");
      e.target.value = "";
      return;
    }

    setThumbnailFile(file);
  }

  async function handleUploadThumbnail() {
    if (!thumbnailFile) {
      setThumbnailError("Please choose an image file first.");
      return;
    }

    setThumbnailUploading(true);
    setThumbnailError(null);
    setThumbnailSuccess(null);

    const fd = new FormData();
    fd.append("projectId", project.id);
    fd.append("file", thumbnailFile);

    const res = await uploadProjectThumbnailAction(fd);
    setThumbnailUploading(false);

    if (!res.ok) {
      setThumbnailError(res.error);
      return;
    }

    setCustomThumbnail(res.data.thumbnail);
    setThumbnailFile(null);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
    setThumbnailSuccess("Custom thumbnail uploaded and saved.");
  }

  async function handleRemoveCustomThumbnail() {
    setThumbnailUploading(true);
    setThumbnailError(null);
    setThumbnailSuccess(null);

    const res = await removeProjectThumbnailAction(project.id);
    setThumbnailUploading(false);

    if (!res.ok) {
      setThumbnailError(res.error);
      return;
    }

    setCustomThumbnail(null);
    setThumbnailFile(null);
    if (thumbnailInputRef.current) {
      thumbnailInputRef.current.value = "";
    }
    setThumbnailSuccess("Reverted to automatically generated frame.");
  }

  /* ---------- Render Job Management Actions (Phase 3 Part C2) ---------- */

  async function handleCreateRenderJob() {
    if (isDirty) {
      setErrorMessage("You have unsaved changes. Click Save as Draft before creating a render job.");
      return;
    }

    setRenderBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    // Refresh server validation report immediately before job creation
    const readinessRes = await validateProjectRenderReadinessAction(project.id);
    if (!readinessRes.ok) {
      setRenderBusy(false);
      setErrorMessage(readinessRes.error);
      return;
    }

    setRenderReadiness({ loading: false, report: readinessRes.data, error: null });
    if (!readinessRes.data.valid) {
      setRenderBusy(false);
      setErrorMessage(
        readinessRes.data.errors[0]?.message ?? "Project validation failed. Resolve errors before rendering.",
      );
      return;
    }

    const res = await createRenderJobAction({ projectId: project.id });
    setRenderBusy(false);

    if (!res.ok) {
      setErrorMessage(res.error);
      await refreshRenderValidationAndJobs({ silent: true });
      return;
    }

    setRenderJobs((prev) => [res.data, ...prev.filter((j) => j.id !== res.data.id)]);
    setStatus("PROCESSING");
    setSuccessMessage(
      `Render job ${res.data.id} queued (${RENDER_JOB_STATUS_LABELS[res.data.status]}) with an immutable snapshot for background MP4 rendering.`,
    );
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleCancelRenderJob(jobId: string) {
    setRenderBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await cancelRenderJobAction({ projectId: project.id, jobId });
    setRenderBusy(false);

    if (!res.ok) {
      setErrorMessage(res.error);
      await refreshRenderValidationAndJobs({ silent: true });
      return;
    }

    setRenderJobs((prev) => {
      const next = prev.map((j) => (j.id === res.data.id ? res.data : j));
      const hasRemainingActive = next.some(
        (j) => j.status === "PENDING" || j.status === "QUEUED" || j.status === "PROCESSING",
      );
      if (!hasRemainingActive) {
        const hasCompleted = next.some((j) => j.status === "COMPLETED");
        setStatus((curr) => (curr === "PROCESSING" ? (hasCompleted ? "COMPLETED" : "DRAFT") : curr));
      }
      return next;
    });
    setSuccessMessage(`Render job ${res.data.id} cancelled.`);
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleRetryRenderJob(jobId: string) {
    setRenderBusy(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const res = await retryRenderJobAction({ projectId: project.id, jobId });
    setRenderBusy(false);

    if (!res.ok) {
      setErrorMessage(res.error);
      await refreshRenderValidationAndJobs({ silent: true });
      return;
    }

    setRenderJobs((prev) => prev.map((j) => (j.id === res.data.id ? res.data : j)));
    setBrokenVideoJobIds((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k === jobId || k.startsWith(`${jobId}:`)) {
          delete next[k];
        }
      }
      return next;
    });
    setStatus("PROCESSING");
    setSuccessMessage(
      `Render job ${res.data.id} re-queued (attempt #${res.data.retryCount + 1}).`,
    );
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleRefreshRenderJob(jobId: string) {
    setRenderBusy(true);
    setErrorMessage(null);

    const res = await getRenderJobAction({ projectId: project.id, jobId });
    setRenderBusy(false);

    if (!res.ok) {
      setErrorMessage(res.error);
      return;
    }

    setBrokenVideoJobIds((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k === jobId || k.startsWith(`${jobId}:`)) {
          delete next[k];
        }
      }
      return next;
    });
    setRenderJobs((prev) => {
      const next = prev.map((j) => (j.id === res.data.id ? res.data : j));
      const latest = next[0] ?? null;
      if (latest?.id === res.data.id) {
        if (res.data.status === "COMPLETED") {
          setStatus("COMPLETED");
        } else if (
          res.data.status === "PENDING" ||
          res.data.status === "QUEUED" ||
          res.data.status === "PROCESSING"
        ) {
          setStatus("PROCESSING");
        } else if (res.data.status === "FAILED") {
          setStatus("FAILED");
        } else if (res.data.status === "CANCELLED") {
          const hasCompleted = next.some((j) => j.status === "COMPLETED");
          setStatus((curr) => (curr === "PROCESSING" ? (hasCompleted ? "COMPLETED" : "DRAFT") : curr));
        }
      }
      return next;
    });
    setSuccessMessage(`Refreshed render job ${res.data.id} (${RENDER_JOB_STATUS_LABELS[res.data.status]}).`);
  }

  return (
    <div className="space-y-4 pb-28">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/admin/dashboard/video-studio"
            className="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition"
          >
            AI Video Studio
          </Link>
          <span className="text-neutral-300">/</span>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setIsDirty(true);
            }}
            placeholder="Untitled Video Project"
            className="rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-lg font-bold text-neutral-900 hover:border-neutral-300 focus:border-neutral-900 focus:bg-white focus:outline-none transition min-w-[200px]"
          />
        </div>

        {/* View Switcher & Action Links */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setViewMode("edit")} className={tabStyle(viewMode === "edit")}>
            Scene Editor
          </button>
          <button type="button" onClick={() => setViewMode("flow")} className={tabStyle(viewMode === "flow")}>
            Review as Flow
          </button>
          <button type="button" onClick={() => setViewMode("json")} className={tabStyle(viewMode === "json")}>
            Project JSON
          </button>
          <button type="button" onClick={() => setViewMode("history")} className={tabStyle(viewMode === "history")}>
            Version History ({versions.length})
          </button>
          <button type="button" onClick={() => setViewMode("renders")} className={tabStyle(viewMode === "renders")}>
            Render Jobs ({renderJobs.length})
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {errorMessage}
        </div>
      )}
      {successMessage && !errorMessage && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          {successMessage}
        </div>
      )}

      {/* Bulk Upload Modal / Panel */}
      {showBulkUpload && (
        <div className={`${card} p-4 space-y-3 bg-neutral-50 border-neutral-300`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-neutral-900 text-sm">Bulk Upload Scene Images</h3>
              <p className="text-xs text-neutral-600 mt-0.5">
                Select multiple images (JPG, PNG, WebP up to 10 MB each). They will be assigned in order to the{" "}
                <strong>{emptyScenes.length}</strong> scene{emptyScenes.length === 1 ? "" : "s"} currently missing an
                image without discarding unsaved edits.
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(bulkProgress?.active)}
              onClick={() => setShowBulkUpload(false)}
              className={btn}
            >
              Close
            </button>
          </div>

          <input
            type="file"
            multiple
            disabled={Boolean(bulkProgress?.active)}
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              setBulkFiles(Array.from(e.target.files ?? []));
              setBulkProgress(null);
            }}
            className="text-xs"
          />

          {/* File-to-Scene Mapping & Validation Preview */}
          {bulkFilePreviews.length > 0 && (
            <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                Planned Scene Mapping
              </div>
              <ul className="max-h-40 overflow-y-auto divide-y divide-neutral-100 text-xs">
                {bulkFilePreviews.map((item, idx) => (
                  <li key={`${item.file.name}-${idx}`} className="py-1.5 flex items-center justify-between gap-3">
                    <span className="truncate font-medium text-neutral-800">
                      {idx + 1}. {item.file.name} ({(item.file.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                    {item.validationError ? (
                      <span className="shrink-0 font-medium text-red-600">{item.validationError}</span>
                    ) : item.targetScene ? (
                      <span className="shrink-0 text-emerald-700">
                        → Scene {item.targetOrder}: {item.targetScene.title}
                      </span>
                    ) : (
                      <span className="shrink-0 text-amber-600">Skipped (no empty scenes left)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Upload Progress Bar & Failures */}
          {bulkProgress && (
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-neutral-800">
                  {bulkProgress.active
                    ? `Uploading ${bulkProgress.completed + 1} of ${bulkProgress.total}: ${bulkProgress.currentFileName} → ${bulkProgress.currentSceneTitle}`
                    : `Finished: ${bulkProgress.assignedCount} assigned, ${bulkProgress.failures.length} failed`}
                </span>
                <span className="font-mono text-neutral-500">
                  {Math.round(
                    ((bulkProgress.active ? bulkProgress.completed : bulkProgress.total) /
                      Math.max(1, bulkProgress.total)) *
                      100,
                  )}
                  %
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className={`h-full transition-all ${
                    bulkProgress.failures.length > 0 && !bulkProgress.active ? "bg-amber-500" : "bg-neutral-900"
                  }`}
                  style={{
                    width: `${Math.round(
                      ((bulkProgress.active ? bulkProgress.completed : bulkProgress.total) /
                        Math.max(1, bulkProgress.total)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              {bulkProgress.failures.length > 0 && (
                <ul className="space-y-1 pt-1 text-red-700">
                  {bulkProgress.failures.map((f, i) => (
                    <li key={i}>
                      • <strong>{f.fileName}</strong> ({f.sceneTitle}): {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={
                !bulkFiles.length ||
                !emptyScenes.length ||
                hasInvalidBulkFiles ||
                Boolean(bulkProgress?.active) ||
                Boolean(busyMessage)
              }
              onClick={handleBulkUpload}
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              Assign {Math.min(bulkFiles.length, emptyScenes.length)} Image
              {Math.min(bulkFiles.length, emptyScenes.length) === 1 ? "" : "s"} to Scenes
            </button>
            <button
              type="button"
              disabled={Boolean(bulkProgress?.active)}
              onClick={() => setShowBulkUpload(false)}
              className={btn}
            >
              Cancel
            </button>
            {emptyScenes.length === 0 && (
              <span className="text-xs text-amber-700">All scenes already have images. Remove or add a scene first.</span>
            )}
          </div>
        </div>
      )}

      {/* MAIN VIEW: Card-Based Scene Editor */}
      {viewMode === "edit" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* LEFT / MAIN COLUMN: Dedicated Thumbnail Card on top, then Scenes Section below */}
          <div className="space-y-5 min-w-0">
            {/* Dedicated Thumbnail Management Card (Positioned Above Scenes Section) */}
            <div className={`${card} p-5 space-y-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className={labelStyle}>Thumbnail</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    customThumbnail
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-neutral-100 text-neutral-600 border-neutral-200"
                  }`}
                >
                  {customThumbnail ? "Custom Thumbnail" : "Auto-Generated Frame"}
                </span>
              </div>

              <div className="text-[11px] text-neutral-500 leading-relaxed">
                Overrides the auto-generated frame grab. Leave blank to let generation pick one automatically.
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                {/* Left: Thumbnail Preview */}
                <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 flex items-center justify-center relative">
                  {effectiveThumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={effectiveThumbnailUrl}
                      alt="Video thumbnail"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-neutral-400 p-1 text-center text-[10px]">
                      <svg className="h-5 w-5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>No frame yet</span>
                    </div>
                  )}
                </div>

                {/* Right: Upload controls beside preview */}
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      className={`inline-flex items-center rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition cursor-pointer ${
                        thumbnailUploading ? "opacity-50 pointer-events-none" : ""
                      }`}
                    >
                      <span>{thumbnailFile ? "Change Selection" : "Choose File"}</span>
                      <input
                        ref={thumbnailInputRef}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={thumbnailUploading}
                        onChange={handleSelectThumbnailFile}
                      />
                    </label>

                    <button
                      type="button"
                      disabled={!thumbnailFile || thumbnailUploading}
                      onClick={handleUploadThumbnail}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition"
                    >
                      {thumbnailUploading ? "Uploading..." : "Upload & Replace"}
                    </button>

                    {customThumbnail && (
                      <button
                        type="button"
                        disabled={thumbnailUploading}
                        onClick={handleRemoveCustomThumbnail}
                        className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 transition"
                        title="Revert to auto-generated frame"
                      >
                        Reset to Auto
                      </button>
                    )}
                  </div>

                  {thumbnailFile && (
                    <div className="text-[11px] text-neutral-700 truncate">
                      Selected: <strong>{thumbnailFile.name}</strong> ({(thumbnailFile.size / 1024).toFixed(0)} KB)
                    </div>
                  )}

                  <div className="text-[10px] text-neutral-400">
                    JPG, PNG, or WebP up to 10 MB.
                  </div>
                </div>
              </div>

              {/* Thumbnail Prompt Input & Copy (as shown in reference screenshot) */}
              <div className="space-y-1.5 pt-2 border-t border-neutral-100">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-neutral-600">
                    Thumbnail prompt (optional) — describe the thumbnail image to generate
                  </label>
                  {thumbnailPromptCopied && (
                    <span className="text-[10px] font-semibold text-emerald-600">Copied!</span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={thumbnailPrompt}
                    onChange={(e) => {
                      setThumbnailPrompt(e.target.value);
                      setIsDirty(true);
                    }}
                    placeholder="Thumbnail prompt (optional) — describe the thumbnail image to generate"
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-9 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={handleCopyThumbnailPrompt}
                    title="Copy thumbnail prompt"
                    className="absolute right-2 p-1 text-neutral-400 hover:text-neutral-700 transition"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {thumbnailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
                  {thumbnailError}
                </div>
              )}

              {thumbnailSuccess && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800">
                  {thumbnailSuccess}
                </div>
              )}
            </div>

            {/* SCENES SECTION: Scene List on left + Active Scene Editor on right */}
            <div className="grid gap-5 lg:grid-cols-[250px_1fr] items-start">
              {/* LEFT PANE: Scene List & Reordering */}
              <div className={`${card} p-3 space-y-3 h-fit`}>
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <span className="text-xs font-semibold text-neutral-900">Scenes ({scenes.length})</span>
              <span className="text-xs text-neutral-500">{currentTotalDuration}s total</span>
            </div>

            <ul className="space-y-1.5">
              {scenes.map((s, idx) => {
                const isSelected = idx === selectedIndex;
                const hasImg = Boolean(s.imageUrl);

                return (
                  <li
                    key={s.id}
                    draggable
                    onDragStart={() => setDragFromIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragFromIndex !== null) {
                        moveScene(dragFromIndex, idx);
                        setDragFromIndex(null);
                      }
                    }}
                    className="relative"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className={`flex w-full items-center gap-2 rounded-lg p-2 text-left text-xs transition ${
                        isSelected
                          ? "bg-neutral-900 text-white font-medium shadow-xs"
                          : "text-neutral-700 hover:bg-neutral-100"
                      }`}
                    >
                      <span className="w-4 shrink-0 font-mono text-[11px] opacity-60">{idx + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{s.title || "Untitled Scene"}</div>
                        <div className="flex items-center gap-1.5 pt-0.5 text-[10px] opacity-75">
                          <span>{s.duration}s</span>
                          <span>•</span>
                          <span>
                            {s.cameraMotion?.effect === "NONE"
                              ? "Static"
                              : s.cameraMotion?.effect && s.cameraMotion.effect !== "AUTO"
                              ? CAMERA_MOTION_EFFECT_LABELS[s.cameraMotion.effect].replace("Slow ", "")
                              : `Auto (${CAMERA_MOTION_EFFECT_LABELS[resolveSceneCameraMotion(s.cameraMotion, idx).effect].replace("Slow ", "")})`}
                          </span>
                        </div>
                      </div>
                      {s.audio?.audioUrl && (
                        <span
                          title={`Voiceover ready (${s.audio.durationSec.toFixed(1)}s)`}
                          className="h-2 w-2 rounded-full bg-sky-400 shrink-0"
                        />
                      )}
                      <span
                        title={hasImg ? "Has visual asset" : "Missing image"}
                        className={`h-2 w-2 rounded-full ${hasImg ? "bg-emerald-400" : "bg-amber-400"} shrink-0`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={addScene}
              className="w-full rounded-lg border border-dashed border-neutral-300 py-2 text-xs font-medium text-neutral-600 hover:border-neutral-900 hover:bg-neutral-50 transition"
            >
              + Add Scene
            </button>
          </div>

          {/* CENTER PANE: Active Scene Editor (Card Based) */}
          {selectedScene && (
            <div className={`${card} p-5 space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
                <div>
                  <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                    Scene {selectedIndex + 1} of {scenes.length}
                  </span>
                  <h2 className="text-base font-semibold text-neutral-900">{selectedScene.title}</h2>
                </div>

                {/* Scene Action Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={selectedIndex === 0}
                    onClick={() => moveScene(selectedIndex, selectedIndex - 1)}
                    className={btn}
                    title="Move up"
                  >
                    ↑ Move Up
                  </button>
                  <button
                    type="button"
                    disabled={selectedIndex === scenes.length - 1}
                    onClick={() => moveScene(selectedIndex, selectedIndex + 1)}
                    className={btn}
                    title="Move down"
                  >
                    ↓ Move Down
                  </button>
                  <button
                    type="button"
                    onClick={() => duplicateScene(selectedIndex)}
                    className={btn}
                    title="Duplicate scene"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    disabled={scenes.length <= 1}
                    onClick={() => deleteScene(selectedIndex)}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 transition"
                    title="Delete scene"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Scene Title */}
              <div>
                <label className={labelStyle}>
                  Scene Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={selectedScene.title}
                  onChange={(e) => updateScene(selectedScene.id, { title: e.target.value })}
                  placeholder="e.g. Master Bedroom & Panoramic Balcony"
                  className={inputStyle}
                />
              </div>

              {/* Narration Text */}
              <div>
                <div className="flex items-center justify-between mb-1 gap-2">
                  <label className={labelStyle}>Narration (Spoken Text)</label>
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <span>
                      {countWords(selectedScene.narration)} words (~{estimateDurationSec(selectedScene.narration)}s spoken)
                    </span>
                    <span className="text-neutral-300">•</span>
                    <span
                      className={
                        selectedScene.narration.trim().length > SARVAM_MAX_NARRATION_CHARS
                          ? "font-medium text-red-600"
                          : ""
                      }
                    >
                      {selectedScene.narration.trim().length}/{SARVAM_MAX_NARRATION_CHARS} chars
                    </span>
                    <button
                      type="button"
                      onClick={() => speakNarration(selectedScene.narration)}
                      className="underline text-neutral-700 hover:text-neutral-900"
                    >
                      ▶ Quick Speech Preview
                    </button>
                  </div>
                </div>
                <textarea
                  value={selectedScene.narration}
                  onChange={(e) => updateScene(selectedScene.id, { narration: e.target.value })}
                  placeholder="Enter the voiceover script for this scene..."
                  className={`${inputStyle} h-28 text-sm`}
                />
              </div>

              {/* Sarvam AI Voiceover & Manual Audio Asset (Phase 3 Part B) */}
              {(() => {
                const opts = getSceneVoiceOptions(selectedScene);
                const genState = audioGenStateByScene[selectedScene.id];
                const isGenerating = genState?.status === "generating";
                const isNewUnsavedScene = isTempSceneId(selectedScene.id);
                const trimmedNarration = selectedScene.narration.trim();
                const narrationTooLong = trimmedNarration.length > SARVAM_MAX_NARRATION_CHARS;
                const narrationEmpty = trimmedNarration.length === 0;
                const existingAudio = selectedScene.audio;
                const narrationChangedSinceAudio = Boolean(
                  existingAudio?.narrationHash &&
                    existingAudio.narrationHash !== hashNarrationText(selectedScene.narration),
                );

                return (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className={labelStyle}>Scene Voiceover Audio (Sarvam AI)</span>
                        <p className="text-[11px] text-neutral-500">
                          Generate speech from the current narration or upload a custom audio track without altering your script.
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] font-medium">
                        {isGenerating ? (
                          <span className="rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-amber-800">
                            Generating audio...
                          </span>
                        ) : genState?.status === "failed" ? (
                          <span className="rounded-full bg-red-100 border border-red-200 px-2.5 py-0.5 text-red-700">
                            Generation Failed
                          </span>
                        ) : existingAudio ? (
                          <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-emerald-800">
                            {existingAudio.model === "manual-upload"
                              ? "Custom Audio Ready"
                              : `Audio Ready (${existingAudio.model})`}
                          </span>
                        ) : (
                          <span className="rounded-full bg-neutral-200/80 px-2.5 py-0.5 text-neutral-600">
                            No Audio Generated
                          </span>
                        )}
                      </div>
                    </div>

                    {!sarvamStatus.loading && (!sarvamStatus.configured || sarvamStatus.configError) && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                        {sarvamStatus.configError
                          ? sarvamStatus.configError
                          : "Sarvam AI API key (SARVAM_API_KEY) is not configured on the server. Add it in your server environment to generate AI voiceovers, or upload an MP3/WAV file manually below."}
                      </div>
                    )}

                    {isNewUnsavedScene && (
                      <div className="rounded-lg border border-neutral-200 bg-white p-2.5 text-xs text-neutral-600">
                        This is a newly added scene. Click <strong>Save as Draft</strong> below first to attach or generate audio for it.
                      </div>
                    )}

                    {/* Language, Speaker Voice, Format & Generate Controls */}
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-neutral-600">
                          Voiceover Language
                        </label>
                        <select
                          disabled={isGenerating || Boolean(busyMessage)}
                          value={opts.languageCode}
                          onChange={(e) =>
                            updateSceneVoiceOptions(selectedScene.id, { languageCode: e.target.value }, opts)
                          }
                          className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                        >
                          {SARVAM_LANGUAGES.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                              {lang.label} ({lang.code})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-neutral-600">
                          Sarvam Voice ({sarvamStatus.model})
                        </label>
                        <select
                          disabled={isGenerating || Boolean(busyMessage)}
                          value={opts.voice}
                          onChange={(e) =>
                            updateSceneVoiceOptions(selectedScene.id, { voice: e.target.value }, opts)
                          }
                          className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                        >
                          {SARVAM_VOICES.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.label} ({v.gender})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-neutral-600">
                          Audio Format
                        </label>
                        <select
                          disabled={isGenerating || Boolean(busyMessage)}
                          value={opts.format}
                          onChange={(e) =>
                            updateSceneVoiceOptions(
                              selectedScene.id,
                              { format: e.target.value as SarvamAudioFormat },
                              opts,
                            )
                          }
                          className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                        >
                          {SARVAM_AUDIO_FORMATS.map((fmt) => (
                            <option key={fmt} value={fmt}>
                              {fmt.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          isGenerating ||
                          Boolean(busyMessage) ||
                          isNewUnsavedScene ||
                          narrationEmpty ||
                          narrationTooLong ||
                          !sarvamStatus.configured
                        }
                        onClick={handleGenerateVoiceover}
                        className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition"
                      >
                        {isGenerating
                          ? "Generating..."
                          : existingAudio
                            ? "Regenerate Audio"
                            : "Generate Voiceover"}
                      </button>

                      <label
                        className={`inline-flex items-center rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition ${
                          isGenerating || Boolean(busyMessage) || isNewUnsavedScene
                            ? "opacity-50 pointer-events-none"
                            : "cursor-pointer"
                        }`}
                      >
                        <span>{existingAudio ? "Replace Audio File" : "Upload Audio File"}</span>
                        <input
                          type="file"
                          className="hidden"
                          disabled={isGenerating || Boolean(busyMessage) || isNewUnsavedScene}
                          accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) handleUploadManualAudio(file);
                          }}
                        />
                      </label>

                      {existingAudio && (
                        <button
                          type="button"
                          disabled={isGenerating || Boolean(busyMessage)}
                          onClick={handleDeleteSceneAudio}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                        >
                          Remove Audio
                        </button>
                      )}
                    </div>

                    {genState?.status === "failed" && genState.error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                        {genState.error}
                        {existingAudio && " Previous voiceover file was preserved."}
                      </div>
                    )}

                    {narrationChangedSinceAudio && existingAudio && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                        Narration was modified after this audio was generated. Click <strong>Regenerate Audio</strong> to match the updated script.
                      </div>
                    )}

                    {existingAudio?.audioUrl && (
                      <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
                        <audio
                          key={existingAudio.audioUrl}
                          controls
                          preload="metadata"
                          className="w-full h-9"
                          onLoadedMetadata={(e) => {
                            const measured = e.currentTarget.duration;
                            if (Number.isFinite(measured) && measured > 0) {
                              setBrowserAudioDurationByScene((prev) => ({
                                ...prev,
                                [selectedScene.id]: Number(measured.toFixed(1)),
                              }));
                            }
                          }}
                        >
                          <source src={existingAudio.audioUrl} type={existingAudio.mimeType} />
                        </audio>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                          <span>
                            Model: <strong className="text-neutral-700">{existingAudio.model}</strong>
                          </span>
                          <span>
                            Format: <strong className="text-neutral-700">{existingAudio.format.toUpperCase()}</strong>
                          </span>
                          <span>
                            Duration: <strong className="text-neutral-700">{existingAudio.durationSec.toFixed(1)}s</strong>
                            {typeof browserAudioDurationByScene[selectedScene.id] === "number" &&
                              Math.abs(browserAudioDurationByScene[selectedScene.id] - existingAudio.durationSec) >= 0.6 && (
                                <span className="ml-1 text-amber-700">
                                  (actual: {browserAudioDurationByScene[selectedScene.id].toFixed(1)}s — click Sync Timing)
                                </span>
                              )}
                          </span>
                          {existingAudio.voice && (
                            <span>
                              Voice: <strong className="text-neutral-700">{existingAudio.voice}</strong>
                            </span>
                          )}
                          {existingAudio.languageCode && (
                            <span>
                              Language: <strong className="text-neutral-700">{existingAudio.languageCode}</strong>
                            </span>
                          )}
                          <span>
                            Generated:{" "}
                            <strong className="text-neutral-700">
                              {new Date(existingAudio.generatedAt).toLocaleString("en-IN")}
                            </strong>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Image Generation Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelStyle}>Image Generation Prompt</label>
                  <button
                    type="button"
                    onClick={() => copyText(selectedScene.imagePrompt, "Image prompt")}
                    className="text-xs underline text-neutral-600 hover:text-neutral-900"
                  >
                    Copy Prompt
                  </button>
                </div>
                <textarea
                  value={selectedScene.imagePrompt}
                  onChange={(e) => updateScene(selectedScene.id, { imagePrompt: e.target.value })}
                  placeholder="Visual prompt for image generators (e.g. Midjourney, Photorealistic 4K luxury master bedroom with morning sunlight)..."
                  className={`${inputStyle} h-20 text-xs font-mono`}
                />
              </div>

              {/* Image Upload, Live Preview & Deletion */}
              <div>
                <label className={labelStyle}>Scene Image Asset</label>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="h-28 w-44 shrink-0 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 flex items-center justify-center">
                    {selectedScene.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={selectedScene.imageUrl} alt={selectedScene.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-neutral-400 p-2 text-center">
                        <svg className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.5}
                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="text-[11px]">No image uploaded</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="block font-medium text-neutral-700">
                      {selectedScene.imageUrl ? "Replace Image Asset" : "Upload Image Asset"}
                    </label>
                    <input
                      type="file"
                      disabled={Boolean(busyMessage)}
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) handleUploadSingleImage(file);
                      }}
                      className="text-xs"
                    />
                    <p className="text-[11px] text-neutral-500">Supports JPG, PNG, WebP up to 10 MB.</p>
                    {selectedScene.imageUrl && (
                      <button
                        type="button"
                        disabled={Boolean(busyMessage)}
                        onClick={handleDeleteSingleImage}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                      >
                        Remove Image
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Scene Duration */}
              <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-neutral-200">
                <div>
                  <label className={labelStyle}>Scene Duration (seconds)</label>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={selectedScene.duration}
                    onChange={(e) => updateScene(selectedScene.id, { duration: Number(e.target.value) || 6 })}
                    className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800"
                  />
                </div>
                {selectedScene.audio?.status === "ready" &&
                  selectedScene.audio.durationSec > 0 && (() => {
                    const effectiveAudioSec =
                      browserAudioDurationByScene[selectedScene.id] ?? selectedScene.audio.durationSec;
                    const matchedSec = Math.min(60, Math.max(2, Math.ceil(effectiveAudioSec)));
                    return (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 pb-0.5">
                        <span>
                          Voiceover: <strong className="text-neutral-800">{effectiveAudioSec.toFixed(1)}s</strong>
                        </span>
                        {selectedScene.duration !== matchedSec && (
                          <button
                            type="button"
                            onClick={() => updateScene(selectedScene.id, { duration: matchedSec })}
                            className={btn}
                          >
                            Match Voiceover ({matchedSec}s)
                          </button>
                        )}
                      </div>
                    );
                  })()}
              </div>

              {/* Camera Motion (Part C3.5) */}
              <div className="pt-3 border-t border-neutral-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className={labelStyle}>Camera Motion</label>
                  <span className="text-[11px] text-neutral-500">
                    Cinematic camera movement applied to still images during video render
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Motion Effect */}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-neutral-600">Motion Effect</label>
                    <select
                      value={selectedScene.cameraMotion?.effect ?? "AUTO"}
                      onChange={(e) => {
                        const newEffect = e.target.value as CameraMotionEffect;
                        const currentIntensity = selectedScene.cameraMotion?.intensity ?? "SUBTLE";
                        const currentFocal = selectedScene.cameraMotion?.focalPosition ?? "CENTER";
                        updateScene(selectedScene.id, {
                          cameraMotion: {
                            effect: newEffect,
                            intensity: currentIntensity,
                            focalPosition: currentFocal,
                          },
                        });
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
                    >
                      {CAMERA_MOTION_EFFECTS.map((eff) => (
                        <option key={eff} value={eff}>
                          {CAMERA_MOTION_EFFECT_LABELS[eff]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Motion Intensity */}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-neutral-600">Motion Intensity</label>
                    <select
                      disabled={selectedScene.cameraMotion?.effect === "NONE"}
                      value={selectedScene.cameraMotion?.intensity ?? "SUBTLE"}
                      onChange={(e) => {
                        const newIntensity = e.target.value as CameraMotionIntensity;
                        const currentEffect = selectedScene.cameraMotion?.effect ?? "AUTO";
                        const currentFocal = selectedScene.cameraMotion?.focalPosition ?? "CENTER";
                        updateScene(selectedScene.id, {
                          cameraMotion: {
                            effect: currentEffect,
                            intensity: newIntensity,
                            focalPosition: currentFocal,
                          },
                        });
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
                    >
                      {CAMERA_MOTION_INTENSITIES.map((intens) => (
                        <option key={intens} value={intens}>
                          {CAMERA_MOTION_INTENSITY_LABELS[intens]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Focal Anchor */}
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-neutral-600">Focal Anchor</label>
                    <select
                      disabled={selectedScene.cameraMotion?.effect === "NONE"}
                      value={selectedScene.cameraMotion?.focalPosition ?? "CENTER"}
                      onChange={(e) => {
                        const newFocal = e.target.value as FocalPosition;
                        const currentEffect = selectedScene.cameraMotion?.effect ?? "AUTO";
                        const currentIntensity = selectedScene.cameraMotion?.intensity ?? "SUBTLE";
                        updateScene(selectedScene.id, {
                          cameraMotion: {
                            effect: currentEffect,
                            intensity: currentIntensity,
                            focalPosition: newFocal,
                          },
                        });
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
                    >
                      {FOCAL_POSITIONS.map((fp) => (
                        <option key={fp} value={fp}>
                          {FOCAL_POSITION_LABELS[fp]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Selected Motion Descriptor / Live Indicator */}
                {(() => {
                  const effectiveEffect = selectedScene.cameraMotion?.effect ?? "AUTO";
                  const effectiveIntensity = selectedScene.cameraMotion?.intensity ?? "SUBTLE";
                  const resolved = resolveSceneCameraMotion(selectedScene.cameraMotion, selectedIndex);
                  const focalLabel = resolved.focalPosition !== "CENTER" ? ` · ${FOCAL_POSITION_LABELS[resolved.focalPosition].split(" (")[0]} Anchor` : "";

                  return (
                    <div className="flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-700 border border-neutral-100">
                      <span className="font-medium text-neutral-900">Active Effect:</span>
                      {effectiveEffect === "AUTO" ? (
                        <span>
                          <span className="inline-flex items-center rounded-md bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700 ring-1 ring-inset ring-purple-600/20 mr-1.5">
                            AUTO
                          </span>
                          Resolves to <strong>{CAMERA_MOTION_EFFECT_LABELS[resolved.effect]}</strong> ({CAMERA_MOTION_INTENSITY_LABELS[resolved.intensity]}{focalLabel})
                        </span>
                      ) : effectiveEffect === "NONE" ? (
                        <span className="text-neutral-500">Static image (No motion applied)</span>
                      ) : (
                        <span>
                          <strong>{CAMERA_MOTION_EFFECT_LABELS[effectiveEffect]}</strong> ({CAMERA_MOTION_INTENSITY_LABELS[effectiveIntensity]}{focalLabel})
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
            </div>
          </div>

          {/* RIGHT PANE: Settings, Output Aspect Ratio & Dimension Display */}
          <aside className="space-y-4">
            {/* Output Aspect Ratio Box */}
            <div className={`${card} p-4 space-y-3`}>
              <span className={labelStyle}>Aspect Ratio & Resolution</span>
              <div className="space-y-1.5">
                {ASPECT_RATIOS.map((r) => {
                  const cfg = ASPECT_RATIO_CONFIG[r];
                  const isSelected = aspectRatio === r;
                  return (
                    <div
                      key={r}
                      onClick={() => {
                        setAspectRatio(r);
                        setIsDirty(true);
                      }}
                      className={`cursor-pointer rounded-lg border p-2 text-xs transition ${
                        isSelected
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-xs"
                          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{cfg.label.split(" – ")[0]}</span>
                        <span className={`font-mono text-[10px] ${isSelected ? "text-neutral-300" : "text-neutral-500"}`}>
                          {cfg.dimensions}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-2 text-center text-xs">
                <span className="text-neutral-500">Dimensions:</span>{" "}
                <strong className="font-mono text-neutral-900">{ratioConfig.dimensions}</strong>
              </div>
            </div>

            {/* Default Camera Motion (Part C3.5) */}
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={labelStyle}>Default Camera Motion</span>
                <span className="text-[10px] text-neutral-400">New scenes</span>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-neutral-600">Default Effect</label>
                  <select
                    value={defaultCameraMotion?.effect ?? "AUTO"}
                    onChange={(e) => {
                      const newEffect = e.target.value as CameraMotionEffect;
                      setDefaultCameraMotion((prev) => ({
                        effect: newEffect,
                        intensity: prev?.intensity ?? "SUBTLE",
                        focalPosition: prev?.focalPosition ?? "CENTER",
                      }));
                      setIsDirty(true);
                    }}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
                  >
                    {CAMERA_MOTION_EFFECTS.map((eff) => (
                      <option key={eff} value={eff}>
                        {CAMERA_MOTION_EFFECT_LABELS[eff]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-neutral-600">Default Intensity</label>
                  <select
                    disabled={defaultCameraMotion?.effect === "NONE"}
                    value={defaultCameraMotion?.intensity ?? "SUBTLE"}
                    onChange={(e) => {
                      const newIntensity = e.target.value as CameraMotionIntensity;
                      setDefaultCameraMotion((prev) => ({
                        effect: prev?.effect ?? "AUTO",
                        intensity: newIntensity,
                        focalPosition: prev?.focalPosition ?? "CENTER",
                      }));
                      setIsDirty(true);
                    }}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
                  >
                    {CAMERA_MOTION_INTENSITIES.map((intens) => (
                      <option key={intens} value={intens}>
                        {CAMERA_MOTION_INTENSITY_LABELS[intens]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-neutral-600">Default Focal Anchor</label>
                  <select
                    disabled={defaultCameraMotion?.effect === "NONE"}
                    value={defaultCameraMotion?.focalPosition ?? "CENTER"}
                    onChange={(e) => {
                      const newFocal = e.target.value as FocalPosition;
                      setDefaultCameraMotion((prev) => ({
                        effect: prev?.effect ?? "AUTO",
                        intensity: prev?.intensity ?? "SUBTLE",
                        focalPosition: newFocal,
                      }));
                      setIsDirty(true);
                    }}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none disabled:bg-neutral-100 disabled:text-neutral-400"
                  >
                    {FOCAL_POSITIONS.map((fp) => (
                      <option key={fp} value={fp}>
                        {FOCAL_POSITION_LABELS[fp]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Brand Watermark (Part C3.6) */}
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex items-center justify-between">
                <span className={labelStyle}>Brand Watermark</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={watermark.enabled}
                    onChange={(e) => {
                      setWatermark((prev) => ({ ...prev, enabled: e.target.checked }));
                      setIsDirty(true);
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              {/* Logo Preview */}
              <div className="relative rounded-lg border border-neutral-200 bg-neutral-900 p-2 flex items-center justify-center overflow-hidden h-12">
                <img
                  src="/logo-watermark.png"
                  alt="REBX Watermark Logo"
                  className="max-h-8 object-contain transition-opacity duration-200"
                  style={{ opacity: watermark.enabled ? watermark.opacity : 0.25 }}
                />
                {!watermark.enabled && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-[10px] font-medium text-neutral-300">
                    Watermark Disabled
                  </span>
                )}
              </div>

              {watermark.enabled && (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-neutral-600">Position</label>
                    <select
                      value={watermark.position}
                      onChange={(e) => {
                        const newPos = e.target.value as WatermarkPosition;
                        setWatermark((prev) => ({ ...prev, position: newPos }));
                        setIsDirty(true);
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
                    >
                      {WATERMARK_POSITIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {WATERMARK_POSITION_LABELS[pos]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-neutral-600">Size</label>
                    <select
                      value={watermark.size}
                      onChange={(e) => {
                        const newSize = e.target.value as WatermarkSize;
                        setWatermark((prev) => ({ ...prev, size: newSize }));
                        setIsDirty(true);
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
                    >
                      {WATERMARK_SIZES.map((sz) => (
                        <option key={sz} value={sz}>
                          {WATERMARK_SIZE_LABELS[sz]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-medium text-neutral-600">Opacity</label>
                      <span className="text-[10px] font-mono text-neutral-500">
                        {Math.round(watermark.opacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="100"
                      step="5"
                      value={Math.round(watermark.opacity * 100)}
                      onChange={(e) => {
                        const newOpacity = Number(e.target.value) / 100;
                        setWatermark((prev) => ({ ...prev, opacity: newOpacity }));
                        setIsDirty(true);
                      }}
                      className="w-full accent-neutral-900 cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Project Settings Summary */}
            <div className={`${card} p-4 space-y-2 text-xs text-neutral-600`}>
              <span className={labelStyle}>Project Details</span>
              <div className="flex justify-between py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Category:</span>
                <span className="font-medium text-neutral-800">{CONTENT_CATEGORY_LABELS[category]}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Language:</span>
                <span className="font-medium text-neutral-800">{language}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-neutral-100">
                <span className="text-neutral-500">Tone:</span>
                <span className="font-medium text-neutral-800">{tone}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-neutral-500">Status:</span>
                <span className="font-medium text-neutral-800">{STATUS_LABELS[status]}</span>
              </div>

              
            </div>

            {/* Validation & Production Readiness Checks */}
            <div className={`${card} p-4 space-y-2`}>
              <div className="flex items-center justify-between gap-2">
                <span className={labelStyle}>Validation Checks</span>
                {scenes.some((s) => s.audio?.status === "ready") && (
                  <button
                    type="button"
                    disabled={Boolean(busyMessage) || isDirty}
                    onClick={() => void handleSyncProjectAudioTiming(true)}
                    className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition"
                    title="Recalculate exact voiceover durations and extend short scenes to fit"
                  >
                    Sync Timing
                  </button>
                )}
              </div>
              {warnings.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  All scenes valid and ready.
                </div>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {warnings.map((w, idx) => (
                    <li key={idx} className={w.level === "error" ? "text-red-700 font-medium" : "text-amber-700"}>
                      • {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Master Export Section */}
            <div className={`${card} p-4 space-y-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className={labelStyle}>Master Export</span>
                {latestRenderJob?.status === "COMPLETED" ? (
                  <button
                    type="button"
                    disabled={
                      isDirty ||
                      !effectiveRenderReport.valid ||
                      renderBusy ||
                      Boolean(busyMessage)
                    }
                    onClick={handleCreateRenderJob}
                    className="rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition"
                  >
                    {renderBusy ? "Working..." : "Re-assemble Video"}
                  </button>
                ) : (
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      isDirty
                        ? "bg-amber-50 text-amber-800 border-amber-200"
                        : effectiveRenderReport.valid
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                    }`}
                  >
                    {isDirty
                      ? "Save Draft First"
                      : effectiveRenderReport.valid
                        ? "Ready to Queue"
                        : `${effectiveRenderReport.errors.length} Blocker${effectiveRenderReport.errors.length === 1 ? "" : "s"}`}
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] text-neutral-600 leading-relaxed">
                Creating a render job validates scenes and freezes an immutable snapshot for background H.264/AAC MP4 encoding and private storage delivery.
              </div>

              {isDirty && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[11px] text-amber-900">
                  You have unsaved workspace edits. Click <strong>Save as Draft</strong> before creating a render job.
                </div>
              )}

              {renderReadiness.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
                  {renderReadiness.error}
                </div>
              )}

              {effectiveRenderReport.errors.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-red-700">Pre-Render Validation Issues:</div>
                  <ul className="space-y-1 text-[11px] text-red-700 max-h-36 overflow-y-auto">
                    {effectiveRenderReport.errors.map((err, i) => (
                      <li key={`${err.code}-${i}`}>• {err.message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {effectiveRenderReport.warnings.length > 0 && (
                <div className="space-y-2">
                  <ul className="space-y-1 text-[11px] text-amber-700 max-h-24 overflow-y-auto">
                    {effectiveRenderReport.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`}>• {w.message}</li>
                    ))}
                  </ul>
                  {effectiveRenderReport.warnings.some((w) => w.code === "AUDIO_LONGER_THAN_SCENE") && (
                    <button
                      type="button"
                      disabled={Boolean(busyMessage) || renderBusy || isDirty}
                      onClick={() => void handleSyncProjectAudioTiming(true)}
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 transition"
                    >
                      Fix Audio Durations &amp; Fit Scenes
                    </button>
                  )}
                </div>
              )}

              {latestRenderJob?.status !== "COMPLETED" && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={
                      isDirty ||
                      !effectiveRenderReport.valid ||
                      renderBusy ||
                      Boolean(busyMessage)
                    }
                    onClick={handleCreateRenderJob}
                    className="flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition"
                  >
                    {renderBusy ? "Working..." : "Create Video"}
                  </button>
                  <button
                    type="button"
                    disabled={renderReadiness.loading || renderBusy || isDirty}
                    onClick={() => void refreshRenderValidationAndJobs()}
                    className={btn}
                  >
                    {renderReadiness.loading ? "Checking..." : "Validate"}
                  </button>
                </div>
              )}

              {latestRenderJob && (
                <div className={`${latestRenderJob.status === "COMPLETED" ? "" : "border-t border-neutral-200 pt-3"} space-y-2`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                      Latest Render Job
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${renderJobStatusBadgeClass(
                        latestRenderJob.status,
                      )}`}
                    >
                      {RENDER_JOB_STATUS_LABELS[latestRenderJob.status]}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-neutral-600">
                      <span className="truncate">{latestRenderJob.stage ?? "Pending"}</span>
                      <span className="font-mono font-semibold text-neutral-900">{latestRenderJob.progress}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                      <div
                        className={`h-full transition-all ${
                          latestRenderJob.status === "FAILED"
                            ? "bg-red-600"
                            : latestRenderJob.status === "COMPLETED"
                              ? "bg-emerald-600"
                              : "bg-neutral-900"
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, latestRenderJob.progress))}%` }}
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-neutral-500 space-y-0.5">
                    <div>
                      Created:{" "}
                      <span className="text-neutral-700">
                        {new Date(latestRenderJob.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                    {latestRenderJob.retryCount > 0 && (
                      <div>
                        Retries: <span className="font-mono text-neutral-700">{latestRenderJob.retryCount}</span>
                      </div>
                    )}
                  </div>

                  {latestRenderJob.status === "FAILED" && latestRenderJob.errorMessage && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
                      {latestRenderJob.errorMessage}
                    </div>
                  )}

                  {latestRenderJob.status === "COMPLETED" && (
                    <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5">
                      {latestRenderJob.outputStorageKey &&
                      !brokenVideoJobIds[getVideoInstanceKey(latestRenderJob)] ? (
                        <div
                          className={`overflow-hidden rounded-lg border border-neutral-800 bg-black ${getVideoPreviewFrameClass(
                            latestRenderJob.snapshot.renderSettings.aspectRatio,
                          )}`}
                        >
                          <video
                            key={getVideoInstanceKey(latestRenderJob)}
                            controls
                            preload="metadata"
                            playsInline
                            poster={effectiveThumbnailUrl ?? undefined}
                            className="h-full w-full object-contain"
                            src={getAdminRenderVideoUrl(latestRenderJob.id)}
                            onError={() =>
                              setBrokenVideoJobIds((prev) => ({
                                ...prev,
                                [getVideoInstanceKey(latestRenderJob)]: true,
                              }))
                            }
                          />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                          Rendered video output is currently unavailable in storage.
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-600">
                        <span>
                          {latestRenderJob.snapshot.renderSettings.aspectRatio} ·{" "}
                          {latestRenderJob.snapshot.renderSettings.dimensions}
                        </span>
                        {typeof latestRenderJob.outputMetadata?.renderedDurationSec === "number" && (
                          <span>• {latestRenderJob.outputMetadata.renderedDurationSec.toFixed(1)}s</span>
                        )}
                        {formatVideoFileSize(latestRenderJob.outputMetadata?.fileSizeBytes) && (
                          <span>
                            • {formatVideoFileSize(latestRenderJob.outputMetadata?.fileSizeBytes)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {latestRenderJob.status === "COMPLETED" && latestRenderJob.outputStorageKey && (
                      <a
                        href={getAdminRenderVideoUrl(latestRenderJob.id, true)}
                        download
                        className="rounded-lg bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 transition"
                      >
                        Download MP4
                      </a>
                    )}
                    {canCancelRenderJob(latestRenderJob.status) && (
                      <button
                        type="button"
                        disabled={renderBusy}
                        onClick={() => handleCancelRenderJob(latestRenderJob.id)}
                        className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Cancel Job
                      </button>
                    )}
                    {canRetryRenderJob(latestRenderJob.status) && (
                      <button
                        type="button"
                        disabled={renderBusy}
                        onClick={() => handleRetryRenderJob(latestRenderJob.id)}
                        className="rounded-lg bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                      >
                        Retry Job
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewMode("renders")}
                      className={btn}
                    >
                      Job History ({renderJobs.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* VIEW: Review as Flow (Storyboard) */}
      {viewMode === "flow" && (
        <div className="space-y-4">
          <div className="rounded-lg bg-neutral-100 p-3 text-xs text-neutral-600 flex items-center justify-between">
            <span>
              Storyboard visual presentation flow ({scenes.length} scenes, {currentTotalDuration}s total).
            </span>
            <button type="button" onClick={() => setViewMode("edit")} className={btn}>
              Return to Scene Editor
            </button>
          </div>

          <div className="space-y-3">
            {scenes.map((s, idx) => (
              <article key={s.id} className={`${card} flex flex-col sm:flex-row gap-4 p-4`}>
                <div className="h-28 w-44 shrink-0 overflow-hidden rounded-lg bg-neutral-100 border border-neutral-200 flex items-center justify-center">
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt={s.title} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-neutral-400">No image</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm text-neutral-900">
                      {idx + 1}. {s.title}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                        {s.cameraMotion?.effect === "NONE"
                          ? "Motion: None"
                          : s.cameraMotion?.effect && s.cameraMotion.effect !== "AUTO"
                          ? `Motion: ${CAMERA_MOTION_EFFECT_LABELS[s.cameraMotion.effect].replace("Slow ", "")}`
                          : `Motion: Auto (${CAMERA_MOTION_EFFECT_LABELS[resolveSceneCameraMotion(s.cameraMotion, idx).effect].replace("Slow ", "")})`}
                      </span>
                      <span className="text-xs text-neutral-400 font-mono">{s.duration}s</span>
                    </div>
                  </div>
                  <p className="text-xs text-neutral-700 leading-relaxed">
                    {s.narration || <em className="text-neutral-400">No narration provided</em>}
                  </p>
                  {s.audio?.audioUrl && (
                    <div className="pt-2">
                      <audio key={s.audio.audioUrl} controls preload="metadata" className="w-full max-w-md h-8">
                        <source src={s.audio.audioUrl} type={s.audio.mimeType} />
                      </audio>
                    </div>
                  )}
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => speakNarration(s.narration)}
                      className="text-xs text-neutral-600 underline hover:text-neutral-900"
                    >
                      ▶ Quick Speech Preview
                    </button>
                    <span className="text-neutral-300">•</span>
                    <button
                      type="button"
                      onClick={() => copyText(s.imagePrompt, "Image prompt")}
                      className="text-xs text-neutral-600 underline hover:text-neutral-900"
                    >
                      Copy Prompt
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* VIEW: Versioned JSON Project Structure (Section 6) */}
      {viewMode === "json" && (
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Versioned Project JSON Structure</h3>
              <p className="text-xs text-neutral-500">
                Schema Version: <code>1.0.0</code> — Reflects current workspace settings and scenes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyText(JSON.stringify(currentJson, null, 2), "Project JSON")}
              className={btn}
            >
              Copy Full JSON
            </button>
          </div>
          <pre className="max-h-[500px] overflow-auto rounded-lg bg-neutral-900 p-4 font-mono text-xs text-neutral-100">
            {JSON.stringify(currentJson, null, 2)}
          </pre>
        </div>
      )}

      {/* VIEW: Version History & Restore */}
      {viewMode === "history" && (
        <div className={`${card} p-5 space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">Project Version History</h3>
              <p className="text-xs text-neutral-500">
                Up to 50 automatic snapshots are saved whenever a draft is created, saved, duplicated, or restored.
              </p>
            </div>
            <button type="button" onClick={() => setViewMode("edit")} className={btn}>
              Return to Scene Editor
            </button>
          </div>

          {versions.length === 0 ? (
            <p className="text-xs text-neutral-500 py-6 text-center">No version snapshots recorded yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-200">
              {versions.map((v, idx) => (
                <li key={v.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-neutral-900">{v.reason}</span>
                      {idx === 0 && (
                        <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Latest
                        </span>
                      )}
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-600">
                        {v.aspectRatio}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                      <span>{new Date(v.createdAt).toLocaleString("en-IN")}</span>
                      <span>•</span>
                      <span>{v.sceneCount} scene{v.sceneCount === 1 ? "" : "s"}</span>
                      <span>•</span>
                      <span>{v.totalDuration}s</span>
                      {v.title && (
                        <>
                          <span>•</span>
                          <span className="truncate">{v.title}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <button
                      type="button"
                      disabled={Boolean(busyMessage)}
                      onClick={() => handleRestoreVersion(v)}
                      className={btn}
                    >
                      Restore Snapshot
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* VIEW: Render Jobs & Pre-Render Validation (Phase 3 Part C2) */}
      {viewMode === "renders" && (
        <div className="space-y-4">
          <div className={`${card} p-5 space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Render Job Management
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Validate scenes, capture an immutable project snapshot, and track queued render jobs for this project.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={renderReadiness.loading || renderBusy || isDirty}
                  onClick={() => void refreshRenderValidationAndJobs()}
                  className={btn}
                >
                  {renderReadiness.loading ? "Validating..." : "Re-validate Project"}
                </button>
                <button
                  type="button"
                  disabled={isDirty || !effectiveRenderReport.valid || renderBusy || Boolean(busyMessage)}
                  onClick={handleCreateRenderJob}
                  className={btnPrimary}
                >
                  {renderBusy ? "Creating Job..." : "Create Video"}
                </button>
                <button type="button" onClick={() => setViewMode("edit")} className={btn}>
                  Return to Scene Editor
                </button>
              </div>

              
            </div>

            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
              <strong>Background MP4 Rendering Pipeline:</strong> Validated jobs freeze an immutable snapshot and render via FFmpeg (H.264 / AAC) in the standalone worker, storing completed MP4 files privately for authenticated admin preview and download.
            </div>

            {isDirty && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                Unsaved workspace changes detected. Click <strong>Save as Draft</strong> below so server validation and the immutable render snapshot include your latest edits.
              </div>
            )}

            {/* Pre-Render Validation Report */}
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-neutral-900">
                  Pre-Render Validation Results
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                    isDirty
                      ? "bg-amber-50 text-amber-800 border-amber-200"
                      : effectiveRenderReport.valid
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-red-50 text-red-700 border-red-200"
                  }`}
                >
                  {isDirty
                    ? "Save Draft Before Rendering"
                    : effectiveRenderReport.valid
                      ? "All Render Requirements Passed"
                      : `${effectiveRenderReport.errors.length} Blocking Error${effectiveRenderReport.errors.length === 1 ? "" : "s"}`}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-600">
                <span>
                  Scenes: <strong className="text-neutral-900">{effectiveRenderReport.summary.sceneCount}</strong>
                </span>
                <span>
                  Total Duration:{" "}
                  <strong className="text-neutral-900">{effectiveRenderReport.summary.totalDurationSec}s</strong>
                </span>
                <span>
                  Output:{" "}
                  <strong className="text-neutral-900">
                    {effectiveRenderReport.summary.aspectRatio}
                    {effectiveRenderReport.summary.dimensions
                      ? ` (${effectiveRenderReport.summary.dimensions})`
                      : ""}
                  </strong>
                </span>
              </div>

              {effectiveRenderReport.errors.length > 0 && (
                <ul className="space-y-1 text-xs text-red-700 pt-1">
                  {effectiveRenderReport.errors.map((err, i) => (
                    <li key={`${err.code}-${i}`}>• {err.message}</li>
                  ))}
                </ul>
              )}

              {effectiveRenderReport.warnings.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-700 pt-1">
                  {effectiveRenderReport.warnings.map((w, i) => (
                    <li key={`${w.code}-${i}`}>• Warning: {w.message}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Project Render Job History */}
          <div className={`${card} p-5 space-y-4`}>
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Project Render Job History ({renderJobs.length})
                </h3>
                <p className="text-xs text-neutral-500">
                  Each job preserves an immutable snapshot of project settings, scene order, images, and audio keys at creation time.
                </p>
              </div>
              <button
                type="button"
                disabled={renderBusy}
                onClick={() => void refreshRenderValidationAndJobs()}
                className={btn}
              >
                Refresh List
              </button>
            </div>

            {renderJobs.length === 0 ? (
              <p className="text-xs text-neutral-500 py-8 text-center">
                No render jobs have been created for this project yet.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {renderJobs.map((job) => {
                  const isExpanded = expandedSnapshotJobId === job.id;
                  const targetOutputKey = job.outputStorageKey ?? job.outputMetadata?.targetOutputKey ?? null;

                  return (
                    <li key={job.id} className="py-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${renderJobStatusBadgeClass(
                                job.status,
                              )}`}
                            >
                              {RENDER_JOB_STATUS_LABELS[job.status]}
                            </span>
                            <code className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-mono text-neutral-700">
                              {job.id}
                            </code>
                            <span className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-mono text-neutral-600">
                              {job.snapshot.renderSettings.aspectRatio} · {job.snapshot.renderSettings.dimensions}
                            </span>
                            {job.retryCount > 0 && (
                              <span className="rounded bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                Retries: {job.retryCount}
                              </span>
                            )}
                          </div>

                          <div className="space-y-1 max-w-xl">
                            <div className="flex items-center justify-between text-xs text-neutral-600">
                              <span>
                                Stage:{" "}
                                <strong className="text-neutral-800">
                                  {job.stage ?? RENDER_JOB_STATUS_LABELS[job.status]}
                                </strong>
                              </span>
                              <span className="font-mono font-semibold text-neutral-900">{job.progress}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                              <div
                                className={`h-full transition-all ${
                                  job.status === "FAILED"
                                    ? "bg-red-600"
                                    : job.status === "COMPLETED"
                                      ? "bg-emerald-600"
                                      : "bg-neutral-900"
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                              />
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                            <span>Created: {new Date(job.createdAt).toLocaleString("en-IN")}</span>
                            {job.startedAt && (
                              <span>Started: {new Date(job.startedAt).toLocaleString("en-IN")}</span>
                            )}
                            {job.completedAt && (
                              <span>Completed: {new Date(job.completedAt).toLocaleString("en-IN")}</span>
                            )}
                            {job.cancelledAt && (
                              <span>Cancelled: {new Date(job.cancelledAt).toLocaleString("en-IN")}</span>
                            )}
                            <span>
                              {job.snapshot.scenes.length} scene{job.snapshot.scenes.length === 1 ? "" : "s"} ·{" "}
                              {job.snapshot.renderSettings.totalDurationSec}s
                            </span>
                          </div>

                          {targetOutputKey && (
                            <div className="text-[11px] text-neutral-500">
                              {job.outputStorageKey ? "Output Key:" : "Planned Output Target:"}{" "}
                              <code className="font-mono text-neutral-700">{targetOutputKey}</code>
                            </div>
                          )}

                          {job.status === "FAILED" && job.errorMessage && (
                            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
                              <strong>Error:</strong> {job.errorMessage}
                            </div>
                          )}

                          {job.status === "COMPLETED" && (
                            <div className="pt-2 space-y-2.5 max-w-2xl">
                              {job.outputStorageKey && !brokenVideoJobIds[getVideoInstanceKey(job)] ? (
                                <div className="rounded-xl border border-neutral-200 bg-neutral-950 p-3">
                                  <div
                                    className={`overflow-hidden rounded-lg bg-black ${getVideoPreviewFrameClass(
                                      job.snapshot.renderSettings.aspectRatio,
                                    )}`}
                                  >
                                    <video
                                      key={getVideoInstanceKey(job)}
                                      controls
                                      preload="metadata"
                                      playsInline
                                      className="h-full w-full object-contain"
                                      src={getAdminRenderVideoUrl(job.id)}
                                      onError={() =>
                                        setBrokenVideoJobIds((prev) => ({
                                          ...prev,
                                          [getVideoInstanceKey(job)]: true,
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                                  Rendered video output is currently unavailable in storage.
                                </div>
                              )}

                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600">
                                <span>
                                  Format:{" "}
                                  <strong className="text-neutral-900">
                                    MP4 ({job.snapshot.renderSettings.aspectRatio} ·{" "}
                                    {job.snapshot.renderSettings.dimensions})
                                  </strong>
                                </span>
                                {typeof job.outputMetadata?.renderedDurationSec === "number" && (
                                  <span>
                                    Duration:{" "}
                                    <strong className="text-neutral-900">
                                      {job.outputMetadata.renderedDurationSec.toFixed(1)}s
                                    </strong>
                                  </span>
                                )}
                                {formatVideoFileSize(job.outputMetadata?.fileSizeBytes) && (
                                  <span>
                                    Size:{" "}
                                    <strong className="text-neutral-900">
                                      {formatVideoFileSize(job.outputMetadata?.fileSizeBytes)}
                                    </strong>
                                  </span>
                                )}
                                {job.outputMetadata?.videoCodec && (
                                  <span>
                                    Codec:{" "}
                                    <strong className="text-neutral-900">
                                      {job.outputMetadata.videoCodec.toUpperCase()}
                                      {job.outputMetadata.audioCodec
                                        ? ` / ${job.outputMetadata.audioCodec.toUpperCase()}`
                                        : ""}
                                    </strong>
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {job.status === "COMPLETED" && job.outputStorageKey && (
                            <a
                              href={getAdminRenderVideoUrl(job.id, true)}
                              download
                              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 transition"
                            >
                              Download MP4
                            </a>
                          )}
                          {canCancelRenderJob(job.status) && (
                            <button
                              type="button"
                              disabled={renderBusy}
                              onClick={() => handleCancelRenderJob(job.id)}
                              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                            >
                              Cancel
                            </button>
                          )}
                          {canRetryRenderJob(job.status) && (
                            <button
                              type="button"
                              disabled={renderBusy}
                              onClick={() => handleRetryRenderJob(job.id)}
                              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50 transition"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={renderBusy}
                            onClick={() => handleRefreshRenderJob(job.id)}
                            className={btn}
                          >
                            Refresh Status
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedSnapshotJobId(isExpanded ? null : job.id)}
                            className={btn}
                          >
                            {isExpanded ? "Hide Snapshot" : "Inspect Snapshot"}
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                            <span>
                              Snapshot Hash:{" "}
                              <code className="font-mono text-neutral-800">{job.snapshotHash}</code>
                            </span>
                            <span>
                              Captured:{" "}
                              <strong className="text-neutral-800">
                                {new Date(job.snapshot.capturedAt).toLocaleString("en-IN")}
                              </strong>
                            </span>
                          </div>
                          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
                            {job.snapshot.scenes.map((scene) => (
                              <li key={scene.sceneId} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <div className="min-w-0">
                                  <span className="font-semibold text-neutral-900">
                                    {scene.order}. {scene.title}
                                  </span>{" "}
                                  <span className="text-neutral-500">({scene.durationSec}s)</span>
                                  <div className="text-neutral-500 truncate max-w-lg">
                                    Image: <code>{scene.image.resolvedPathOrKey}</code> · Audio:{" "}
                                    <code>{scene.audio.resolvedKey}</code> ({scene.audio.format.toUpperCase()},{" "}
                                    {scene.audio.durationSec.toFixed(1)}s)
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Bottom Sticky Action Bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-6 py-3.5 backdrop-blur shadow-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          {/* Left Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setBulkProgress(null);
                setShowBulkUpload(true);
              }}
              className={btn}
            >
              Bulk Upload Images
            </button>
            <button
              type="button"
              onClick={() =>
                copyText(
                  scenes.map((s, i) => `Scene ${i + 1} (${s.title}):\n${s.imagePrompt}`).join("\n\n"),
                  "All image prompts",
                )
              }
              className={btn}
            >
              Copy All Prompts
            </button>
            <button
              type="button"
              onClick={() => copyText(JSON.stringify(currentJson, null, 2), "Project JSON")}
              className={btn}
            >
              Export JSON
            </button>
            <button type="button" onClick={handleDuplicateProject} disabled={Boolean(busyMessage)} className={btn}>
              Duplicate Project
            </button>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={Boolean(busyMessage)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>

          {/* Right Actions: Status & Save */}
          <div className="flex items-center gap-3">
            {isDirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
            {busyMessage && <span className="text-xs text-neutral-500">{busyMessage}</span>}

            {/* Status Transition Selector */}
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as ProjectStatus)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800"
            >
              {PROJECT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  Status: {STATUS_LABELS[st]}
                </option>
              ))}
            </select>

            <button type="button" onClick={handleSaveDraft} disabled={Boolean(busyMessage)} className={btnPrimary}>
              Save as Draft
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="max-w-md w-full rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-neutral-900">Delete Video Project?</h3>
            <p className="text-xs text-neutral-600">
              Are you sure you want to delete <strong>&quot;{title}&quot;</strong>? This will permanently remove all
              scenes, unshared uploaded assets, and version history. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowDeleteConfirm(false)} className={btn}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProject}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
              >
                Yes, Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
