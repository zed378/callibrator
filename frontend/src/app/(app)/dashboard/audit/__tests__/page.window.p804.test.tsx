/** @jest-environment jsdom */
/**
 * P8-04 (ADR-096) — the audit page states the backend's default window and a
 * capped total, against the contract of audit.service#fetchAuditLogs:
 *  - no Start Date / End Date / resource → the backend reads the last 90 days
 *    and answers `meta.window = { from, to: null, defaulted: true }`;
 *  - `meta.total` is at most 10,000; `meta.totalIsCapped` is true past it.
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: "u-1", tenantId: "t-1", role: { name: "HEALTCARE_ADMIN" } } }),
}));

import { api } from "@/api/client";
import AuditLogPage from "../page";

const mockedGet = api.get as jest.Mock;
const FROM = "2026-07-01T00:00:00.000Z";

const ROW = {
  id: "log-1",
  tenantId: "t-1",
  userId: "u-1",
  actorType: "user",
  actorName: null,
  action: "UPDATE",
  resourceType: "CalibrationDevice",
  resourceId: null,
  changes: null,
  createdAt: "2026-09-24T10:00:00.000Z",
  user: null,
};

const answer = (meta: Record<string, unknown>) => {
  mockedGet.mockResolvedValue({
    success: true,
    status: 200,
    message: "ok",
    data: [ROW],
    meta: { total: 0, page: 1, limit: 10, totalPages: 0, ...meta },
  });
};

beforeEach(() => jest.clearAllMocks());

describe("P8-04 — audit page default window and capped total", () => {
  it("says the list is the last 90 days when the backend defaulted the window", async () => {
    answer({ window: { from: FROM, to: null, defaulted: true } });

    render(<AuditLogPage />);

    const note = await screen.findByTestId("audit-default-window");
    expect(note).toHaveTextContent("Showing the last 90 days");
    expect(note).toHaveTextContent(new Date(FROM).toLocaleDateString());
  });

  it("says nothing about a window the caller chose", async () => {
    answer({ window: { from: FROM, to: null, defaulted: false } });

    render(<AuditLogPage />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(screen.queryByTestId("audit-default-window")).toBeNull();
  });

  it("says the total is a lower bound when the backend capped the count", async () => {
    answer({ total: 10000, totalPages: 1000, totalIsCapped: true });

    render(<AuditLogPage />);

    expect(await screen.findByTestId("audit-total-capped")).toHaveTextContent(
      `More than ${(10000).toLocaleString()} entries match`,
    );
  });

  it("an exact total carries no note", async () => {
    answer({ total: 12, totalPages: 2, totalIsCapped: false });

    render(<AuditLogPage />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalled());
    expect(screen.queryByTestId("audit-total-capped")).toBeNull();
  });
});
