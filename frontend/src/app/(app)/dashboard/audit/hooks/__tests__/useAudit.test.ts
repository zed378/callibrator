/**
 * useAudit — the filters the audit page test does not drive (resource type,
 * date range, action), the platform scope being a super-admin-only request,
 * a superseded response never overwriting a newer one, and refresh.
 * auditService.getAll returns `{ logs, meta }` (rows from the envelope's
 * `data`, `meta` from its top-level `meta`).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const auditService = { getAll: jest.fn() };
jest.mock("@/api/services/audit.service", () => ({ auditService }));

import { useAudit } from "../useAudit";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const log = (id: string) => ({ id, action: "UPDATE", resourceType: "Device", createdAt: "2026-09-29T00:00:00Z" });
const result = (ids: string[]) => ({ logs: ids.map(log), meta: { total: ids.length, page: 1, limit: 10, totalPages: 1 } });
const change = (value: string) => ({ target: { value } }) as React.ChangeEvent<HTMLInputElement>;
const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", tenantId: "t1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
  signIn("HEALTHCARE ADMIN");
  auditService.getAll.mockResolvedValue(result(["l1"]));
});

const setup = async () => {
  const h = renderHook(() => useAudit());
  await waitFor(() => expect(h.result.current.logs).toHaveLength(1));
  await waitFor(() => expect(h.result.current.isLoading).toBe(false));
  return h;
};

describe("useAudit", () => {
  it("resource type and a date range reach the request as whole days; each resets the page", async () => {
    const { result: r } = await setup();
    act(() => r.current.setCurrentPage(3));
    act(() => r.current.handleResourceTypeChange(change("Device")));
    expect(r.current.currentPage).toBe(1);
    act(() => r.current.handleStartDateChange(change("2026-09-01")));
    act(() => r.current.handleEndDateChange(change("2026-09-30")));
    await waitFor(() =>
      expect(auditService.getAll).toHaveBeenLastCalledWith({
        page: 1, limit: 10, action: undefined, resourceType: "Device",
        startDate: "2026-09-01T00:00:00", endDate: "2026-09-30T23:59:59", scope: undefined,
      }),
    );
    await waitFor(() => expect(r.current.isLoading).toBe(false));
  });

  it("only a known action is sent as a filter", async () => {
    const { result: r } = await setup();
    act(() => r.current.handleActionFilterChange("APPROVE"));
    await waitFor(() => expect(auditService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ action: "APPROVE" })));
    act(() => r.current.handleActionFilterChange("DROP TABLE"));
    await waitFor(() => expect(auditService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ action: undefined })));
    expect(r.current.actionFilter).toBe("DROP TABLE");
    await waitFor(() => expect(r.current.isLoading).toBe(false));
  });

  it("a tenant user never asks for the platform trail, whatever the scope state says", async () => {
    const { result: r } = await setup();
    expect(r.current.isSuperAdmin).toBe(false);
    act(() => r.current.handleScopeChange("platform"));
    expect(r.current.scope).toBe("tenant");
    await act(async () => r.current.refresh());
    expect(auditService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ scope: undefined }));
  });

  it("the super admin may read the platform trail", async () => {
    signIn("SUPER_ADMIN");
    const { result: r } = await setup();
    act(() => r.current.handleScopeChange("platform"));
    await waitFor(() => expect(auditService.getAll).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "platform" })));
    await waitFor(() => expect(r.current.isLoading).toBe(false));
  });

  it("a response that arrives after the filter changed is dropped, success or failure", async () => {
    const { result: r } = await setup();
    let rejectOld: (e: unknown) => void = () => {};
    auditService.getAll
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce(result(["new"]));
    act(() => r.current.handleResourceTypeChange(change("Dev")));
    await waitFor(() => expect(auditService.getAll).toHaveBeenCalledTimes(2));
    act(() => r.current.handleResourceTypeChange(change("Device")));
    await waitFor(() => expect(r.current.logs.map((l) => l.id)).toEqual(["new"]));
    await act(async () => rejectOld(new Error("stale failure")));
    expect(r.current.error).toBeNull();
    expect(r.current.logs.map((l) => l.id)).toEqual(["new"]);
    expect(r.current.isLoading).toBe(false);
  });

  it("a failed load is an error; a non-Error rejection has a fallback; refresh recovers", async () => {
    auditService.getAll.mockRejectedValueOnce(new Error("Forbidden"));
    const { result: r } = renderHook(() => useAudit());
    await waitFor(() => expect(r.current.error).toBe("Forbidden"));
    auditService.getAll.mockRejectedValueOnce("x");
    await act(async () => r.current.refresh());
    expect(r.current.error).toBe("Failed to load audit logs");
    await act(async () => r.current.refresh());
    expect(r.current.error).toBeNull();
    expect(r.current.logs).toHaveLength(1);
  });
});
