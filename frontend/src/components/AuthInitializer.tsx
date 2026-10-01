"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

export function AuthInitializer() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    // P10-13: this now mounts with the dashboard (AppProviders), so a
    // client-side step from the sign-in page into /dashboard arrives with the
    // session already in the store. Checking it again would flash the
    // dashboard's loading state for a session proved a moment ago.
    if (useAuthStore.getState().isAuthenticated) return;
    // Initialize silently - don't throw errors on init
    // This prevents immediate logout if verify endpoint is temporarily unavailable
    initialize().catch(() => {
      // Initialize errors are handled by the store
      // Don't log to avoid noise in production
    });
  }, [initialize]);

  return null;
}
