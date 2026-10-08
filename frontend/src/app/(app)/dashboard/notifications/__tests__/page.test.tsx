/**
 * The notifications page through the REAL useNotifications hook and
 * notification service — `@/api/client` mocked with the backend's list
 * envelope (backend notification controller: rows in `data`, `meta` top-level
 * carrying `unread`). The live socket is absent here (getSocket → null); the
 * hook's socket path has its own tests.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

// next/link prefetches on an idle callback that lands after the test.
jest.mock("next/link", () => {
  return function Link({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

jest.mock("@/lib/socket", () => ({ getSocket: jest.fn(async () => null) }));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import type { Notification } from "@/api/services/notification.service";
import { useNotificationStore } from "@/stores/notificationStore";
import { useToastStore } from "@/stores/toastStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import NotificationsPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const n = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  tenantId: "t-1",
  userId: "u-1",
  type: "CALIBRATION",
  title: `Title ${id}`,
  message: `Message ${id}`,
  isRead: false,
  actionUrl: null,
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  ...over,
});

const envelope = (rows: Notification[], over: Record<string, number> = {}) => ({
  success: true,
  status: 200,
  message: "Notifications retrieved",
  data: rows,
  meta: { total: rows.length, unread: rows.filter((r) => !r.isRead).length, page: 1, limit: 10, totalPages: 1, ...over },
});

let answer: () => unknown;
const ok = (data: unknown) => ({ success: true, status: 200, message: "ok", data });
const lastToast = () => useToastStore.getState().toasts.at(-1);

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  useNotificationStore.setState({ unreadCount: 0 });
  answer = () =>
    envelope([
      n("n1", { title: "Certificate due", actionUrl: "/dashboard/calibration" }),
      n("n2", { title: "Low stock", type: "INVENTORY", isRead: true }),
      n("n3", { title: "Mystery", type: "UNKNOWN" as Notification["type"] }),
    ]);
  get.mockImplementation(async () => {
    const r = answer();
    if (r instanceof Error) throw r;
    return r;
  });
});

const renderPage = async () => {
  const view = render(<NotificationsPage />);
  await screen.findByText("Certificate due");
  return view;
};

describe("Notifications page — list", () => {
  it("lists notifications with type, unread marker and link; syncs the bell's unread count", async () => {
    const { container } = await renderPage();
    expect(get).toHaveBeenCalledWith("/api/v1/notifications", { params: { page: 1, limit: 10 } });
    expect(screen.getByText("2 unread")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Certificate due" })).toHaveAttribute("href", "/dashboard/calibration");
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    // An unknown type falls back to System.
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Unread" })).toHaveLength(2);
    expect(useNotificationStore.getState().unreadCount).toBe(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("nothing to show: 'all caught up'; delete-all and mark-all are disabled", async () => {
    answer = () => envelope([]);
    const { container } = render(<NotificationsPage />);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, never 'all caught up'", async () => {
    answer = () => networkError();
    const { container } = render(<NotificationsPage />);
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("type and read filters reach the request", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "All Types" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Maintenance" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/notifications", { params: { page: 1, limit: 10, type: "MAINTENANCE" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "All Notifications" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Unread" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/notifications", {
        params: { page: 1, limit: 10, isRead: "false", type: "MAINTENANCE" },
      }),
    );
  });
});

describe("Notifications page — actions", () => {
  it("mark one as read PATCHes it, toasts and reloads", async () => {
    await renderPage();
    patch.mockResolvedValue(ok(n("n1", { isRead: true })));
    get.mockClear();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Mark as read" })[0]);
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/notifications/n1/read");
    expect(lastToast()).toMatchObject({ type: "success", title: "Notification marked as read" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("mark all as read PATCHes read-all", async () => {
    await renderPage();
    patch.mockResolvedValue(ok(null));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/notifications/read-all");
    expect(lastToast()).toMatchObject({ type: "success", title: "All notifications marked as read" });
  });

  it("a notification of another user (404) cannot be marked, and says so", async () => {
    await renderPage();
    patch.mockRejectedValue(httpError(404, "Notification not found"));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Mark as read" })[0]);
    });
    expect(lastToast()).toMatchObject({ type: "error", title: "Notification not found" });
  });

  it("deleting one DELETEs it", async () => {
    await renderPage();
    del.mockResolvedValue(ok(null));
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Delete notification" })[1]);
    });
    expect(del).toHaveBeenCalledWith("/api/v1/notifications/n2");
    expect(lastToast()).toMatchObject({ type: "success", title: "Notification deleted" });
  });

  it("select two, confirm, and DELETE /bulk sends their ids; the toast gives the server's count", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Certificate due" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Low stock" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete 2 notifications?" });
    expect(await axeViolations(dialog)).toEqual([]);
    del.mockResolvedValue(ok({ deleted: 1, requested: 2 }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/notifications/bulk", { data: { ids: ["n1", "n2"] } });
    expect(lastToast()).toMatchObject({ type: "success", title: "1 notification deleted" });
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });

  it("select all on the page, then clear the selection", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all notifications on this page" }));
    expect(screen.getByText("3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all notifications on this page" }));
    expect(screen.getByText("Select all on this page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Mystery" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Mystery" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Mystery" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeDisabled();
  });

  it("delete all asks with the total, then DELETEs /all", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all notifications?" });
    expect(within(dialog).getByText(/removes all 3 of your notifications/)).toBeInTheDocument();
    del.mockResolvedValue(ok({ deleted: 3 }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/notifications/all");
    expect(lastToast()).toMatchObject({ type: "success", title: "3 notifications deleted" });
  });

  it("a failed bulk delete closes the dialog and toasts the reason", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete all notifications?" });
    del.mockRejectedValue(httpError(500, "Could not delete notifications"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(lastToast()).toMatchObject({
      type: "error",
      title: "Failed to delete notifications",
      description: "Could not delete notifications",
    });
  });

  it("a failed selected delete toasts too; Cancel sends nothing", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select notification: Low stock" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete 1 notification?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }));
    dialog = await screen.findByRole("dialog", { name: "Delete 1 notification?" });
    del.mockRejectedValue(httpError(400, "\"ids\" must contain at least 1 items"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(lastToast()).toMatchObject({ type: "error", title: "Failed to delete notifications" });
  });

  it("Send test POSTs a user-scoped test notification; a refusal is toasted", async () => {
    await renderPage();
    post.mockResolvedValue(ok(n("n9")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/notifications/test", { scope: "user" });

    post.mockRejectedValue(httpError(403, "Forbidden"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    });
    expect(lastToast()).toMatchObject({ type: "error", title: "Failed to send test notification" });
  });
});
