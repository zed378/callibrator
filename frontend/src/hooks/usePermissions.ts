"use client";

import { useCallback } from "react";
import { useMenuStore } from "@/stores/menuStore";

/**
 * ADR-102 — what the signed-in user may do, from the SAME effective
 * permission the API gate checks (GET /menu-groups/my-permissions, loaded with
 * the menu). docs/FRONTEND/05-RBAC-IN-UI.md: never a client-side list of role
 * names. A page offers a write action when `canWrite(<slug its API write call
 * is gated on>)`; the API still decides.
 *
 * Until the permissions load (or when they failed to), nothing is writable:
 * the failure mode is FEWER buttons, never a button that 403s.
 */
export interface Permissions {
  /** Whether the permissions have loaded. */
  loaded: boolean;
  /** The platform super admin: passes every menu gate. */
  superAdmin: boolean;
  canRead: (slug: string) => boolean;
  canWrite: (slug: string) => boolean;
}

export function usePermissions(): Permissions {
  const effective = useMenuStore((s) => s.effectivePermissions);

  const canWrite = useCallback(
    (slug: string) =>
      effective !== null &&
      (effective.superAdmin || effective.permissions[slug] === "write"),
    [effective],
  );
  const canRead = useCallback(
    (slug: string) =>
      effective !== null &&
      (effective.superAdmin ||
        effective.permissions[slug] === "read" ||
        effective.permissions[slug] === "write"),
    [effective],
  );

  return {
    loaded: effective !== null,
    superAdmin: effective?.superAdmin === true,
    canRead,
    canWrite,
  };
}
