"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

export function AuthInitializer() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    // Initialize silently - don't throw errors on init
    // This prevents immediate logout if verify endpoint is temporarily unavailable
    initialize().catch(() => {
      // Initialize errors are handled by the store
      // Don't log to avoid noise in production
    });
  }, [initialize]);

  return null;
}
