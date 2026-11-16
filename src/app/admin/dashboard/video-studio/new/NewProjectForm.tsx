"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_CONFIG,
  CONTENT_CATEGORIES,
  CONTENT_CATEGORY_LABELS,
  LANGUAGES,
  REBX_CONTENT_IDEAS,
  TONES,
  sceneCameraMotionSchema,
  type AspectRatio,
  type ContentCategory,
  type ContentIdea,
  type EditorScene,
  type Language,
  type SceneCameraMotion,
  type SourceHit,
  type SourceType,
  type Tone,
} from "@/lib/video-studio/schemas";
import {
  checkGeminiStatusAction,
  createProjectAction,
  generateScriptWithGeminiAction,
  getSourceSummaryAction,
  searchSourcesAction,
} from "@/lib/actions/video-studio";
import { countWords, estimateDurationSec, extractAndParseJson, newTempId, totalDuration } from "@/lib/video-studio/script-utils";

const card = "rounded-xl border border-neutral-200 bg-white p-5 shadow-xs";
const labelStyle = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-neutral-500";
const inputStyle =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none transition";
const btnSecondary =
  "rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50 transition";

const AUDIENCE_OPTIONS = [
  "Customers (Homebuyers & Renters)",
  "Agents & Real Estate Brokers",
  "Builders & Developers",
  "General / First-Time Buyers",
];

const EXAMPLE_JSON_PAYLOAD = JSON.stringify(
  {
    title: "Hyderabad's Fast Growing Luxury Corridor: Tellapur",
    description: "Overview of Tellapur's high-rise communities, connectivity, and investment appreciation.",
    thumbnailPrompt:
      "Eye-catching modern luxury high-rise tower in Tellapur Hyderabad against a dramatic sunset golden hour sky, bold cinematic architectural aesthetic, 4k ultra-detailed",
    scenes: [
      {
        title: "Hook: Why West Hyderabad?",
        narration: "Looking for your dream luxury home in Hyderabad's fastest growing hub?",
        imagePrompt:
          "Cinematic aerial drone shot of modern luxury high-rise towers in Tellapur Hyderabad during golden hour, wide roads, 4k photorealistic",
        duration: 5,
      },
      {
        title: "Spacious High-Rise Residences",
        narration:
          "Enjoy expansive 3BHK layouts with Italian marble flooring, 10-foot ceilings, and scenic balcony vistas.",
        imagePrompt:
          "Sunlit modern luxury apartment living room with expansive balcony, floor-to-ceiling glass windows, warm neutral decor",
        duration: 7,
      },
      {
        title: "Call to Action on REBX",
        narration:
          "Compare RERA-verified luxury homes and schedule your private site visit on REBX today.",
        imagePrompt:
          "Modern smartphone showing REBX verified real estate listing with an 'Approved' badge, luxury apartment foyer background",
        duration: 6,
      },
    ],
  },
  null,
  2,
);

type ScriptMethod = "gemini" | "json" | "manual";

