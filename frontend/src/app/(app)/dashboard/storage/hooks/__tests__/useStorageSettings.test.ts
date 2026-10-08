/**
 * useStorageSettings — settings and usage load independently, save/reset
 * refresh usage, the connection test reports reachability, and every
 * failure is a toast. Returns mirror storage.service (each method unwraps
 * the envelope's `data`).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const storageService = {
  getSettings: jest.fn(),
  getUsage: jest.fn(),
  updateSettings: jest.fn(),
  clearSettings: jest.fn(),
  testConnection: jest.fn(),
};
jest.mock("@/api/services/storage.service", () => ({ storageService }));

import { useStorageSettings } from "../useStorageSettings";
import { useToastStore } from "@/stores/toastStore";

const platform = { provider: "local", usingPlatformDefault: true };
const s3 = { provider: "s3", usingPlatformDefault: false, hasCredentials: true, bucket: "rs-a", region: "ap-southeast-3" };
const usage = { bytes: 2048, objects: 2, megabytes: 0, provider: "local" };
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  storageService.getSettings.mockResolvedValue(platform);
  storageService.getUsage.mockResolvedValue(usage);
});

const setup = async () => {
  const hook = renderHook(() => useStorageSettings());
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
};

describe("useStorageSettings", () => {
  it("loads settings and usage", async () => {
    const { result } = await setup();
    expect(result.current.settings).toEqual(platform);
    expect(result.current.usage).toEqual(usage);
  });

  it("an unreachable bucket's usage failure does not block the settings", async () => {
    storageService.getUsage.mockRejectedValue(new Error("bucket unreachable"));
    const { result } = await setup();
    expect(result.current.settings).toEqual(platform);
    expect(result.current.usage).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("a failed settings load is a toast", async () => {
    storageService.getSettings.mockRejectedValue(new Error("Forbidden"));
    const { result } = await setup();
    expect(result.current.settings).toBeNull();
    expect(lastToast()).toMatchObject({ type: "error", title: "Failed to load storage settings" });
  });

  it("save sends the input, stores the verified settings and refreshes usage", async () => {
    storageService.updateSettings.mockResolvedValue(s3);
    const { result } = await setup();
    const input = { provider: "s3" as const, bucket: "rs-a", accessKeyId: "AK", secretAccessKey: "SK" };
    let ok = false;
    await act(async () => {
      ok = await result.current.save(input);
    });
    expect(ok).toBe(true);
    expect(storageService.updateSettings).toHaveBeenCalledWith(input);
    expect(result.current.settings).toEqual(s3);
    expect(lastToast()).toMatchObject({ type: "success", title: "Storage configured" });
    await waitFor(() => expect(storageService.getUsage).toHaveBeenCalledTimes(2));
    expect(result.current.isSaving).toBe(false);
  });

  it("a save the backend's connection test rejects returns false with its reason", async () => {
    const { result } = await setup();
    storageService.updateSettings.mockRejectedValueOnce(new Error("AccessDenied: bucket rs-a"));
    let ok = true;
    await act(async () => {
      ok = await result.current.save({ provider: "s3", bucket: "rs-a" });
    });
    expect(ok).toBe(false);
    expect(lastToast()).toMatchObject({
      type: "error", title: "Could not save storage settings", description: "AccessDenied: bucket rs-a",
    });
    storageService.updateSettings.mockRejectedValueOnce("x");
    await act(async () => {
      await result.current.save({ provider: "nfs", root: "/mnt" });
    });
    expect(lastToast()?.description).toBe("The storage connection test failed.");
    expect(result.current.settings).toEqual(platform);
  });

  it("reset reverts to platform storage; a failure is a toast", async () => {
    storageService.getSettings.mockResolvedValue(s3);
    const { result } = await setup();
    storageService.clearSettings.mockResolvedValueOnce(platform);
    await act(async () => result.current.reset());
    expect(result.current.settings).toEqual(platform);
    expect(lastToast()).toMatchObject({ type: "success", title: "Reverted to platform storage" });

    storageService.clearSettings.mockRejectedValueOnce(new Error("Forbidden"));
    await act(async () => result.current.reset());
    expect(lastToast()).toMatchObject({ type: "error", title: "Could not reset storage settings", description: "Forbidden" });
    storageService.clearSettings.mockRejectedValueOnce("x");
    await act(async () => result.current.reset());
    expect(lastToast()?.description).toBeUndefined();
    expect(result.current.isSaving).toBe(false);
  });

  it("the connection test reports reachable, unreachable, and a failed request", async () => {
    const { result } = await setup();
    storageService.testConnection.mockResolvedValueOnce({ ok: true, driver: "s3", bucket: "rs-a" });
    await act(async () => result.current.test());
    expect(lastToast()).toMatchObject({ type: "success", title: "Storage reachable (s3)" });

    storageService.testConnection.mockResolvedValueOnce({ ok: true });
    await act(async () => result.current.test());
    expect(lastToast()?.title).toBe("Storage reachable (ok)");

    storageService.testConnection.mockResolvedValueOnce({ ok: false, error: "ENOTFOUND minio" });
    await act(async () => result.current.test());
    expect(lastToast()).toMatchObject({ type: "error", title: "Storage unreachable", description: "ENOTFOUND minio" });

    storageService.testConnection.mockRejectedValueOnce(new Error("Too many requests"));
    await act(async () => result.current.test());
    expect(lastToast()).toMatchObject({ type: "error", title: "Connection test failed", description: "Too many requests" });
    storageService.testConnection.mockRejectedValueOnce(0);
    await act(async () => result.current.test());
    expect(lastToast()?.description).toBeUndefined();
    expect(result.current.isTesting).toBe(false);
  });
});
