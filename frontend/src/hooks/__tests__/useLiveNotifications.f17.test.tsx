/**
 * F-17 — the unread badge is the server's count, never a local tally.
 *
 * Fail-before: a push incremented the count locally while the notifications
 * page set it from `meta.unread`; a push that landed while the page's fetch
 * was in flight was counted twice, and a reconnect did not refetch.
 */
import React from "react";
import { act, render } from "@testing-library/react";

type Handler = (...args: unknown[]) => void;
const handlers = new Map<string, Handler>();
const fakeSocket = {
  connected: true,
  on: jest.fn((event: string, fn: Handler) => handlers.set(event, fn)),
  off: jest.fn((event: string) => handlers.delete(event)),
};
jest.mock("@/lib/socket", () => ({ getSocket: jest.fn(async () => fakeSocket) }));
jest.mock("@/lib/notificationSound", () => ({ playNotificationSound: jest.fn() }));

const mockGetAll = jest.fn();
jest.mock("@/api/services/notification.service", () => ({
  notificationService: { getAll: (...a: unknown[]) => mockGetAll(...a) },
}));

import { useLiveNotifications } from "../useLiveNotifications";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToastStore } from "@/stores/toastStore";

const serverUnread = (n: number) => ({ data: [], meta: { unread: n } });
const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

let latest: ReturnType<typeof useLiveNotifications> | null = null;
function Probe() {
  latest = useLiveNotifications();
  return null;
}

beforeEach(() => {
  handlers.clear();
  mockGetAll.mockReset();
  useNotificationStore.setState({ unreadCount: 0 });
  useToastStore.setState({ toasts: [] });
});

describe("notification badge (F-17)", () => {
  it("mount reads the server count", async () => {
    mockGetAll.mockResolvedValue(serverUnread(4));
    render(<Probe />);
    await flush();
    expect(useNotificationStore.getState().unreadCount).toBe(4);
    expect(latest?.connected).toBe(true);
  });

  it("a push re-reads the server count instead of incrementing — no double count", async () => {
    // The initial fetch ran after n5 was created, so the server's 5 already
    // includes it; the push for n5 then arrives. Old code: 5 + 1 = 6.
    mockGetAll.mockResolvedValue(serverUnread(5));
    render(<Probe />);
    await flush();

    await act(async () => {
      handlers.get("new_notification")?.({ id: "n5", title: "Due", message: "Pump due" });
    });
    await flush();

    expect(useNotificationStore.getState().unreadCount).toBe(5);
    expect(latest?.latest).toMatchObject({ id: "n5" });
    expect(useToastStore.getState().toasts[0]).toMatchObject({ title: "Due" });
  });

  it("a reconnect refetches the count (pushes missed while disconnected are not lost)", async () => {
    mockGetAll.mockResolvedValue(serverUnread(1));
    render(<Probe />);
    await flush();

    await act(async () => handlers.get("disconnect")?.());
    expect(latest?.connected).toBe(false);

    mockGetAll.mockResolvedValue(serverUnread(7));
    await act(async () => handlers.get("connect")?.());
    await flush();

    expect(latest?.connected).toBe(true);
    expect(useNotificationStore.getState().unreadCount).toBe(7);
  });

  it("unmount removes only this hook's listeners", async () => {
    mockGetAll.mockResolvedValue(serverUnread(0));
    const { unmount } = render(<Probe />);
    await flush();
    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith("new_notification", expect.any(Function));
  });
});

describe("notificationStore ordering (F-17)", () => {
  it("a refresh that resolves after a newer write is dropped — the newest read wins", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    mockGetAll.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    const stale = useNotificationStore.getState().refreshUnread();

    // The notifications page sets the count from its own, newer response.
    useNotificationStore.getState().setUnreadCount(2);
    resolveOld(serverUnread(9));
    await stale;

    expect(useNotificationStore.getState().unreadCount).toBe(2);
  });

  it("a failed refresh keeps the previous count; a negative count is clamped", async () => {
    useNotificationStore.getState().setUnreadCount(-3);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    useNotificationStore.getState().setUnreadCount(3);
    mockGetAll.mockRejectedValueOnce(new Error("down"));
    await useNotificationStore.getState().refreshUnread();
    expect(useNotificationStore.getState().unreadCount).toBe(3);
  });
});
