/**
 * useWebhooks — the paths the page test (webhooks/__tests__/page.test.tsx)
 * does not reach: list and deliveries failures, the event editor, the
 * no-event guard, an edit that does not rotate the secret, delete, the test
 * button's outcomes, rotate failures and clipboard failure.
 * webhookService returns: getAll/getDeliveries a PaginatedResponse, create /
 * rotateSecret the webhook with `secret`, update the webhook with `secret`
 * only when the url changed (A-51), test a WebhookTestResult.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const webhookService = {
  getAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  rotateSecret: jest.fn(), getDeliveries: jest.fn(), test: jest.fn(),
};
jest.mock("@/api/services/webhook.service", () => ({ webhookService }));

import { useWebhooks } from "../useWebhooks";
import { useToastStore } from "@/stores/toastStore";
import type { Webhook } from "@/api/services/webhook.service";

const ev = { preventDefault: jest.fn() } as unknown as React.FormEvent;
const hook1 = {
  id: "h1", tenantId: "t1", url: "https://r.example.com/a", events: ["device.overdue"],
  description: null, isActive: true, createdBy: "u1", createdAt: "2026-09-24T08:00:00.000Z",
} as Webhook;
const hook2 = { ...hook1, id: "h2", url: "https://r.example.com/b" } as Webhook;
const page = <T,>(rows: T[]) => ({ success: true, message: "ok", data: rows, meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 } });
const delivery = { id: "dl1", webhookId: "h1", event: "webhook.test", status: "success", attempts: 1, responseStatus: 200 };
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { success: false, status, message } } });
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  webhookService.getAll.mockResolvedValue(page([hook1, hook2]));
  webhookService.getDeliveries.mockResolvedValue(page([delivery]));
});

const setup = async () => {
  const h = renderHook(() => useWebhooks());
  await waitFor(() => expect(h.result.current.webhooks?.data).toHaveLength(2));
  return h;
};

describe("useWebhooks", () => {
  it("a failed list load is an error, with the backend message or a fallback", async () => {
    webhookService.getAll.mockRejectedValueOnce(httpError(403, "Forbidden"));
    const { result } = renderHook(() => useWebhooks());
    await waitFor(() => expect(result.current.webhooksError).toBe("Forbidden"));
    expect(result.current.isWebhooksLoading).toBe(false);
    webhookService.getAll.mockRejectedValueOnce("x");
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(result.current.webhooksError).toBe("Failed to load webhooks"));
    expect(webhookService.getAll).toHaveBeenLastCalledWith(2, 10);
  });

  it("the deliveries panel loads for one webhook, toggles closed, and switches", async () => {
    const { result } = await setup();
    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveries?.data).toEqual([delivery]));
    expect(webhookService.getDeliveries).toHaveBeenCalledWith("h1", 1, 10);
    act(() => result.current.setDeliveriesPage(2));
    await waitFor(() => expect(webhookService.getDeliveries).toHaveBeenLastCalledWith("h1", 2, 10));
    await waitFor(() => expect(result.current.isDeliveriesLoading).toBe(false));

    act(() => result.current.toggleDeliveries(hook2));
    expect(result.current.deliveriesPage).toBe(1);
    await waitFor(() => expect(webhookService.getDeliveries).toHaveBeenLastCalledWith("h2", 1, 10));
    await waitFor(() => expect(result.current.deliveries).not.toBeNull());
    act(() => result.current.toggleDeliveries(hook2));
    expect(result.current.deliveriesWebhook).toBeNull();
    expect(result.current.deliveries).toBeNull();
  });

  it("a failed deliveries load is the panel's error", async () => {
    webhookService.getDeliveries.mockRejectedValueOnce(httpError(404, "Webhook not found"));
    const { result } = await setup();
    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveriesError).toBe("Webhook not found"));
    act(() => result.current.closeDeliveries());
    webhookService.getDeliveries.mockRejectedValueOnce({});
    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveriesError).toBe("Failed to load deliveries"));
  });

  it("the event editor toggles, adds trimmed unique events and removes them", async () => {
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.toggleEvent("device.overdue"));
    act(() => result.current.addEvent("  calibration.completed "));
    act(() => result.current.addEvent("calibration.completed"));
    act(() => result.current.addEvent("   "));
    expect(result.current.form.events).toEqual(["device.overdue", "calibration.completed"]);
    act(() => result.current.toggleEvent("device.overdue"));
    act(() => result.current.removeEvent("calibration.completed"));
    expect(result.current.form.events).toEqual([]);
    act(() => result.current.closeWebhookModal());
    expect(result.current.isWebhookModalOpen).toBe(false);
  });

  it("a webhook with no events is refused before any request", async () => {
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setForm((f) => ({ ...f, url: "https://x.example.com" })));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(lastToast()).toMatchObject({ type: "error", title: "Select at least one event" });
    expect(webhookService.create).not.toHaveBeenCalled();
  });

  it("a refused create keeps the modal and shows the backend message", async () => {
    webhookService.create.mockRejectedValueOnce(httpError(400, "url must be https"));
    const { result } = await setup();
    act(() => result.current.openCreateModal());
    act(() => result.current.setForm({ url: " http://x ", events: ["a"], description: " ", isActive: true }));
    await act(async () => result.current.handleFormSubmit(ev));
    expect(webhookService.create).toHaveBeenCalledWith({ url: "http://x", events: ["a"], description: undefined });
    expect(lastToast()).toMatchObject({ type: "error", title: "url must be https" });
    expect(result.current.isWebhookModalOpen).toBe(true);
    expect(result.current.revealedSecret).toBeNull();
    webhookService.create.mockRejectedValueOnce("x");
    await act(async () => result.current.handleFormSubmit(ev));
    expect(lastToast()?.title).toBe("Failed to save webhook");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("an edit that keeps the url reveals no secret and reloads the list", async () => {
    webhookService.update.mockResolvedValueOnce({ ...hook1, isActive: false });
    const { result } = await setup();
    act(() => result.current.openEditModal({ ...hook1, events: undefined, description: "old" } as unknown as Webhook));
    expect(result.current.form).toEqual({ url: hook1.url, events: [], description: "old", isActive: true });
    act(() => result.current.setForm((f) => ({ ...f, events: ["device.overdue"], isActive: false })));
    const loads = webhookService.getAll.mock.calls.length;
    await act(async () => result.current.handleFormSubmit(ev));
    expect(webhookService.update).toHaveBeenCalledWith("h1", {
      url: hook1.url, events: ["device.overdue"], description: "old", isActive: false,
    });
    expect(lastToast()).toMatchObject({ type: "success", title: "Webhook updated" });
    expect(result.current.revealedSecret).toBeNull();
    await waitFor(() => expect(webhookService.getAll.mock.calls.length).toBe(loads + 1));
  });

  it("delete: nothing without a target; success closes the open deliveries panel; a refusal is a toast", async () => {
    const { result } = await setup();
    await act(async () => result.current.confirmDelete());
    expect(webhookService.delete).not.toHaveBeenCalled();

    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveries).not.toBeNull());
    act(() => result.current.handleDeleteClick(hook1));
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    webhookService.delete.mockRejectedValueOnce(httpError(404, "Webhook not found"));
    await act(async () => result.current.confirmDelete());
    expect(lastToast()).toMatchObject({ type: "error", title: "Webhook not found" });
    expect(result.current.isDeleteConfirmOpen).toBe(true);
    webhookService.delete.mockRejectedValueOnce(null);
    await act(async () => result.current.confirmDelete());
    expect(lastToast()?.title).toBe("Failed to delete webhook");

    webhookService.delete.mockResolvedValueOnce({ id: "h1" });
    await act(async () => result.current.confirmDelete());
    expect(webhookService.delete).toHaveBeenLastCalledWith("h1");
    expect(lastToast()).toMatchObject({ type: "success", title: "Webhook deleted" });
    expect(result.current.isDeleteConfirmOpen).toBe(false);
    expect(result.current.deliveriesWebhook).toBeNull();
    await waitFor(() => expect(result.current.isWebhooksLoading).toBe(false));
  });

  it("deleting a webhook whose deliveries are not open leaves the panel alone", async () => {
    webhookService.delete.mockResolvedValueOnce({ id: "h2" });
    const { result } = await setup();
    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveries).not.toBeNull());
    act(() => result.current.handleDeleteClick(hook2));
    await act(async () => result.current.confirmDelete());
    expect(result.current.deliveriesWebhook).toBe(hook1);
    await waitFor(() => expect(result.current.isWebhooksLoading).toBe(false));
  });

  it("the test button reports success, a failed delivery with its reason, and a failed request", async () => {
    const { result } = await setup();
    act(() => result.current.toggleDeliveries(hook1));
    await waitFor(() => expect(result.current.deliveries).not.toBeNull());
    const deliveryLoads = webhookService.getDeliveries.mock.calls.length;

    webhookService.test.mockResolvedValueOnce({ deliveryId: "d", status: "success", responseStatus: 204, attempts: 1 });
    await act(async () => result.current.handleTestClick(hook1));
    expect(lastToast()).toMatchObject({ type: "success", title: "Test delivered (HTTP 204)" });
    await waitFor(() => expect(webhookService.getDeliveries.mock.calls.length).toBe(deliveryLoads + 1));

    webhookService.test.mockResolvedValueOnce({ deliveryId: "d", status: "success", responseStatus: null, attempts: 1 });
    await act(async () => result.current.handleTestClick(hook2));
    expect(lastToast()?.title).toBe("Test delivered (HTTP ?)");

    webhookService.test.mockResolvedValueOnce({ deliveryId: "d", status: "failed", responseStatus: 500, attempts: 1, lastError: "Internal" });
    await act(async () => result.current.handleTestClick(hook2));
    expect(lastToast()).toMatchObject({ type: "error", title: "Test failed (HTTP 500): Internal" });

    webhookService.test.mockResolvedValueOnce({ deliveryId: "d", status: "exhausted", responseStatus: null, attempts: 5, lastError: null });
    await act(async () => result.current.handleTestClick(hook2));
    expect(lastToast()?.title).toBe("Test exhausted");

    webhookService.test.mockRejectedValueOnce(httpError(429, "Too many requests"));
    await act(async () => result.current.handleTestClick(hook2));
    expect(lastToast()).toMatchObject({ type: "error", title: "Too many requests" });
    webhookService.test.mockRejectedValueOnce("x");
    await act(async () => result.current.handleTestClick(hook2));
    expect(lastToast()?.title).toBe("Failed to send test");
    expect(result.current.testingId).toBeNull();
    await waitFor(() => expect(result.current.isDeliveriesLoading).toBe(false));
  });

  it("rotate: nothing without a target; a refusal keeps the confirm; cancel is blocked while rotating", async () => {
    const { result } = await setup();
    await act(async () => result.current.confirmRotate());
    expect(webhookService.rotateSecret).not.toHaveBeenCalled();

    act(() => result.current.handleRotateClick(hook1));
    webhookService.rotateSecret.mockRejectedValueOnce(httpError(404, "Webhook not found"));
    await act(async () => result.current.confirmRotate());
    expect(lastToast()).toMatchObject({ type: "error", title: "Webhook not found" });
    expect(result.current.webhookToRotate).toBe(hook1);
    webhookService.rotateSecret.mockRejectedValueOnce(0);
    await act(async () => result.current.confirmRotate());
    expect(lastToast()?.title).toBe("Failed to rotate secret");

    let release: (v: unknown) => void = () => {};
    webhookService.rotateSecret.mockReturnValueOnce(new Promise((r) => { release = r; }));
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.confirmRotate(); });
    expect(result.current.isRotating).toBe(true);
    act(() => result.current.cancelRotate());
    expect(result.current.webhookToRotate).toBe(hook1);
    await act(async () => {
      release({ ...hook1, secret: "s".repeat(64) });
      await pending;
    });
    expect(result.current.revealedSecret).toEqual({ secret: "s".repeat(64), reason: "rotated", webhookUrl: hook1.url });
    act(() => result.current.handleRotateClick(hook2));
    act(() => result.current.cancelRotate());
    expect(result.current.webhookToRotate).toBeNull();
  });

  it("copying the secret: nothing to copy without one; a clipboard failure says copy it manually", async () => {
    const writeText = jest.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    webhookService.rotateSecret.mockResolvedValue({ ...hook1, secret: "k".repeat(64) });
    const { result } = await setup();
    await act(async () => result.current.copyRevealedSecret());
    expect(writeText).not.toHaveBeenCalled();

    act(() => result.current.handleRotateClick(hook1));
    await act(async () => result.current.confirmRotate());
    await act(async () => result.current.copyRevealedSecret());
    expect(lastToast()).toMatchObject({ type: "error", title: "Failed to copy — copy it manually" });
    await act(async () => result.current.copyRevealedSecret());
    expect(writeText).toHaveBeenLastCalledWith("k".repeat(64));
    expect(lastToast()).toMatchObject({ type: "success", title: "Secret copied to clipboard" });

    act(() => result.current.closeSecretReveal());
    expect(result.current.revealedSecret).toBeNull();
    await waitFor(() => expect(result.current.isWebhooksLoading).toBe(false));
  });
});
