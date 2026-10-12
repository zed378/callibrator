"use client";
/**
 * P22-10c1 (P19-08 § 11.2, AM-23) — one field user per browser profile. When the signed-in user is
 * known and this profile ever enabled the field app (`localStorage["cf.field.present"] === "1"`),
 * the guard is loaded with `import()` and drops every OTHER user's offline working set without
 * opening it. On a profile that never enabled field mode it costs one `localStorage` read.
 */
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

/** The flag `field/platform/registryStore.ts` sets (kept equal by a test, not imported: no field code in this bundle). */
export const FIELD_PRESENT_FLAG = "cf.field.present";

const flagged = (): boolean => {
  try {
    return window.localStorage.getItem(FIELD_PRESENT_FLAG) === "1";
  } catch {
    return false;
  }
};

export function FieldProfileGuard() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const tenantId = useAuthStore((s) => s.user?.tenantId ?? null);

  useEffect(() => {
    if (!userId || !tenantId || !flagged()) return;
    void import("@/field/app/profileGuard")
      .then(({ runFieldProfileGuard }) => runFieldProfileGuard({ indexedDB: window.indexedDB, localStorage: window.localStorage }, { id: userId, tenantId }))
      .catch(() => {
        // The field app runs the same guard when it opens; a failure here is retried there.
      });
  }, [userId, tenantId]);

  return null;
}

export default FieldProfileGuard;
