// src/components/layouts/ImpersonationBanner.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog, LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

/**
 * Shown while a super-admin is impersonating another user. Exiting maps to a
 * logout on the backend, so it returns to the sign-in page.
 */
export default function ImpersonationBanner() {
  const router = useRouter();
  const isImpersonating = useAuthStore((s) => s.isImpersonating);
  const user = useAuthStore((s) => s.user);
  const exitImpersonation = useAuthStore((s) => s.exitImpersonation);
  const [busy, setBusy] = useState(false);

  if (!isImpersonating) return null;

  const handleExit = async () => {
    setBusy(true);
    try {
      await exitImpersonation();
      router.push("/login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500/15 px-4 py-2 text-sm text-amber-700 dark:text-amber-300 border-b border-amber-500/30">
      <span className="flex items-center gap-2">
        <UserCog className="h-4 w-4 shrink-0" />
        Impersonating{" "}
        <strong className="font-semibold">
          {user?.username || user?.email || "user"}
        </strong>
      </span>
      <button
        type="button"
        onClick={handleExit}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-2.5 py-1 font-medium hover:bg-amber-500/30 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" />
        {busy ? "Exiting…" : "Exit impersonation"}
      </button>
    </div>
  );
}
