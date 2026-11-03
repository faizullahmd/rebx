"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import Link from "next/link";

export interface ToastAction {
  label: string;
  onClick?: () => void;
  href?: string;
}

export interface ToastOptions {
  id?: string;
  message: string;
  type?: "success" | "error" | "info";
  action?: ToastAction;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timeout = timeoutsRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    ({ message, type = "success", action, duration = 4500 }: ToastOptions) => {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      setToasts((prev) => [...prev, { id, message, type, action, duration }]);

      if (duration > 0) {
        const timeout = setTimeout(() => {
          dismissToast(id);
        }, duration);
        timeoutsRef.current.set(id, timeout);
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t));
      timeoutsRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {/* Toast container */}
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-2 sm:px-0"
        aria-live="polite"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/95 px-4 py-3 text-xs sm:text-sm font-medium text-white shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-3 duration-200"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.type === "success" && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
                  ✓
                </span>
              )}
              {toast.type === "error" && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold">
                  !
                </span>
              )}
              {toast.type === "info" && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-xs">
                  ℹ
                </span>
              )}
              <span className="truncate leading-snug">{toast.message}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {toast.action && (
                <>
                  {toast.action.href ? (
                    <Link
                      href={toast.action.href}
                      onClick={() => dismissToast(toast.id)}
                      className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
                    >
                      {toast.action.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        toast.action?.onClick?.();
                        dismissToast(toast.id);
                      }}
                      className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      {toast.action.label}
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-neutral-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

