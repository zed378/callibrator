/**
 * ticketPov — the ticket desk's point of view. The role sets mirror the
 * backend's RESPONDER_ROLES (backend/src/services/ticket.service.js); the
 * lists below are written out independently, not derived from the module.
 */
import { renderHook } from "@testing-library/react";
import { isResponderRole, isSuperAdminRole, useTicketPov } from "../ticketPov";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const RESPONDERS = ["SUPER_ADMIN", "SUPERADMIN", "HEALTHCARE ADMIN", "CALIBRATOR ADMIN", "ENGINEERING MANAGER", "SUPERVISOR"];

describe("ticketPov", () => {
  it.each(RESPONDERS)("%s works the desk", (name) => {
    expect(isResponderRole(name)).toBe(true);
  });

  it("requesters, a missing role and case variants are not responders", () => {
    for (const name of ["TECHNICIAN", "USER", "supervisor", "", null, undefined]) {
      expect(isResponderRole(name)).toBe(false);
    }
  });

  it("only the two super-admin spellings are super admin", () => {
    expect(isSuperAdminRole("SUPER_ADMIN")).toBe(true);
    expect(isSuperAdminRole("SUPERADMIN")).toBe(true);
    expect(isSuperAdminRole("HEALTHCARE ADMIN")).toBe(false);
    expect(isSuperAdminRole(null)).toBe(false);
  });

  it("useTicketPov reads the signed-in user's role; signed out is a plain requester", () => {
    useAuthStore.setState({ user: null });
    const signedOut = renderHook(() => useTicketPov());
    expect(signedOut.result.current).toEqual({ roleName: null, isSuperAdmin: false, isResponder: false });

    useAuthStore.setState({ user: { id: "u1", role: { name: "SUPERVISOR" } } as unknown as User });
    const supervisor = renderHook(() => useTicketPov());
    expect(supervisor.result.current).toEqual({ roleName: "SUPERVISOR", isSuperAdmin: false, isResponder: true });

    useAuthStore.setState({ user: { id: "u2", role: { name: "SUPERADMIN" } } as unknown as User });
    const sa = renderHook(() => useTicketPov());
    expect(sa.result.current).toEqual({ roleName: "SUPERADMIN", isSuperAdmin: true, isResponder: true });
  });
});
