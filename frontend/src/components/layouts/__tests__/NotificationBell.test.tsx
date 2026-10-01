/**
 * The TopBar bell: the live unread badge (useLiveNotifications, stubbed — it
 * has its own socket tests) and the preview drawer, loaded through the REAL
 * notification service from `@/api/client` mocked with the backend's list
 * envelope (rows in `data`, `meta` top-level with `unread`).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockLive = { unreadCount: 0, latest: null as unknown };
jest.mock("@/hooks/useLiveNotifications", () => ({
  __esModule: true,
  default: () => mockLive,
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock("@/api/client", () => ({ api: { get: jest.fn() } }));

import { api } from "@/api/client";
import type { Notification } from "@/api/services/notification.service";
import { axeViolations } from "@/tests/a11y/axe";
import { networkError } from "@/tests/support/httpErrors";
import NotificationBell from "../NotificationBell";

const get = api.get as jest.Mock;

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

const envelope = (rows: Notification[], unread = rows.filter((r) => !r.isRead).length) => ({
  success: true,
  status: 200,
  message: "Notifications retrieved",
  data: rows,
  meta: { total: rows.length, unread, page: 1, limit: 6, totalPages: 1 },
});

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  mockLive.unreadCount = 0;
  mockLive.latest = null;
  get.mockResolvedValue(envelope([n("1", { title: "Cert due" }), n("2", { isRead: true, type: "MAINTENANCE" })]));
});

describe("NotificationBell", () => {
  it("with nothing unread: a plain, collapsed bell and no request", async () => {
    const { container } = render(<NotificationBell />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(get).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the badge and name carry the unread count, capped at 99+", () => {
    mockLive.unreadCount = 3;
    const { rerender } = render(<NotificationBell />);
    expect(screen.getByRole("button", { name: "Notifications (3 unread)" })).toHaveTextContent("3");
    mockLive.unreadCount = 150;
    rerender(<NotificationBell />);
    expect(screen.getByRole("button", { name: "Notifications (150 unread)" })).toHaveTextContent("99+");
  });

  it("opening loads the latest six and previews them", async () => {
    mockLive.unreadCount = 1;
    render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    });
    expect(get).toHaveBeenCalledWith("/api/v1/notifications", { params: { page: 1, limit: 6 } });
    expect(await screen.findByText("Cert due")).toBeInTheDocument();
    expect(screen.getByText("Message 2")).toBeInTheDocument();
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Notifications/ })).toHaveAttribute("aria-expanded", "true");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("an empty inbox says so", async () => {
    get.mockResolvedValue(envelope([]));
    render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
  });

  it("a failed load says it failed — not 'No notifications yet'", async () => {
    get.mockRejectedValue(networkError());
    render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load notifications.");
    expect(screen.queryByText("No notifications yet")).not.toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("a preview row and 'View all' go to the notifications page and close the drawer", async () => {
    render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    fireEvent.click(await screen.findByRole("button", { name: /Cert due/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/notifications");
    expect(screen.queryByText("Cert due")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    fireEvent.click(await screen.findByRole("button", { name: "View all notifications" }));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it("Escape, an outside click, and the bell itself close it; a click inside does not", async () => {
    render(
      <div>
        <p>outside</p>
        <NotificationBell />
      </div>,
    );
    const bell = screen.getByRole("button", { name: "Notifications" });
    await act(async () => {
      fireEvent.click(bell);
    });
    const panelText = await screen.findByText("Cert due");
    fireEvent.mouseDown(panelText);
    expect(screen.getByText("Cert due")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("Cert due")).not.toBeInTheDocument());

    await act(async () => {
      fireEvent.click(bell);
    });
    await screen.findByText("Cert due");
    fireEvent.mouseDown(screen.getByText("outside"));
    await waitFor(() => expect(screen.queryByText("Cert due")).not.toBeInTheDocument());

    await act(async () => {
      fireEvent.click(bell);
    });
    await screen.findByText("Cert due");
    fireEvent.click(bell);
    expect(screen.queryByText("Cert due")).not.toBeInTheDocument();
  });

  it("a live notification while open refreshes the preview", async () => {
    const { rerender } = render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    await screen.findByText("Cert due");
    get.mockResolvedValue(envelope([n("3", { title: "Brand new" })]));
    mockLive.latest = n("3");
    await act(async () => {
      rerender(<NotificationBell />);
    });
    expect(await screen.findByText("Brand new")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps the panel anchored on resize and scroll", async () => {
    render(<NotificationBell />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    });
    await screen.findByText("Cert due");
    const panel = screen.getByText("View all notifications").closest("div.fixed") as HTMLElement;
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    await act(async () => {
      fireEvent(window, new Event("resize"));
    });
    // jsdom has no layout: the bell's rect is 0, so right = max(8, 1000 - 0).
    expect(panel.style.right).toBe("1000px");
    expect(panel.style.top).toBe("8px");
  });
});