export default function NewProjectForm() {
  const router = useRouter();

  // Gemini Server Status
  const [geminiStatus, setGeminiStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  // Script Creation Method
  const [method, setMethod] = useState<ScriptMethod>("gemini");

  // Tab 2 & 3 Helpers
  const [sourceType, setSourceType] = useState<SourceType>("CUSTOM_SCRIPT");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceHits, setSourceHits] = useState<SourceHit[] | null>(null);
  const [pickedListing, setPickedListing] = useState<SourceHit | null>(null);
  const [listingFacts, setListingFacts] = useState("");

  // Video Settings
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState<ContentCategory>("property_showcase");
  const [targetAudience, setTargetAudience] = useState("Customers (Homebuyers & Renters)");
  const [language, setLanguage] = useState<Language>("English");
  const [tone, setTone] = useState<Tone>("Professional");
  const [desiredDuration, setDesiredDuration] = useState(60);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [thumbnailPrompt, setThumbnailPrompt] = useState("");
  const [thumbnailPromptCopied, setThumbnailPromptCopied] = useState(false);

  async function handleCopyThumbnailPrompt() {
    if (!thumbnailPrompt.trim()) return;
    try {
      await navigator.clipboard.writeText(thumbnailPrompt.trim());
      setThumbnailPromptCopied(true);
      setTimeout(() => setThumbnailPromptCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  // Motion Settings
  const [defaultCameraMotion, setDefaultCameraMotion] = useState<SceneCameraMotion>({
    effect: "AUTO",
    intensity: "SUBTLE",
    focalPosition: "CENTER",
  });

  // Option B: Manual JSON input
  const [pastedJson, setPastedJson] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Editable Scenes Preview (Commitment Stage)
  const [scenes, setScenes] = useState<
    {
      id: string;
      title: string;
      narration: string;
      imagePrompt: string;
      duration: number;
      cameraMotion?: SceneCameraMotion | null;
    }[]
  >([
    {
      id: newTempId(),
      title: "Hook: Attention Grabber",
      narration: "",
      imagePrompt: "",
      duration: 5,
    },
    {
      id: newTempId(),
      title: "Key Feature Showcase",
      narration: "",
      imagePrompt: "",
      duration: 8,
    },
    {
      id: newTempId(),
      title: "Call to Action",
      narration: "Browse verified listings and schedule your site visit on REBX.",
      imagePrompt: "",
      duration: 5,
    },
  ]);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const currentRatioConfig = ASPECT_RATIO_CONFIG[aspectRatio];
  const calculatedTotalSeconds = totalDuration(scenes);

  // Fetch Gemini status on mount
  useEffect(() => {
    let active = true;
    checkGeminiStatusAction()
      .then((res) => {
        if (!active) return;
        setLoadingStatus(false);
        if (res.ok) {
          setGeminiStatus(res.data);
          // If Gemini not configured, default to JSON or manual mode gracefully
          if (!res.data.configured) {
            setMethod("json");
          }
        }
      })
      .catch(() => {
        if (!active) return;
        setLoadingStatus(false);
        setGeminiStatus({ configured: false, model: "gemini-2.5-flash" });
      });

    return () => {
      active = false;
    };
  }, []);

  /* ---------- Option A: Generate with Gemini ---------- */
  async function handleGenerateWithGemini() {
    setError(null);
    setSuccessNotice(null);

    if (!topic.trim() && !pickedListing) {
      setError("Please describe the topic or key points before generating with Gemini.");
      return;
    }

    if (!geminiStatus?.configured) {
      setError(
        "Gemini API key is not configured on your server. Please set GEMINI_API_KEY in your .env or server environment, or use Option B (Import JSON) below.",
      );
      return;
    }

    setBusy("Generating script with Gemini...");
    try {
      const res = await generateScriptWithGeminiAction({
        topic: topic.trim() || listingFacts || title,
        category,
        targetAudience,
        language,
        tone,
        desiredDuration,
        aspectRatio,
        sourceSummary: pickedListing ? listingFacts : undefined,
      });

      setBusy(null);

      if (!res.ok) {
        setError(res.error);
        return;
      }

      // Populate Title if empty
      if (!title.trim() && res.data.title) {
        setTitle(res.data.title);
      }

      // Populate Thumbnail Prompt if generated
      if (res.data.thumbnailPrompt) {
        setThumbnailPrompt(res.data.thumbnailPrompt);
      }

      // Populate Editable Preview Scenes
      setScenes(
        res.data.scenes.map((s) => ({
          id: newTempId(),
          title: s.title,
          narration: s.narration,
          imagePrompt: s.imagePrompt,
          duration: s.duration,
        })),
      );

      setSuccessNotice(`Generated ${res.data.scenes.length} scenes with Gemini! Review and edit them below before saving.`);
    } catch {
      setBusy(null);
      setError("Failed to connect to the server for Gemini generation.");
    }
  }

  /* ---------- Option B: Import JSON manually ---------- */
  function handleImportJson() {
    setJsonError(null);
    setError(null);
    setSuccessNotice(null);

    if (!pastedJson.trim()) {
      setJsonError("Please paste a JSON object containing a 'scenes' array.");
      return;
    }

    const parsed = extractAndParseJson(pastedJson);
    if (!parsed.ok) {
      setJsonError(parsed.error);
      return;
    }

    const raw = parsed.data;
    const rawScenes = Array.isArray(raw.scenes) ? raw.scenes : [];
    if (!rawScenes.length) {
      setJsonError("Pasted JSON must contain at least one scene in the 'scenes' array.");
      return;
    }

    // Process scenes
    const loadedScenes = rawScenes.map((s: Record<string, unknown>, idx: number) => {
      let cameraMotion: SceneCameraMotion | undefined = undefined;
      const rawMotion = s.cameraMotion || s.camera_motion || s.motion;
      if (rawMotion && typeof rawMotion === "object") {
        const parsed = sceneCameraMotionSchema.safeParse(rawMotion);
        if (parsed.success) cameraMotion = parsed.data;
      } else if (typeof rawMotion === "string") {
        const parsed = sceneCameraMotionSchema.safeParse({ effect: rawMotion });
        if (parsed.success) cameraMotion = parsed.data;
      }

      return {
        id: newTempId(),
        title: String(s.title || `Scene ${idx + 1}`),
        narration: String(s.narration || s.narration_text || ""),
        imagePrompt: String(s.imagePrompt || s.image_prompt || s.visual_prompt || ""),
        duration: Math.min(60, Math.max(2, Math.round(Number(s.duration || s.duration_sec || 6)))),
        cameraMotion,
      };
    });

    const rawDefaultMotion = raw.defaultCameraMotion || raw.default_camera_motion;
    if (rawDefaultMotion && typeof rawDefaultMotion === "object") {
      const parsed = sceneCameraMotionSchema.safeParse(rawDefaultMotion);
      if (parsed.success) setDefaultCameraMotion(parsed.data);
    }

    if (raw.title && typeof raw.title === "string" && !title.trim()) {
      setTitle(raw.title);
    }
    if (raw.description && typeof raw.description === "string" && !topic.trim()) {
      setTopic(raw.description);
    }

    // Extract and prefill Thumbnail Prompt from JSON (supports multiple common schemas & fallbacks)
    const rawThumbPrompt =
      typeof raw.thumbnailPrompt === "string"
        ? raw.thumbnailPrompt
        : typeof raw.thumbnail_prompt === "string"
          ? raw.thumbnail_prompt
          : typeof raw.thumbnailImagePrompt === "string"
            ? raw.thumbnailImagePrompt
            : typeof raw.thumbnail_image_prompt === "string"
              ? raw.thumbnail_image_prompt
              : typeof raw.coverPrompt === "string"
                ? raw.coverPrompt
                : typeof raw.cover_prompt === "string"
                  ? raw.cover_prompt
                  : typeof raw.thumbnail === "string"
                    ? raw.thumbnail
                    : raw.thumbnail && typeof raw.thumbnail === "object"
                      ? String(
                          (raw.thumbnail as Record<string, unknown>).prompt ||
                          (raw.thumbnail as Record<string, unknown>).imagePrompt ||
                          (raw.thumbnail as Record<string, unknown>).image_prompt ||
                          ""
                        )
                      : "";

    if (rawThumbPrompt.trim()) {
      setThumbnailPrompt(rawThumbPrompt.trim());
    } else if (loadedScenes.length > 0 && loadedScenes[0].imagePrompt) {
      // Smart fallback: If JSON does not specify an explicit thumbnailPrompt, prefill using Scene 1 image prompt
      setThumbnailPrompt(loadedScenes[0].imagePrompt);
    }

    setScenes(loadedScenes);
    setSuccessNotice(`Successfully imported ${loadedScenes.length} scenes from JSON! Review and edit them below.`);
  }

  /* ---------- Content Search & Fact Loading (Source Helper) ---------- */
  async function searchListings() {
    setBusy("Searching REBX listings...");
    setError(null);
    const res = await searchSourcesAction({ type: "LISTING", q: searchQuery });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSourceHits(res.data);
  }

  async function pickListing(hit: SourceHit) {
    setBusy("Loading property details...");
    setError(null);
    const res = await getSourceSummaryAction({ type: "LISTING", id: hit.id });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPickedListing(hit);
    setListingFacts(res.data.summary);
    if (!title.trim()) setTitle(res.data.title || hit.title);
    if (!topic.trim()) setTopic(res.data.summary.slice(0, 500));
  }

  /* ---------- Content Idea Template Helper ---------- */
  function useIdeaTemplate(idea: ContentIdea) {
    setTitle(idea.title);
    setCategory(idea.category as ContentCategory);
    setDesiredDuration(idea.targetDuration);
    setTopic(idea.description);
    setThumbnailPrompt(
      `Eye-catching YouTube cover for ${idea.title}, cinematic architectural luxury photography, 4k ultra-detailed`,
    );
    setScenes(
      idea.outline.map((line) => ({
        id: newTempId(),
        title: line,
        narration: "",
        imagePrompt: "",
        duration: Math.max(3, Math.round(idea.targetDuration / idea.outline.length)),
      })),
    );
    setSuccessNotice(`Loaded template: "${idea.title}".`);
  }

  /* ---------- Scene Operations in Preview ---------- */
  function addScene() {
    setScenes([
      ...scenes,
      {
        id: newTempId(),
        title: `Scene ${scenes.length + 1}`,
        narration: "",
        imagePrompt: "",
        duration: 6,
      },
    ]);
  }

  function removeScene(index: number) {
    if (scenes.length <= 1) {
      setError("A project must have at least one scene.");
      return;
    }
    setScenes(scenes.filter((_, i) => i !== index));
  }

  function duplicateScene(index: number) {
    const target = scenes[index];
    const copy = {
      ...target,
      id: newTempId(),
      title: `${target.title} (Copy)`,
    };
    const next = [...scenes];
    next.splice(index + 1, 0, copy);
    setScenes(next);
  }

  function moveScene(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= scenes.length) return;
    const next = [...scenes];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    setScenes(next);
  }

  /* ---------- Create Project as Draft ---------- */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Please provide a title for this video project.");
      return;
    }

    if (scenes.length === 0) {
      setError("Please add at least one scene before saving.");
      return;
    }

    const validatedScenes: EditorScene[] = scenes.map((s, idx) => ({
      id: s.id,
      order: idx + 1,
      title: s.title.trim() || `Scene ${idx + 1}`,
      narration: s.narration.trim(),
      imagePrompt: s.imagePrompt.trim(),
      imageUrl: null,
      duration: s.duration || 6,
      locked: false,
      cameraMotion: s.cameraMotion ?? defaultCameraMotion,
    }));

    setBusy("Saving project draft...");
    try {
      const res = await createProjectAction({
        title,
        topic: topic.trim() || (pickedListing ? listingFacts : ""),
        category,
        sourceType,
        sourceRefType: pickedListing ? "LISTING" : undefined,
        sourceRefId: pickedListing ? pickedListing.id : undefined,
        targetAudience,
        language,
        tone,
        duration: desiredDuration,
        aspectRatio,
        thumbnailPrompt: thumbnailPrompt.trim() || undefined,
        defaultCameraMotion,
        scenes: validatedScenes,
      });

      if (!res.ok) {
        setError(res.error);
        setBusy(null);
        return;
      }

      router.push(`/admin/dashboard/video-studio/${res.data.id}`);
    } catch {
      setError("Failed to create project draft. Please try again.");
      setBusy(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Top Breadcrumb & Header */}
      <div>
        <Link
          href="/admin/dashboard/video-studio"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to AI Video Studio
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">New Video Project</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Generate scenes with Google Gemini, import ready script JSON, or compose manually.
            </p>
          </div>
          {/* Gemini Status Chip */}
          {!loadingStatus && (
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  geminiStatus?.configured
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${geminiStatus?.configured ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                {geminiStatus?.configured ? `Gemini Ready (${geminiStatus.model})` : "Gemini Not Configured (Optional)"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-xs">
          {error}
        </div>
      )}

      {successNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 shadow-xs flex items-center justify-between">
          <span>{successNotice}</span>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="text-xs text-emerald-600 hover:text-emerald-900 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Grid: Left (Creation Methods & Scene Editor) + Right (Settings & Aspect Ratio) */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left Column */}
        <div className="space-y-6">
          {/* SCRIPT CREATION METHODS CARD */}
          <section className={card}>
            <div className="border-b border-neutral-200 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className={labelStyle}>Script Creation Method</span>
                  <p className="text-xs text-neutral-500">Choose how you want to build the scene script</p>
                </div>
              </div>

              {/* Segmented Method Tabs */}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setMethod("gemini")}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition ${
                    method === "gemini"
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-xs"
                      : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    <svg className="h-3.5 w-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                    Option A: Gemini AI
                  </div>
                  <span className={`mt-1 text-[11px] ${method === "gemini" ? "text-neutral-300" : "text-neutral-500"}`}>
                    Generate full script & visual prompts automatically
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethod("json")}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition ${
                    method === "json"
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-xs"
                      : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                    Option B: Import JSON
                  </div>
                  <span className={`mt-1 text-[11px] ${method === "json" ? "text-neutral-300" : "text-neutral-500"}`}>
                    Paste JSON from ChatGPT, Antigravity, or docs
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMethod("manual")}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition ${
                    method === "manual"
                      ? "border-neutral-900 bg-neutral-900 text-white shadow-xs"
                      : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    <svg className="h-3.5 w-3.5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Manual Card Editor
                  </div>
                  <span className={`mt-1 text-[11px] ${method === "manual" ? "text-neutral-300" : "text-neutral-500"}`}>
                    Compose scenes step-by-step from scratch
                  </span>
                </button>
              </div>
            </div>

            {/* METHOD CONTENT AREA */}
            <div className="mt-4">
              {/* OPTION A: GENERATE WITH GEMINI */}
              {method === "gemini" && (
                <div className="space-y-4">
                  {/* Status Banner when API key is missing */}
                  {geminiStatus && !geminiStatus.configured && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
                      <div className="font-semibold flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Google Gemini API key is not configured on this server
                      </div>
                      <p className="mt-1 text-amber-800">
                        To enable automated AI script generation, obtain a free API key from{" "}
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium underline hover:text-amber-950"
                        >
                          Google AI Studio
                        </a>{" "}
                        and add <code>GEMINI_API_KEY=&quot;your_key&quot;</code> to your server environment (.env).
                      </p>
                      <p className="mt-1 text-neutral-600">
                        In the meantime, you can use <strong>Option B: Import JSON</strong> or the <strong>Manual Card Editor</strong> without any API key.
                      </p>
                    </div>
                  )}

                  {/* Topic / Description Input */}
                  <div>
                    <label className={labelStyle}>
                      Video Topic or Core Points <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. Why Tellapur is Hyderabad's fastest-growing luxury corridor; 3 things buyers must check on RERA portal before paying token money; or 2,800 sq ft 3BHK tour..."
                      className={`${inputStyle} h-24`}
                    />
                  </div>

                  {/* Target Audience Quick Selector */}
                  <div>
                    <label className={labelStyle}>Target Audience</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {AUDIENCE_OPTIONS.map((aud) => (
                        <button
                          key={aud}
                          type="button"
                          onClick={() => setTargetAudience(aud)}
                          className={`rounded-md px-2.5 py-1 text-xs transition ${
                            targetAudience === aud
                              ? "bg-neutral-900 text-white font-medium"
                              : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                          }`}
                        >
                          {aud}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={targetAudience}
                      onChange={(e) => setTargetAudience(e.target.value)}
                      placeholder="Or enter custom target audience..."
                      className={inputStyle}
                    />
                  </div>

                  {/* Action Button */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleGenerateWithGemini}
                      disabled={!!busy}
                      className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-neutral-800 disabled:opacity-50 transition"
                    >
                      {busy === "Generating script with Gemini..." ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Generating REBX Script...
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                          </svg>
                          Generate Script with Gemini
                        </>
                      )}
                    </button>
                    <span className="text-xs text-neutral-500">
                      Generates scene titles, voiceover narration, and 4K photorealistic image prompts.
                    </span>
                  </div>
                </div>
              )}

              {/* OPTION B: IMPORT JSON */}
              {method === "json" && (
                <div className="space-y-4">
                  <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-xs text-neutral-600">
                    Paste script JSON generated in ChatGPT, Claude, Antigravity, or exported from REBX. Valid JSON will be parsed and loaded directly into the editable scene preview below.
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={labelStyle}>Script JSON Payload</label>
                      <button
                        type="button"
                        onClick={() => setPastedJson(EXAMPLE_JSON_PAYLOAD)}
                        className="text-xs text-neutral-600 hover:text-neutral-900 underline font-medium"
                      >
                        Load REBX Example JSON
                      </button>
                    </div>
                    <textarea
                      value={pastedJson}
                      onChange={(e) => {
                        setPastedJson(e.target.value);
                        setJsonError(null);
                      }}
                      placeholder='{"title": "My Video", "scenes": [{"title": "Hook", "narration": "...", "imagePrompt": "...", "duration": 5}]}'
                      className={`${inputStyle} h-48 font-mono text-xs`}
                    />
                    {jsonError && <p className="mt-1.5 text-xs text-red-600 font-medium">{jsonError}</p>}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleImportJson}
                      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 transition"
                    >
                      Validate & Load into Preview
                    </button>
                    <span className="text-xs text-neutral-500">
                      Does not require any Gemini API key.
                    </span>
                  </div>
                </div>
              )}

              {/* MANUAL CARD EDITOR */}
              {method === "manual" && (
                <div className="rounded-lg bg-neutral-50 border border-neutral-200 p-3 text-xs text-neutral-600">
                  Compose your video scenes directly using the Editable Scene Preview below. You can customize titles, spoken narration, visual prompts, and scene durations manually.
                </div>
              )}
            </div>
          </section>

          {/* HELPER SOURCES DRAWER: Listing Search & Prepared Ideas */}
          <section className={card}>
            <div className="border-b border-neutral-200 pb-3">
              <span className={labelStyle}>Prefill Helpers (Optional)</span>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSourceType("CUSTOM_SCRIPT")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    sourceType === "CUSTOM_SCRIPT" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  None (Custom)
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("EXISTING_CONTENT")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    sourceType === "EXISTING_CONTENT" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  From REBX Listing
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("CONTENT_IDEAS")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    sourceType === "CONTENT_IDEAS" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                  }`}
                >
                  REBX Content Ideas
                </button>
              </div>
            </div>

            {sourceType === "EXISTING_CONTENT" && (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-neutral-600">
                  Search live property listings to automatically extract verified pricing, BHK, carpet area, and location facts:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchListings())}
                    placeholder="Search by title, location (e.g. Tellapur, Kokapet)..."
                    className={inputStyle}
                  />
                  <button type="button" onClick={searchListings} disabled={!!busy} className={btnSecondary}>
                    Search
                  </button>
                </div>

                {sourceHits && sourceHits.length === 0 && (
                  <p className="text-xs text-neutral-500">No properties found.</p>
                )}

                {sourceHits && sourceHits.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-xs">
                    {sourceHits.map((hit) => (
                      <li key={hit.id}>
                        <button
                          type="button"
                          onClick={() => pickListing(hit)}
                          className={`w-full text-left p-2.5 hover:bg-neutral-50 flex flex-col transition ${
                            pickedListing?.id === hit.id ? "bg-neutral-100 font-semibold" : ""
                          }`}
                        >
                          <span className="text-neutral-900">{hit.title}</span>
                          {hit.subtitle && <span className="text-neutral-500 text-[11px]">{hit.subtitle}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {pickedListing && (
                  <div>
                    <label className={labelStyle}>Extracted Property Facts (Included in AI prompt)</label>
                    <textarea
                      value={listingFacts}
                      onChange={(e) => setListingFacts(e.target.value)}
                      className={`${inputStyle} h-28 font-mono text-xs`}
                    />
                  </div>
                )}
              </div>
            )}

            {sourceType === "CONTENT_IDEAS" && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {REBX_CONTENT_IDEAS.map((idea) => (
                  <div key={idea.id} className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between text-neutral-500">
                      <span className="font-semibold uppercase tracking-wider text-[10px]">
                        {CONTENT_CATEGORY_LABELS[idea.category as ContentCategory] ?? idea.category}
                      </span>
                      <span>~{idea.targetDuration}s</span>
                    </div>
                    <div className="font-semibold text-neutral-900">{idea.title}</div>
                    <p className="text-neutral-600 text-[11px] line-clamp-2">{idea.description}</p>
                    <button
                      type="button"
                      onClick={() => useIdeaTemplate(idea)}
                      className="rounded bg-neutral-900 px-2.5 py-1 text-white text-[11px] font-medium hover:bg-neutral-800 transition"
                    >
                      Use Template
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* THUMBNAIL (OPTIONAL) SECTION - Positioned directly above Editable Scene Preview */}
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between border-b border-neutral-200 pb-3 gap-2">
              <div>
                <h2 className="text-sm font-bold text-neutral-900 uppercase tracking-wider">
                  Thumbnail (Optional)
                </h2>
                <p className="text-xs text-neutral-500">
                  Overrides the auto-generated frame grab. Leave blank to let generation pick one automatically.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {thumbnailPromptCopied && (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    Copied to clipboard!
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleCopyThumbnailPrompt}
                  disabled={!thumbnailPrompt.trim()}
                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-40 transition flex items-center gap-1.5"
                >
                  <svg className="h-3.5 w-3.5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                    />
                  </svg>
                  <span>Copy Prompt</span>
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <label className={labelStyle}>
                AI Thumbnail Generation Prompt ({aspectRatio})
              </label>
              <textarea
                value={thumbnailPrompt}
                onChange={(e) => setThumbnailPrompt(e.target.value)}
                placeholder="Detailed visual description for an eye-catching YouTube / social media thumbnail cover image..."
                className={`${inputStyle} h-20 font-mono text-xs`}
              />
              <p className="text-[11px] text-neutral-400">
                Prefilled automatically from imported JSON or Gemini AI. You can also edit it here or upload a custom image file in the workspace.
              </p>
            </div>
          </section>

          {/* EDITABLE SCENE PREVIEW (Section 3 Requirement) */}
          <section className={card}>
            <div className="flex flex-wrap items-center justify-between border-b border-neutral-200 pb-3 gap-2">
              <div>
                <h2 className="text-sm font-bold text-neutral-900 uppercase tracking-wider">
                  Editable Scene Preview ({scenes.length} Scenes)
                </h2>
                <p className="text-xs text-neutral-500">
                  Review and customize scene narration and image prompts before creating the draft.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-mono font-medium text-neutral-700">
                  Total: {calculatedTotalSeconds}s (Target: {desiredDuration}s)
                </span>
                <button
                  type="button"
                  onClick={addScene}
                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition"
                >
                  + Add Scene
                </button>
              </div>
            </div>

            {/* Scenes List */}
            <div className="mt-4 space-y-4">
              {scenes.map((scene, idx) => {
                const words = countWords(scene.narration);
                const spokenEst = estimateDurationSec(scene.narration);
                const isFirst = idx === 0;
                const isLast = idx === scenes.length - 1;

                return (
                  <div
                    key={scene.id}
                    className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-4 space-y-3 transition hover:border-neutral-300"
                  >
                    {/* Scene Card Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200/80 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs font-bold text-white">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-neutral-800 uppercase tracking-wide">
                          {isFirst ? "Scene 1 (Hook)" : isLast ? `Scene ${idx + 1} (CTA)` : `Scene ${idx + 1}`}
                        </span>
                      </div>

                      {/* Scene Controls: Reorder, Duplicate, Delete */}
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveScene(idx, "up")}
                          disabled={isFirst}
                          title="Move Up"
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30 transition"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveScene(idx, "down")}
                          disabled={isLast}
                          title="Move Down"
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 disabled:opacity-30 transition"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateScene(idx)}
                          title="Duplicate Scene"
                          className="rounded p-1 text-neutral-500 hover:bg-neutral-200 transition"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                        {scenes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeScene(idx)}
                            title="Delete Scene"
                            className="rounded p-1 text-red-500 hover:bg-red-50 transition"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Scene Title & Duration Row */}
                    <div className="grid grid-cols-[1fr_120px] gap-3">
                      <div>
                        <label className={labelStyle}>Scene Title</label>
                        <input
                          type="text"
                          value={scene.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setScenes((cur) => cur.map((item, i) => (i === idx ? { ...item, title: val } : item)));
                          }}
                          placeholder="Scene title..."
                          className={inputStyle}
                        />
                      </div>
                      <div>
                        <label className={labelStyle}>Duration</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={2}
                            max={60}
                            value={scene.duration}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 6;
                              setScenes((cur) => cur.map((item, i) => (i === idx ? { ...item, duration: val } : item)));
                            }}
                            className={inputStyle}
                          />
                          <span className="text-xs text-neutral-500 font-mono">sec</span>
                        </div>
                      </div>
                    </div>

                    {/* Spoken Voiceover Narration */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className={labelStyle}>Voiceover Narration (Spoken Text)</label>
                        <span className="text-[11px] text-neutral-400 font-mono">
                          {words} words · ~{spokenEst}s spoken
                        </span>
                      </div>
                      <textarea
                        value={scene.narration}
                        onChange={(e) => {
                          const val = e.target.value;
                          setScenes((cur) => cur.map((item, i) => (i === idx ? { ...item, narration: val } : item)));
                        }}
                        placeholder="Narration script spoken during this scene..."
                        className={`${inputStyle} h-18 text-xs`}
                      />
                    </div>

                    {/* AI Image Generation Prompt */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className={labelStyle}>AI Image Generation Prompt ({aspectRatio})</label>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(scene.imagePrompt);
                          }}
                          className="text-[11px] text-neutral-400 hover:text-neutral-700"
                        >
                          Copy Prompt
                        </button>
                      </div>
                      <textarea
                        value={scene.imagePrompt}
                        onChange={(e) => {
                          const val = e.target.value;
                          setScenes((cur) => cur.map((item, i) => (i === idx ? { ...item, imagePrompt: val } : item)));
                        }}
                        placeholder="Detailed visual description for 4K photorealistic architectural photo..."
                        className={`${inputStyle} h-16 font-mono text-xs`}
                      />
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addScene}
                className="w-full rounded-xl border border-dashed border-neutral-300 p-3 text-xs font-semibold text-neutral-600 hover:border-neutral-900 hover:bg-neutral-50 transition"
              >
                + Add Another Scene
              </button>
            </div>
          </section>
        </div>

        {/* Right Column: Video Settings & Aspect Ratio Display */}
        <aside className="space-y-6">
          <section className={`${card} space-y-4`}>
            <h2 className="font-semibold text-neutral-900 text-sm border-b border-neutral-200 pb-2">
              Video Project Settings
            </h2>

            {/* Video Title */}
            <div>
              <label className={labelStyle}>
                Video Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Modern Tellapur Luxury 3BHK"
                className={inputStyle}
              />
            </div>

            {/* Content Category */}
            <div>
              <label className={labelStyle}>Content Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ContentCategory)}
                className={inputStyle}
              >
                {CONTENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {CONTENT_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </div>

            {/* Language & Tone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelStyle}>Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className={inputStyle}
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelStyle}>Tone</label>
                <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} className={inputStyle}>
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Desired Duration */}
            <div>
              <label className={labelStyle}>Desired Target Duration (seconds)</label>
              <input
                type="number"
                min={15}
                max={300}
                value={desiredDuration}
                onChange={(e) => setDesiredDuration(Number(e.target.value) || 60)}
                className={inputStyle}
              />
            </div>

            {/* Aspect Ratio with Dimensions Display */}
            <div>
              <label className={labelStyle}>Aspect Ratio & Output Format</label>
              <div className="space-y-2 mt-1">
                {ASPECT_RATIOS.map((ratio) => {
                  const cfg = ASPECT_RATIO_CONFIG[ratio];
                  const selected = aspectRatio === ratio;
                  return (
                    <div
                      key={ratio}
                      onClick={() => setAspectRatio(ratio)}
                      className={`cursor-pointer rounded-lg border p-3 transition ${
                        selected
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-xs"
                          : "border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{cfg.label}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-mono font-medium ${
                            selected ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-700"
                          }`}
                        >
                          {cfg.dimensions}
                        </span>
                      </div>
                      <p className={`mt-1 text-[11px] ${selected ? "text-neutral-300" : "text-neutral-500"}`}>
                        {cfg.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Dynamic Dimensions Banner */}
              <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-center">
                <span className="text-xs text-neutral-500">Target Output Resolution:</span>
                <span className="ml-1.5 font-mono text-xs font-bold text-neutral-900">
                  {currentRatioConfig.dimensions} ({currentRatioConfig.width} × {currentRatioConfig.height} px)
                </span>
              </div>
            </div>

            {/* Save as Draft Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={!!busy}
                className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-semibold text-white shadow-sm hover:bg-neutral-800 transition disabled:opacity-50"
              >
                {busy ?? "Save Project as Draft & Open Studio"}
              </button>
              <p className="mt-2 text-center text-[11px] text-neutral-400">
                Saves project draft in database and opens full scene workspace.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
}
