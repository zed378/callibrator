/**
 * useApiKeys — the API-key screen: the key is shown once after creation,
 * scopes are required, revocation is confirmed, failures are shown. Also the
 * deferred initial load (F-03) and the list's failed state.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const apiKeyService = { getAll: jest.fn(), create: jest.fn(), revoke: jest.fn() };
jest.mock("@/api/services/apiKey.service", () => ({ apiKeyService }));

import { useApiKeys } from "../useApiKeys";
import { useToastStore } from "@/stores/toastStore";
import { apiKeyStatus } from "../../components/ApiKeysTable";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const list = { data: [{ id: "k1", name: "CMMS" }], meta: { page: 1, limit: 10, totalPages: 1 } };
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  apiKeyService.getAll.mockResolvedValue(list);
});

describe("useApiKeys", () => {
  it("loads the list after mount (deferred, F-03); a failed load is an error, not an empty list", async () => {
    const { result } = renderHook(() => useApiKeys());
    expect(result.current.isApiKeysLoading).toBe(true);
    await waitFor(() => expect(result.current.apiKeys).toEqual(list));
    expect(apiKeyService.getAll).toHaveBeenCalledWith(1, 10);

    apiKeyService.getAll.mockRejectedValue(new Error("DB down"));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.apiKeysError).toBe("DB down"));
  });

  it("scopes are trimmed, de-duplicated and required", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.apiKeys).toEqual(list));
    act(() => result.current.openCreateModal());
    await act(async () => result.current.handleCreateSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "Add at least one scope" });
    expect(apiKeyService.create).not.toHaveBeenCalled();

    act(() => {
      result.current.addScope(" device:read ");
      result.current.addScope("device:read");
      result.current.addScope("   ");
      result.current.addScope("stock:read");
      result.current.removeScope("stock:read");
    });
    expect(result.current.form.scopes).toEqual(["device:read"]);
  });

  it("the created key is revealed once; closing refreshes the list and forgets it", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.apiKeys).toEqual(list));
    apiKeyService.create.mockResolvedValue({ id: "k2", key: "ck_live_secret" });
    act(() => {
      result.current.openCreateModal();
      result.current.setForm({ name: "  CMMS  ", scopes: ["device:read"], expiresAt: "2027-01-01" });
    });
    await act(async () => result.current.handleCreateSubmit(ev));
    expect(apiKeyService.create).toHaveBeenCalledWith({
      name: "CMMS",
      scopes: ["device:read"],
      expiresAt: new Date("2027-01-01").toISOString(),
    });
    expect(result.current.createdKey).toBe("ck_live_secret");

    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await act(async () => result.current.copyCreatedKey());
    expect(writeText).toHaveBeenCalledWith("ck_live_secret");
    writeText.mockRejectedValue(new Error("denied"));
    await act(async () => result.current.copyCreatedKey());
    expect(lastToast()?.title).toBe("Failed to copy — copy it manually");

    const calls = apiKeyService.getAll.mock.calls.length;
    act(() => result.current.closeCreateModal());
    expect(result.current.createdKey).toBeNull();
    await waitFor(() => expect(apiKeyService.getAll.mock.calls.length).toBe(calls + 1));
  });

  it("a failed create is a toast with the backend's message", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.apiKeys).toEqual(list));
    apiKeyService.create.mockRejectedValue(new Error("Scope not grantable"));
    act(() => result.current.setForm({ name: "x", scopes: ["admin:*"], expiresAt: "" }));
    await act(async () => result.current.handleCreateSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "Scope not grantable" });
    expect(result.current.createdKey).toBeNull();
  });

  it("revocation is confirmed first; a failure keeps the dialog open", async () => {
    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => expect(result.current.apiKeys).toEqual(list));
    await act(async () => result.current.confirmRevoke());
    expect(apiKeyService.revoke).not.toHaveBeenCalled();

    act(() => result.current.handleRevokeClick({ id: "k1" } as never));
    apiKeyService.revoke.mockRejectedValueOnce(new Error("Already revoked"));
    await act(async () => result.current.confirmRevoke());
    expect(result.current.isRevokeConfirmOpen).toBe(true);
    expect(lastToast()?.title).toBe("Already revoked");

    apiKeyService.revoke.mockResolvedValue({ id: "k1" });
    await act(async () => result.current.confirmRevoke());
    expect(result.current.isRevokeConfirmOpen).toBe(false);
    expect(result.current.keyToRevoke).toBeNull();
  });
});

describe("apiKeyStatus (F-03: the clock is an argument, not read during render)", () => {
  const now = Date.parse("2026-09-24T00:00:00Z");
  it("revoked wins; expiry is compared with the given time; no expiry never expires", () => {
    expect(apiKeyStatus({ isActive: false, expiresAt: null }, now)).toBe("revoked");
    expect(apiKeyStatus({ isActive: true, expiresAt: "2026-09-23T00:00:00Z" }, now)).toBe("expired");
    expect(apiKeyStatus({ isActive: true, expiresAt: "2026-09-25T00:00:00Z" }, now)).toBe("active");
    expect(apiKeyStatus({ isActive: true, expiresAt: null }, now)).toBe("active");
  });
});
