/**
 * useScheduler — the due list, the look-ahead input, the SUPERADMIN-only
 * allTenants flag, a manual run and its failures. Service returns are what
 * calibrationScheduler.service returns: getDue a plain array, run the
 * RunSummary in the envelope's `data`.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const calibrationSchedulerService = { getDue: jest.fn(), run: jest.fn() };
jest.mock("@/api/services/calibrationScheduler.service", () => ({ calibrationSchedulerService }));

import { useScheduler } from "../useScheduler";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

const due = [
  { id: "d1", name: "Infusion pump", tenantId: "t1", nextCalibrationDate: "2026-10-01", overdue: false },
];
const summary = {
  scanned: 1, workOrdersCreated: 1, notificationsCreated: 2, skipped: 0, overdue: 0, errors: 0,
  details: [{ deviceId: "d1", action: "created", workOrderId: "w1" }],
};
const lastToast = () => useToastStore.getState().toasts.at(-1);
// A-301 (ADR-102): the hook reads the effective permissions; the role name
// is set too, as the signed-in user carries it.
const signIn = (role: string, permissions: Record<string, "read" | "write"> = { maintenance: "write" }) => {
  useAuthStore.setState({ user: { id: "u1", role: { name: role } } as unknown as User });
  useMenuStore.setState({ effectivePermissions: { superAdmin: role === "SUPERADMIN", permissions } });
};
const change = (value: string) => ({ target: { value } }) as React.ChangeEvent<HTMLInputElement>;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  calibrationSchedulerService.getDue.mockResolvedValue(due);
  signIn("HEALTHCARE ADMIN");
});

const setup = async () => {
  const hook = renderHook(() => useScheduler());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
};

describe("useScheduler", () => {
  it("loads devices due in 30 days; a tenant user never sends allTenants", async () => {
    const { result } = await setup();
    expect(result.current.dueDevices).toEqual(due);
    expect(result.current.isSuperAdmin).toBe(false);
    act(() => result.current.setAllTenants(true));
    await waitFor(() =>
      expect(calibrationSchedulerService.getDue).toHaveBeenLastCalledWith({ leadDays: 30, allTenants: undefined }),
    );
  });

  // A-301 fail-before: the hook compared `role.name === "SUPERADMIN"` and had
  // no notion of who may run the scan.
  it("decides by the effective permissions, not the role name (A-301)", async () => {
    signIn("SUPERADMIN", {});
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, permissions: { maintenance: "read" } } });
    const named = await setup();
    expect(named.result.current.isSuperAdmin).toBe(false);
    expect(named.result.current.canRun).toBe(false);
    named.unmount();

    signIn("TECHNICIAN", { maintenance: "write" });
    const tech = await setup();
    expect(tech.result.current.canRun).toBe(true);
  });

  it("SUPERADMIN may ask for all tenants", async () => {
    signIn("SUPERADMIN");
    const { result } = await setup();
    act(() => result.current.setAllTenants(true));
    await waitFor(() =>
      expect(calibrationSchedulerService.getDue).toHaveBeenLastCalledWith({ leadDays: 30, allTenants: true }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("the look-ahead takes a number; negative or non-numeric input becomes 0", async () => {
    const { result } = await setup();
    act(() => result.current.handleLeadDaysChange(change("7")));
    expect(result.current.leadDays).toBe(7);
    await waitFor(() => expect(calibrationSchedulerService.getDue).toHaveBeenLastCalledWith({ leadDays: 7, allTenants: undefined }));
    act(() => result.current.handleLeadDaysChange(change("-3")));
    expect(result.current.leadDays).toBe(0);
    act(() => result.current.handleLeadDaysChange(change("abc")));
    expect(result.current.leadDays).toBe(0);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("a failed due-list load is an error with the backend message", async () => {
    calibrationSchedulerService.getDue.mockRejectedValueOnce(new Error("Forbidden"));
    const { result } = renderHook(() => useScheduler());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    calibrationSchedulerService.getDue.mockRejectedValueOnce(null);
    await act(async () => result.current.fetchDue());
    expect(result.current.error).toBe("Failed to load due devices");
  });

  it("a run reports its counts, keeps the summary and reloads the list", async () => {
    calibrationSchedulerService.run.mockResolvedValue(summary);
    const { result } = await setup();
    const loads = calibrationSchedulerService.getDue.mock.calls.length;
    await act(async () => result.current.handleRun());
    expect(calibrationSchedulerService.run).toHaveBeenCalledWith({ leadDays: 30, allTenants: undefined });
    expect(lastToast()).toMatchObject({
      type: "success", title: "Scheduler complete: 1 work order(s), 2 notification(s) created",
    });
    expect(result.current.lastRun).toEqual(summary);
    expect(result.current.isRunning).toBe(false);
    expect(calibrationSchedulerService.getDue.mock.calls.length).toBe(loads + 1);
    act(() => result.current.clearLastRun());
    expect(result.current.lastRun).toBeNull();
  });

  it("a failed run is a toast with the backend message, or a fallback", async () => {
    const { result } = await setup();
    calibrationSchedulerService.run.mockRejectedValueOnce(new Error("Too many requests"));
    await act(async () => result.current.handleRun());
    expect(lastToast()).toMatchObject({ type: "error", title: "Too many requests" });
    calibrationSchedulerService.run.mockRejectedValueOnce({});
    await act(async () => result.current.handleRun());
    expect(lastToast()).toMatchObject({ type: "error", title: "Scheduler run failed" });
    expect(result.current.lastRun).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });
});
