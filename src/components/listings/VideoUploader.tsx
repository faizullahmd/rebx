"use client";

import { useRef, useState } from "react";

export type VideoItem = {
  id: string;
  url: string;
  title?: string;
  isUploading?: boolean;
  progress?: number;
  error?: string;
};

interface VideoUploaderProps {
  name?: string;
  initialVideos?: { id?: number | string; url: string; title?: string | null }[];
  maxVideos?: number;
  onChange?: (videos: { url: string; title?: string }[]) => void;
}

function isYoutubeUrl(url: string) {
  return url.includes("youtube.com") || url.includes("youtu.be");
}

function getYoutubeEmbed(url: string) {
  try {
    if (url.includes("youtu.be/")) {
      const id = url.split("youtu.be/")[1]?.split("?")[0];
      return `https://www.youtube.com/embed/${id}`;
    }
    const urlObj = new URL(url);
    const id = urlObj.searchParams.get("v");
    if (id) return `https://www.youtube.com/embed/${id}`;
  } catch {
    // Fallback
  }
  return url;
}

export function VideoUploader({
  name = "videoData",
  initialVideos = [],
  maxVideos,
  onChange,
}: VideoUploaderProps) {
  const [items, setItems] = useState<VideoItem[]>(
    initialVideos.map((v, i) => ({
      id: String(v.id || `init-${i}`),
      url: v.url,
      title: v.title || "",
      isUploading: false,
    }))
  );

  const [urlInput, setUrlInput] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function syncChanges(updated: VideoItem[]) {
    setItems(updated);
    if (onChange) {
      onChange(
        updated
          .filter((item) => item.url && !item.isUploading)
          .map((item) => ({ url: item.url, title: item.title }))
      );
    }
  }

  async function handleFileUpload(files: FileList | null) {
    if (!files || files.length === 0) return;

    if (maxVideos && items.length >= maxVideos) {
      alert(`You can only upload a maximum of ${maxVideos} videos for one project.`);
      return;
    }

    const availableSlots = maxVideos ? maxVideos - items.length : files.length;
    const filesToUpload = Array.from(files).slice(0, availableSlots);

    for (const file of filesToUpload) {
      if (!file.type.startsWith("video/")) {
        alert(`${file.name} is not a valid video file.`);
        continue;
      }

      if (file.size > 100 * 1024 * 1024) {
        alert(`${file.name} exceeds the 100MB size limit.`);
        continue;
      }

      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const defaultTitle = file.name.replace(/\.[^/.]+$/, "");

      const newItem: VideoItem = {
        id: tempId,
        url: "",
        title: defaultTitle,
        isUploading: true,
        progress: 10,
      };

      setItems((prev) => [...prev, newItem]);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/upload/video");

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setItems((prev) =>
              prev.map((item) => (item.id === tempId ? { ...item, progress: pct } : item))
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const res = JSON.parse(xhr.responseText);
            setItems((prev) => {
              const next = prev.map((item) =>
                item.id === tempId
                  ? { ...item, url: res.url, isUploading: false, progress: 100 }
                  : item
              );
              syncChanges(next);
              return next;
            });
          } else {
            let errMsg = "Upload failed";
            try {
              errMsg = JSON.parse(xhr.responseText).error || errMsg;
            } catch {
              // Ignore
            }
            setItems((prev) =>
              prev.map((item) =>
                item.id === tempId ? { ...item, isUploading: false, error: errMsg } : item
              )
            );
          }
        };

        xhr.onerror = () => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === tempId ? { ...item, isUploading: false, error: "Network error" } : item
            )
          );
        };

        xhr.send(formData);
      } catch (err: unknown) {
        setItems((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? { ...item, isUploading: false, error: (err as Error)?.message || "Upload failed" }
              : item
          )
        );
      }
    }
  }

  function handleAddUrl() {
    const trimmed = urlInput.trim();
    if (!trimmed) return;

    if (maxVideos && items.length >= maxVideos) {
      alert(`You can only have up to ${maxVideos} videos for one project.`);
      return;
    }

    const newItem: VideoItem = {
      id: `url-${Date.now()}`,
      url: trimmed,
      title: titleInput.trim() || "Project Video",
      isUploading: false,
    };

    const next = [...items, newItem];
    syncChanges(next);
    setUrlInput("");
    setTitleInput("");
    setShowUrlInput(false);
  }

  function handleRemove(id: string) {
    const next = items.filter((item) => item.id !== id);
    syncChanges(next);
  }

  function handleTitleChange(id: string, newTitle: string) {
    const next = items.map((item) => (item.id === id ? { ...item, title: newTitle } : item));
    syncChanges(next);
  }

  const validItems = items.filter((item) => item.url && !item.isUploading);

  return (
    <div className="flex flex-col gap-4">
      {/* Hidden serialization for form submit */}
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(validItems.map((v) => ({ url: v.url, title: v.title })))}
      />

      {/* Header & Counter */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-semibold text-neutral-900">
            Project Videos (Walkthrough / Drone / Virtual Tour)
          </label>
          <p className="text-xs text-neutral-500">
            {maxVideos
              ? `Developers can upload up to ${maxVideos} high-resolution video tours or walkthroughs.`
              : "Developers can upload high-resolution video tours or walkthroughs."}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            maxVideos && items.length >= maxVideos
              ? "bg-amber-100 text-amber-800"
              : "bg-neutral-100 text-neutral-700"
          }`}
        >
          {maxVideos ? `${items.length} / ${maxVideos} uploaded` : `${items.length} uploaded`}
        </span>
      </div>

      {/* Upload & Add controls (if not full) */}
      {(!maxVideos || items.length < maxVideos) && (
        <div className="space-y-3">
          {/* Drag & Drop Upload Area */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFileUpload(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragOver
                ? "border-neutral-900 bg-neutral-50"
                : "border-neutral-300 hover:border-neutral-400 bg-neutral-50/50"
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-2xs border border-neutral-200 text-neutral-700">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-neutral-900">
              Click to upload video or drag and drop
            </p>
            <p className="text-xs text-neutral-500">
              MP4, WebM, MOV up to 100MB{maxVideos ? ` (${maxVideos - items.length} slots remaining)` : ""}
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                handleFileUpload(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Alternative: Add Video Link Button / Form */}
          {!showUrlInput ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowUrlInput(true)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                + Or add via YouTube / Vimeo / Video link
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-800">Add Video by URL</span>
                <button
                  type="button"
                  onClick={() => setShowUrlInput(false)}
                  className="text-xs text-neutral-400 hover:text-neutral-600"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="url"
                  placeholder="https://youtube.com/watch?v=... or .mp4 link"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Video title (e.g. Aerial View)"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-900 outline-none focus:border-neutral-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddUrl}
                    disabled={!urlInput.trim()}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Uploaded Video Cards */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xs"
            >
              {/* Media Preview Container */}
              <div className="relative aspect-video w-full bg-neutral-950 flex items-center justify-center overflow-hidden">
                {item.isUploading ? (
                  <div className="flex flex-col items-center gap-2 p-4 text-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    <p className="text-xs font-medium text-white">Uploading {item.progress}%</p>
                    <div className="w-24 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-200"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                ) : item.error ? (
                  <div className="p-3 text-center">
                    <p className="text-xs text-red-400 font-medium">{item.error}</p>
                  </div>
                ) : isYoutubeUrl(item.url) ? (
                  <iframe
                    src={getYoutubeEmbed(item.url)}
                    className="h-full w-full pointer-events-none"
                    title={item.title || "Video"}
                  />
                ) : (
                  <video
                    src={item.url}
                    controls
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                )}

                {/* Badge Number */}
                <div className="absolute top-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                  Video {index + 1}
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => handleRemove(item.id)}
                  aria-label="Remove video"
                  className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 transition"
                >
                  ✕
                </button>
              </div>

              {/* Title input */}
              <div className="p-2.5">
                <input
                  type="text"
                  placeholder="Video caption (e.g. Walkthrough Tour)"
                  value={item.title || ""}
                  onChange={(e) => handleTitleChange(item.id, e.target.value)}
                  className="w-full rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-800 placeholder-neutral-400 outline-none focus:border-neutral-900 focus:bg-white"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
