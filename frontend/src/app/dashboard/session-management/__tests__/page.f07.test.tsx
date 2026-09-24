/**
 * F-07 — the session-management screen no longer swallows failures.
 *
 * Fail-before: a failed load rendered "No sessions found", and a failed
 * revoke was `catch { /* ignore * / }` while nothing told the operator the
 * session was still live.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";

jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const svc = {
  getAll: jest.fn(),
  getStats: jest.fn(),
  revoke: jest.fn(),
  delete: jest.fn(),
  revokeAllForUser: jest.fn(),
};
jest.mock("@/api/services/session.service", () => ({ sessionService: svc }));

import SessionManagementPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const row = {
  id: "s-2",
  userId: "u-other",
  username: "bob",
  email: "bob@x.test",
  ipAddress: "10.0.0.2",
  userAgent: "ua",
  device: "desktop",
  browser: "Firefox",
  os: "Linux",
  location: "ward",
  role: "TECH",
  tenantId: "t1",
  tenantName: "RS",
  isRevoked: false,
  isActive: true,
  expiredAt: "2099-01-01T00:00:00Z",
  revokedAt: null,
  revokedReason: null,
  lastActivityAt: "2026-09-24T00:00:00Z",
  createdAt: "2026-09-24T00:00:00Z",
  status: "active" as const,
};

const httpError = (status: number, message: string, requestId: string) => {
  const e = new AxiosError(message, "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: { message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  }) as AxiosError & { requestId?: string };
  e.requestId = requestId;
  return e;
};

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useAuthStore.setState({
    isAuthenticated: true,
    isLoading: false,
    user: { id: "u1", username: "ada", email: "a@x.test", roleId: "r1" } as User,
    fetchUser: jest.fn(async () => {}),
  });
  svc.getStats.mockResolvedValue({ total: 1, active: 1, expired: 0, revoked: 0 });
});

const renderPage = async () => {
  render(<SessionManagementPage />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};

describe("session management (F-07)", () => {
  it("a failed load is an error state with the reference — not 'No sessions found'", async () => {
    svc.getAll.mockRejectedValue(httpError(500, "Database unavailable", "req-9"));

    await renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByText("req-9")).toBeInTheDocument();
    expect(screen.queryByText("No sessions found")).toBeNull();
  });

  it("a failed revoke says so, and the row stays", async () => {
    svc.getAll.mockResolvedValue({
      sessions: [row],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });
    svc.revoke.mockRejectedValue(httpError(409, "Session already ended", "req-7"));

    await renderPage();
    fireEvent.click(screen.getByTitle("Revoke Session"));
    const confirm = screen
      .getAllByRole("button", { name: "Revoke Session" })
      .find((b) => !b.hasAttribute("title")) as HTMLElement;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        type: "error",
        title: "The session was NOT revoked",
        description: "Session already ended (reference req-7)",
      }),
    );
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("a successful revoke is confirmed", async () => {
    svc.getAll.mockResolvedValue({
      sessions: [row],
      meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });
    svc.revoke.mockResolvedValue(undefined);

    await renderPage();
    fireEvent.click(screen.getByTitle("Revoke Session"));
    const confirm = screen
      .getAllByRole("button", { name: "Revoke Session" })
      .find((b) => !b.hasAttribute("title")) as HTMLElement;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        type: "success",
        title: "Session revoked",
      }),
    );
    expect(svc.revoke).toHaveBeenCalledWith("s-2", "MANUAL_REVOKE");
  });

  it("a failed 'revoke all others' is reported, not thrown away", async () => {
    svc.getAll.mockResolvedValue({ sessions: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } });
    svc.revokeAllForUser.mockRejectedValue(new Error("nope"));

    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Revoke All Others/ }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        type: "error",
        title: "Your other sessions were NOT revoked",
      }),
    );
  });
});
