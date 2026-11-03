"use client";

import React from "react";
import { ToastProvider } from "@/context/ToastContext";
import { ShortlistProvider } from "@/context/ShortlistContext";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShortlistProvider>{children}</ShortlistProvider>
    </ToastProvider>
  );
}

