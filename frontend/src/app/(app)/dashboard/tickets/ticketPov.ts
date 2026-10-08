// Ticket point-of-view helpers.
//
// Mirrors the backend RESPONDER_ROLES set (ticket.service.js): the super admin
// works the cross-tenant desk, per-tenant admins/managers work their own tenant,
// and everyone else is a requester who only ever sees their own tickets.
import { useAuthStore } from "@/stores/authStore";

const SUPER_ADMIN_ROLES = new Set(["SUPER_ADMIN", "SUPERADMIN"]);

const RESPONDER_ROLES = new Set([
  "SUPER_ADMIN",
  "SUPERADMIN",
  "HEALTHCARE ADMIN",
  "CALIBRATOR ADMIN",
  "ENGINEERING MANAGER",
  "SUPERVISOR",
]);

export const isSuperAdminRole = (name?: string | null): boolean =>
  !!name && SUPER_ADMIN_ROLES.has(name);

export const isResponderRole = (name?: string | null): boolean =>
  !!name && RESPONDER_ROLES.has(name);

export interface TicketPov {
  roleName: string | null;
  isSuperAdmin: boolean;
  isResponder: boolean;
}

/** Resolve the current user's ticket point of view from the auth store. */
export function useTicketPov(): TicketPov {
  const user = useAuthStore((s) => s.user);
  const roleName = user?.role?.name ?? null;
  return {
    roleName,
    isSuperAdmin: isSuperAdminRole(roleName),
    isResponder: isResponderRole(roleName),
  };
}
