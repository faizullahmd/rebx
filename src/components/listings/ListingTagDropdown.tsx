"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  TAG_COLOR_KEYS,
  TAG_COLORS,
  getTagColorMeta,
  getTagBadgeClass,
  type TagItem,
  type TagColorKey,
} from "@/lib/tags";
import {
  getTagsAction,
  createTagAction,
  getTagUsageCountAction,
  deleteTagAction,
} from "@/lib/actions/tags";
import { updateListingTagAction } from "@/lib/actions/listings";

interface ListingTagDropdownProps {
  listingId: number;
  initialTag?: TagItem | string | null;
  initialTagId?: number | null;
  onTagChange?: (newTag: TagItem | string | null) => void;
  compact?: boolean;
}

export function ListingTagDropdown({
  listingId,
  initialTag,
  initialTagId,
  onTagChange,
  compact = false,
}: ListingTagDropdownProps) {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [selectedTag, setSelectedTag] = useState<TagItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Create Tag Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<TagColorKey>("purple");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Delete Tag Modal State
  const [deleteTarget, setDeleteTarget] = useState<TagItem | null>(null);
  const [deleteCount, setDeleteCount] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{
    top: number;
    left: number;
    placement: "top" | "bottom";
  } | null>(null);

  const updatePosition = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const estimatedHeight = 310;
    const placement: "top" | "bottom" =
      spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? "top" : "bottom";

    setPopoverPos({
      top: placement === "bottom" ? rect.bottom + 4 : rect.top - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 230)),
      placement,
    });
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen]);

  // Fetch tags on mount
  useEffect(() => {
    let active = true;
    getTagsAction().then((res) => {
      if (active && res.success) {
        setTags(res.tags);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Synchronize initialTag / initialTagId with loaded tags
  useEffect(() => {
    if (tags.length === 0) return;

    if (initialTagId != null) {
      const found = tags.find((t) => t.id === initialTagId);
      if (found) {
        setSelectedTag(found);
        return;
      }
    }

    if (initialTag) {
      if (typeof initialTag === "object" && "id" in initialTag) {
        setSelectedTag(initialTag);
      } else if (typeof initialTag === "string") {
        const found = tags.find(
          (t) => t.name.toLowerCase() === initialTag.toLowerCase().replace(/_/g, " ")
        );
        if (found) {
          setSelectedTag(found);
        }
      }
    } else {
      setSelectedTag(null);
    }
  }, [initialTag, initialTagId, tags]);

  // Global event listeners to sync created/deleted tags across all rows
  useEffect(() => {
    const handleTagCreated = (e: Event) => {
      const customEvent = e as CustomEvent<TagItem>;
      if (customEvent.detail) {
        setTags((prev) => {
          if (prev.some((t) => t.id === customEvent.detail.id)) return prev;
          return [...prev, customEvent.detail];
        });
      }
    };

    const handleTagDeleted = (e: Event) => {
      const customEvent = e as CustomEvent<number>;
      if (customEvent.detail != null) {
        const deletedId = customEvent.detail;
        setTags((prev) => prev.filter((t) => t.id !== deletedId));
        setSelectedTag((curr) => (curr?.id === deletedId ? null : curr));
      }
    };

    window.addEventListener("rebx:tag-created", handleTagCreated);
    window.addEventListener("rebx:tag-deleted", handleTagDeleted);

    return () => {
      window.removeEventListener("rebx:tag-created", handleTagCreated);
      window.removeEventListener("rebx:tag-deleted", handleTagDeleted);
    };
  }, []);

  // Outside click & ESC listener to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        buttonRef.current &&
        !buttonRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Apply a tag selection
  const handleSelectTag = (tag: TagItem | null) => {
    const previous = selectedTag;
    setSelectedTag(tag);
    setIsOpen(false);
    setError(null);
    onTagChange?.(tag);

    startTransition(async () => {
      try {
        const res = await updateListingTagAction(listingId, tag ? tag.id : null);
        if (!res.success) {
          setError(res.error || "Failed to update tag");
          setSelectedTag(previous);
          onTagChange?.(previous);
        }
      } catch (err: any) {
        setError(err?.message || "An unexpected error occurred");
        setSelectedTag(previous);
        onTagChange?.(previous);
      }
    });
  };

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setIsOpen(false);
    setNewTagName("");
    setNewTagColor("purple");
    setCreateError(null);
    setIsCreateOpen(true);
  };

  // Submit Create Tag
  const handleSaveNewTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setCreateError("Tag name is required.");
      return;
    }
    if (trimmed.length > 20) {
      setCreateError("Tag name must be 20 characters or fewer.");
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await createTagAction({ name: trimmed, color: newTagColor });
      if (!res.success || !res.tag) {
        setCreateError(res.error || "Failed to create tag.");
        setIsCreating(false);
        return;
      }

      const created = res.tag;
      // Broadcast to all other dropdowns
      window.dispatchEvent(new CustomEvent("rebx:tag-created", { detail: created }));

      // Add to local state & select it immediately for this listing
      setTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      setIsCreateOpen(false);
      setIsCreating(false);

      handleSelectTag(created);
    } catch (err: any) {
      setCreateError(err?.message || "An unexpected error occurred.");
      setIsCreating(false);
    }
  };

  // Open Delete Confirmation Modal
  const handleOpenDeleteModal = async (e: React.MouseEvent, tag: TagItem) => {
    e.stopPropagation();
    setIsOpen(false);
    setDeleteTarget(tag);
    setDeleteError(null);
    setDeleteCount(null);

    // Fetch affected listings count
    const res = await getTagUsageCountAction(tag.id);
    if (res.success) {
      setDeleteCount(res.count);
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await deleteTagAction(deleteTarget.id);
      if (!res.success) {
        setDeleteError(res.error || "Failed to delete tag.");
        setIsDeleting(false);
        return;
      }

      const targetId = deleteTarget.id;
      // Broadcast to all other dropdowns
      window.dispatchEvent(new CustomEvent("rebx:tag-deleted", { detail: targetId }));

      setTags((prev) => prev.filter((t) => t.id !== targetId));
      if (selectedTag?.id === targetId) {
        setSelectedTag(null);
        onTagChange?.(null);
      }

      setDeleteTarget(null);
      setIsDeleting(false);
    } catch (err: any) {
      setDeleteError(err?.message || "An unexpected error occurred.");
      setIsDeleting(false);
    }
  };

  // Group default and custom tags
  const defaultTags = tags.filter((t) => t.isDefault);
  const customTags = tags.filter((t) => !t.isDefault);

  const buttonStyleClass = selectedTag
    ? getTagBadgeClass(selectedTag.color, "soft")
    : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100";

  return (
    <div
      ref={dropdownRef}
      className={`relative inline-block text-left ${compact ? "w-full max-w-[125px]" : ""}`}
    >
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (next) updatePosition();
            return next;
          });
        }}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select listing tag"
        className={`inline-flex items-center justify-between rounded-md border font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-gray-900 ${
          compact
            ? "h-9 px-2 py-1 text-xs max-w-[125px] w-full"
            : "px-2.5 py-1 text-xs min-w-[110px]"
        } ${buttonStyleClass} ${isPending ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span className="truncate">{selectedTag ? selectedTag.name : "No tag"}</span>
        <svg
          className={`ml-1 h-3 w-3 shrink-0 text-current transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu Popover (rendered in Portal to avoid table container overflow clipping) */}
      {mounted &&
        isOpen &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            style={{
              position: "fixed",
              top: popoverPos.placement === "bottom" ? `${popoverPos.top}px` : undefined,
              bottom:
                popoverPos.placement === "top"
                  ? `${window.innerHeight - popoverPos.top}px`
                  : undefined,
              left: `${popoverPos.left}px`,
              zIndex: 9999,
            }}
            className="min-w-[195px] w-auto max-w-[250px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl transition focus:outline-none"
          >
          {/* Option: No tag */}
          <button
            type="button"
            role="option"
            aria-selected={selectedTag === null}
            onClick={() => handleSelectTag(null)}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left font-medium transition-colors ${
              selectedTag === null
                ? "bg-gray-100 text-gray-900 font-semibold"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <span>No tag</span>
            {selectedTag === null && <span className="text-gray-900 font-bold">✓</span>}
          </button>

          {/* Default Tags */}
          <div className="my-1 border-t border-gray-100 pt-1">
            <p className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Default Tags
            </p>
            {defaultTags.map((tag) => {
              const isSelected = selectedTag?.id === tag.id;
              const badgeStyle = getTagBadgeClass(tag.color, "soft");
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectTag(tag)}
                  className={`mt-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors ${
                    isSelected ? "bg-gray-50 font-semibold" : "hover:bg-gray-50/80"
                  }`}
                >
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border ${badgeStyle}`}
                  >
                    {tag.name}
                  </span>
                  {isSelected && <span className="text-gray-900 font-bold">✓</span>}
                </button>
              );
            })}
          </div>

          {/* Custom Tags Section */}
          {customTags.length > 0 && (
            <div className="my-1 border-t border-gray-100 pt-1">
              <p className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Custom Tags ({customTags.length}/10)
              </p>
              {customTags.map((tag) => {
                const isSelected = selectedTag?.id === tag.id;
                const badgeStyle = getTagBadgeClass(tag.color, "soft");
                return (
                  <div
                    key={tag.id}
                    className={`group mt-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      isSelected ? "bg-gray-50 font-semibold" : "hover:bg-gray-50/80"
                    }`}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectTag(tag)}
                      className="flex flex-1 items-center justify-between pr-2 text-left"
                    >
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium border ${badgeStyle}`}
                      >
                        {tag.name}
                      </span>
                      {isSelected && <span className="text-gray-900 font-bold ml-1">✓</span>}
                    </button>

                    {/* Delete Icon */}
                    <button
                      type="button"
                      title={`Delete "${tag.name}"`}
                      onClick={(e) => handleOpenDeleteModal(e, tag)}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* "+ Create new tag" button */}
          <div className="mt-1 border-t border-gray-100 pt-1">
            <button
              type="button"
              onClick={handleOpenCreateModal}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 transition-colors"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-[10px] text-white">
                +
              </span>
              <span>Create new tag</span>
            </button>
          </div>
        </div>,
        document.body
      )}

      {error && <span className="block mt-1 text-[11px] text-red-600">{error}</span>}

      {/* CREATE TAG MODAL (Rendered via Portal) */}
      {mounted &&
        isCreateOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsCreateOpen(false);
            }}
          >
            <div
              className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl transition"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-base font-semibold text-gray-900">Create New Tag</h3>
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveNewTag} className="mt-4 flex flex-col gap-4">
                {/* Tag Name Input */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="new-tag-name" className="text-xs font-medium text-gray-700">
                      Tag Name
                    </label>
                    <span
                      className={`text-[11px] ${
                        newTagName.length >= 20 ? "text-amber-600 font-semibold" : "text-gray-400"
                      }`}
                    >
                      {newTagName.length}/20
                    </span>
                  </div>
                  <input
                    id="new-tag-name"
                    type="text"
                    value={newTagName}
                    maxLength={20}
                    placeholder="e.g. Hot Deal, Sea View"
                    onChange={(e) => {
                      setNewTagName(e.target.value);
                      if (createError) setCreateError(null);
                    }}
                    autoFocus
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>

                {/* Color Swatch Picker */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-700">Choose Badge Color</label>
                  <div className="grid grid-cols-5 gap-2">
                    {TAG_COLOR_KEYS.map((key) => {
                      const meta = TAG_COLORS[key];
                      const isSelected = newTagColor === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          title={meta.label}
                          onClick={() => setNewTagColor(key)}
                          className={`relative flex h-8 items-center justify-center rounded-lg transition-transform ${
                            meta.swatchClass
                          } ${isSelected ? "ring-2 ring-gray-900 ring-offset-2 scale-105" : "hover:opacity-90"}`}
                        >
                          {isSelected && <span className="text-xs font-bold text-white">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Live Preview */}
                <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <p className="text-[11px] font-medium text-gray-500 mb-1.5">Live Badge Preview</p>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold shadow-2xs border ${getTagBadgeClass(
                        newTagColor,
                        "soft"
                      )}`}
                    >
                      {newTagName.trim() || "Preview Tag"}
                    </span>
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold text-white ${getTagColorMeta(
                        newTagColor
                      ).solidBadgeClass}`}
                    >
                      {newTagName.trim() || "Preview Tag"}
                    </span>
                  </div>
                </div>

                {createError && (
                  <p className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-700 border border-red-200">
                    {createError}
                  </p>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                    disabled={isCreating}
                    className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {isCreating ? "Creating..." : "Save & Apply"}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* DELETE CONFIRMATION MODAL (Rendered via Portal) */}
      {mounted &&
        deleteTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !isDeleting) setDeleteTarget(null);
            }}
          >
            <div
              className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl transition"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-base font-semibold text-gray-900">Delete Tag</h3>
                <button
                  type="button"
                  onClick={() => !isDeleting && setDeleteTarget(null)}
                  className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <p className="text-sm text-gray-700">
                  Are you sure you want to delete the tag{" "}
                  <span className="font-semibold text-gray-900">&quot;{deleteTarget.name}&quot;</span>?
                </p>

                {deleteCount != null && deleteCount > 0 ? (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200">
                    ⚠️ This tag is currently assigned to{" "}
                    <strong>
                      {deleteCount} listing{deleteCount === 1 ? "" : "s"}
                    </strong>
                    . Deleting it will unassign the tag and set those listings to &quot;No tag&quot;.
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">
                    This tag is not currently used by any listings.
                  </p>
                )}

                {deleteError && (
                  <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 border border-red-200">
                    {deleteError}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    disabled={isDeleting}
                    className="rounded-lg border border-gray-300 px-3.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={isDeleting}
                    className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? "Deleting..." : "Delete Tag"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
