"use client";

import { useRef, useState } from "react";
import { createUploadUrl } from "@/lib/actions/uploads";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

type UploadItem = {
  id: string;
  url?: string;
  progress: number;
  error?: string;
  previewUrl: string;
};

function uploadFile(file: File, uploadUrl: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

export function ImageUploader({
  name,
  initialImages = [],
}: {
  name: string;
  initialImages?: string[];
}) {
  const [items, setItems] = useState<UploadItem[]>(
    initialImages.map((url) => ({ id: url, url, progress: 100, previewUrl: url }))
  );
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const orderedUrls = items.filter((item) => item.url).map((item) => item.url as string);

  function addFiles(files: FileList | null) {
    if (!files) return;

    for (const file of Array.from(files)) {
      const id = `${file.name}-${Date.now()}-${Math.random()}`;
      const previewUrl = URL.createObjectURL(file);

      if (!file.type.startsWith("image/")) {
        setItems((prev) => [...prev, { id, progress: 0, previewUrl, error: "Not an image file" }]);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setItems((prev) => [...prev, { id, progress: 0, previewUrl, error: "File is larger than 8MB" }]);
        continue;
      }

      setItems((prev) => [...prev, { id, progress: 0, previewUrl }]);

      createUploadUrl(file.name, file.type)
        .then(({ uploadUrl, publicUrl }) =>
          uploadFile(file, uploadUrl, (pct) =>
            setItems((prev) => prev.map((item) => (item.id === id ? { ...item, progress: pct } : item)))
          ).then(() => publicUrl)
        )
        .then((publicUrl) => {
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, url: publicUrl, progress: 100 } : item))
          );
        })
        .catch((error: unknown) => {
          setItems((prev) =>
            prev.map((item) =>
              item.id === id
                ? { ...item, error: error instanceof Error ? error.message : "Upload failed" }
                : item
            )
          );
        });
    }
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function moveItem(id: string, direction: -1 | 1) {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      const swapWith = index + direction;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={orderedUrls.join("\n")} />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 text-center text-sm ${
          dragOver ? "border-gray-900 bg-gray-50" : "border-gray-300 text-gray-500"
        }`}
      >
        <p className="font-medium text-gray-700">Drag photos here or click to browse</p>
        <p className="text-xs text-gray-400">JPG or PNG, up to 8MB each</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map((item, index) => (
            <div key={item.id} className="relative overflow-hidden rounded-md border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="" className="aspect-[4/3] w-full object-cover" />

              {item.error ? (
                <div className="absolute inset-0 flex items-center justify-center bg-red-50/95 p-2 text-center text-xs text-red-700">
                  {item.error}
                </div>
              ) : item.progress < 100 ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white">
                  {item.progress}%
                </div>
              ) : null}

              <button
                type="button"
                aria-label="Remove image"
                onClick={() => removeItem(item.id)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow hover:bg-white"
              >
                ×
              </button>

              <div className="absolute bottom-1 left-1 flex gap-1">
                <button
                  type="button"
                  aria-label="Move earlier"
                  disabled={index === 0}
                  onClick={() => moveItem(item.id, -1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow hover:bg-white disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Move later"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(item.id, 1)}
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow hover:bg-white disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
