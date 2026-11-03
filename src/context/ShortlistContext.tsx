"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useToast } from "./ToastContext";

interface ShortlistContextValue {
  shortlistIds: Set<number>;
  count: number;
  isShortlisted: (listingId: number) => boolean;
  toggleShortlist: (listingId: number, forceAction?: "add" | "remove") => Promise<void>;
  canShortlist: boolean;
  userRole: string | null;
  isLoading: boolean;
  refreshShortlist: () => Promise<void>;
}

const ShortlistContext = createContext<ShortlistContextValue | null>(null);

const STORAGE_KEY = "rebx_shortlist_guest";

function getGuestShortlist(): number[] {
  try {
    if (typeof window === "undefined") return [];
    const item = localStorage.getItem(STORAGE_KEY);
    if (!item) return [];
    const parsed = JSON.parse(item);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (id) => typeof id === "number" && !Number.isNaN(id) && id > 0
      );
    }
  } catch (err) {
    console.warn("Could not read guest shortlist from localStorage:", err);
  }
  return [];
}

function setGuestShortlist(ids: number[]) {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch (err) {
    console.warn("Could not write guest shortlist to localStorage:", err);
  }
}

function clearGuestShortlist() {
  try {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear guest shortlist from localStorage:", err);
  }
}

export function ShortlistProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { showToast } = useToast();
  const [shortlistIds, setShortlistIds] = useState<Set<number>>(new Set());
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const inFlightRef = useRef<Set<number>>(new Set());
  const hasMergedRef = useRef(false);

  // Initialize and load IDs (plus merge guest IDs if authenticated)
  const initializeShortlist = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/shortlist/ids", {
        headers: { "Cache-Control": "no-cache" },
      });

      if (res.status === 200) {
        // Authenticated user
        setUserRole("AUTHENTICATED");
        const data = await res.json();
        let currentIds: number[] = Array.isArray(data.ids) ? data.ids : [];

        // Check for guest shortlist to merge
        const guestIds = getGuestShortlist();
        if (guestIds.length > 0 && !hasMergedRef.current) {
          hasMergedRef.current = true;
          try {
            const mergeRes = await fetch("/api/shortlist/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ listingIds: guestIds }),
            });

            if (mergeRes.ok) {
              const mergeData = await mergeRes.json();
              clearGuestShortlist();
              if (Array.isArray(mergeData.ids)) {
                currentIds = mergeData.ids;
              }
              const count = mergeData.addedCount || 0;
              if (count > 0) {
                showToast({
                  message: `${count} ${
                    count === 1 ? "property" : "properties"
                  } added to your Shortlist.`,
                  type: "success",
                  action: {
                    label: "View",
                    href: "/dashboard/shortlist",
                  },
                });
              }
            }
          } catch (mergeErr) {
            console.error("Failed to merge guest shortlist:", mergeErr);
          }
        }

        const nextSet = new Set(currentIds);
        setShortlistIds(nextSet);
        shortlistIdsRef.current = nextSet;
      } else {
        // Guest user (unauthenticated / 401)
        setUserRole(null);
        const guestIds = getGuestShortlist();
        const nextSet = new Set(guestIds);
        setShortlistIds(nextSet);
        shortlistIdsRef.current = nextSet;
      }
    } catch {
      // Offline / fallback to localStorage
      const guestIds = getGuestShortlist();
      const nextSet = new Set(guestIds);
      setShortlistIds(nextSet);
      shortlistIdsRef.current = nextSet;
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    initializeShortlist();
  }, [initializeShortlist]);

  // Wishlist / heart icons are visible and interactive for all users
  const canShortlist = true;

  const isShortlisted = useCallback(
    (listingId: number) => {
      return shortlistIds.has(listingId);
    },
    [shortlistIds]
  );

  const shortlistIdsRef = useRef<Set<number>>(shortlistIds);
  useEffect(() => {
    shortlistIdsRef.current = shortlistIds;
  }, [shortlistIds]);

  const toggleShortlist = useCallback(
    async (listingId: number, forceAction?: "add" | "remove") => {
      if (!canShortlist) return;

      // Prevent concurrent requests on the same listing ID
      if (inFlightRef.current.has(listingId)) return;
      inFlightRef.current.add(listingId);

      const isAuthenticated = userRole !== null;
      const isCurrentlyShortlisted = shortlistIdsRef.current.has(listingId);
      const shouldAdd =
        forceAction === "add"
          ? true
          : forceAction === "remove"
            ? false
            : !isCurrentlyShortlisted;

      // 1. Guest flow (localStorage only)
      if (!isAuthenticated) {
        try {
          const guestIds = getGuestShortlist();
          let nextIds: number[];

          if (!shouldAdd) {
            nextIds = guestIds.filter((id) => id !== listingId);
            setGuestShortlist(nextIds);
            const nextSet = new Set(nextIds);
            setShortlistIds(nextSet);
            shortlistIdsRef.current = nextSet;
            showToast({
              message: "Removed from Shortlist",
              type: "info",
              action: {
                label: "Undo",
                onClick: () => toggleShortlist(listingId, "add"),
              },
            });
          } else {
            nextIds = Array.from(new Set([...guestIds, listingId]));
            setGuestShortlist(nextIds);
            const nextSet = new Set(nextIds);
            setShortlistIds(nextSet);
            shortlistIdsRef.current = nextSet;
            showToast({
              message: "Added on this device. Log in to access your Shortlist anywhere.",
              type: "success",
              action: {
                label: "Log in",
                href: "/login?callbackUrl=/dashboard/shortlist",
              },
            });
          }
        } finally {
          inFlightRef.current.delete(listingId);
        }
        return;
      }

      // 2. Customer flow (Optimistic UI + API background sync)
      const previousSet = new Set(shortlistIdsRef.current);
      const nextSet = new Set(shortlistIdsRef.current);

      if (!shouldAdd) {
        nextSet.delete(listingId);
      } else {
        nextSet.add(listingId);
      }
      setShortlistIds(nextSet);
      shortlistIdsRef.current = nextSet;

      try {
        if (!shouldAdd) {
          // Remove from shortlist
          const res = await fetch(`/api/shortlist/${listingId}`, {
            method: "DELETE",
          });

          if (!res.ok) {
            throw new Error("Failed to remove from shortlist");
          }

          showToast({
            message: "Removed from Shortlist",
            type: "info",
            action: {
              label: "Undo",
              onClick: () => toggleShortlist(listingId, "add"),
            },
          });
        } else {
          // Add to shortlist
          const res = await fetch("/api/shortlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listingId }),
          });

          if (!res.ok) {
            throw new Error("Failed to add to shortlist");
          }

          showToast({
            message: "Added to your Shortlist",
            type: "success",
            action: {
              label: "View",
              href: "/dashboard/shortlist",
            },
          });
        }
      } catch (err) {
        console.error("Shortlist API error, rolling back:", err);
        // Rollback optimistic state
        setShortlistIds(previousSet);
        shortlistIdsRef.current = previousSet;
        showToast({
          message: "Couldn't update your Shortlist. Try again.",
          type: "error",
        });
      } finally {
        inFlightRef.current.delete(listingId);
      }
    },
    [canShortlist, userRole, showToast]
  );

  const count = shortlistIds.size;

  const value = useMemo(
    () => ({
      shortlistIds,
      count,
      isShortlisted,
      toggleShortlist,
      canShortlist,
      userRole,
      isLoading,
      refreshShortlist: initializeShortlist,
    }),
    [
      shortlistIds,
      count,
      isShortlisted,
      toggleShortlist,
      canShortlist,
      userRole,
      isLoading,
      initializeShortlist,
    ]
  );

  return (
    <ShortlistContext.Provider value={value}>
      {children}
    </ShortlistContext.Provider>
  );
}

export function useShortlist() {
  const context = useContext(ShortlistContext);
  if (!context) {
    throw new Error("useShortlist must be used within a ShortlistProvider");
  }
  return context;
}

