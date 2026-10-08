/**
 * useNotifications — the notifications page: filters map to the request, the
 * page's response sets the shared unread badge (F-17: one server number), a
 * push refetches, and the write actions report failures.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

type Handler = () => void;
const handlers = new Map<string, Handler>();
const fakeSocket = {
  on: jest.fn((e: string, fn: Handler) => handlers.set(e, fn)),
  off: jest.fn((e: string) => handlers.delete(e)),
};
jest.mock("@/lib/socket", () => ({ getSocket: jest.fn(async () => fakeSocket) }));
const notificationService = { getAll: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn(), delete: jest.fn() };
jest.mock("@/api/services/notification.service", () => ({ notificationService }));

import { useNotifications } from "../useNotifications";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToastStore } from "@/stores/toastStore";

const res = (unread: number, n = 2) => ({
  notifications: Array.from({ length: n }, (_, i) => ({ id: `n${i}` })),
  meta: { total: n, unread, page: 1, limit: 10, totalPages: 1 },
});
const lastToast = () => useToastStore.getState().toasts.at(-1);

beforeEach(() => {
  jest.clearAllMocks();
  handlers.clear();
  useToastStore.setState({ toasts: [] });
  useNotificationStore.setState({ unreadCount: 0 });
  notificationService.getAll.mockResolvedValue(res(3));
});

describe("useNotifications", () => {
  it("loads, and sets the shared badge from the server's meta.unread", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    expect(useNotificationStore.getState().unreadCount).toBe(3);
    expect(result.current.isLoading).toBe(false);
  });

  it("filters map to isRead / type; an unknown type is not sent", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(notificationService.getAll).toHaveBeenCalled());
    act(() => result.current.handleReadFilterChange("unread"));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(1, 10, false, undefined));
    act(() => result.current.handleTypeFilterChange("CALIBRATION"));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(1, 10, false, "CALIBRATION"));
    act(() => result.current.handleReadFilterChange("read"));
    act(() => result.current.handleTypeFilterChange("BOGUS"));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(1, 10, true, undefined));
    act(() => result.current.setPageSize(25));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(1, 25, true, undefined));
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(2, 25, true, undefined));
  });

  it("a push refetches the page", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(handlers.has("new_notification")).toBe(true));
    notificationService.getAll.mockResolvedValue(res(4, 3));
    await act(async () => handlers.get("new_notification")?.());
    await waitFor(() => expect(result.current.notifications).toHaveLength(3));
    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });

  it("a failed load is an error", async () => {
    notificationService.getAll.mockRejectedValue(new Error("Inbox unavailable"));
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.error).toBe("Inbox unavailable"));
  });

  it("mark read, mark all, delete — success refetches, failure is a toast", async () => {
    const { result } = renderHook(() => useNotifications());
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    notificationService.markAsRead.mockResolvedValue({});
    await act(async () => result.current.markAsRead("n0"));
    expect(lastToast()?.title).toBe("Notification marked as read");
    notificationService.markAsRead.mockRejectedValue(new Error("gone"));
    await act(async () => result.current.markAsRead("n0"));
    expect(lastToast()).toMatchObject({ type: "error", title: "gone" });

    notificationService.markAllAsRead.mockResolvedValue({});
    await act(async () => result.current.markAllAsRead());
    expect(lastToast()?.title).toBe("All notifications marked as read");
    notificationService.markAllAsRead.mockRejectedValue("x");
    await act(async () => result.current.markAllAsRead());
    expect(lastToast()?.title).toBe("Failed to mark all notifications as read");

    notificationService.delete.mockResolvedValue({});
    await act(async () => result.current.deleteNotification("n0"));
    expect(lastToast()?.title).toBe("Notification deleted");
    notificationService.delete.mockRejectedValue(new Error("nope"));
    await act(async () => result.current.deleteNotification("n0"));
    expect(lastToast()).toMatchObject({ type: "error", title: "nope" });
  });

  it("deleting the last row of a later page steps back a page", async () => {
    notificationService.getAll.mockResolvedValue(res(0, 1));
    const { result } = renderHook(() => useNotifications());
    act(() => result.current.setCurrentPage(2));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(2, 10, undefined, undefined));
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    notificationService.delete.mockResolvedValue({});
    await act(async () => result.current.deleteNotification("n0"));
    await waitFor(() => expect(notificationService.getAll).toHaveBeenLastCalledWith(1, 10, undefined, undefined));
  });
});
