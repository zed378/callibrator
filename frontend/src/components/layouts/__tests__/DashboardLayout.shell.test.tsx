/** @jest-environment jsdom */
/**
 * The dashboard shell a signed-in user actually sees: the sidebar built from
 * the PERSONALISED menu (POST /api/v1/menu-groups/get-assignments, rows in
 * `data` — menuGroup.controller.js getRoleMenuAssignments), the impersonation
 * banner, and sign-out.
 *
 * RBAC: the backend returns only the groups assigned to the caller's role, so
 * a group the role is not given must be ABSENT from the DOM — not rendered and
 * hidden.
 *
 * Real: DashboardLayout, Sidebar, ImpersonationBanner, the auth and menu
 * stores, the menu and auth services. Mocked: `@/api/client`'s transport,
 * next/navigation, and the top bar (its own test covers it).
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockPathname = "/dashboard";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  usePathname: () => mockPathname,
}));
jest.mock("../TopBar", () =>
  function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
    return (
      <button type="button" onClick={onToggleSidebar}>
        Open navigation
      </button>
    );
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import DashboardLayout from "../DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import type { User } from "@/types";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedPost = api.post as jest.Mock;

const envelope = (data: unknown) => ({
  success: true,
  status: 200,
  message: "Role menu assignments fetched successfully",
  data,
  meta: null,
});

/** What the backend assigns: a technician gets Devices only; an admin also gets Users. */
const MENUS: Record<string, unknown[]> = {
  "role-tech": [
    { label: "Dashboard", icon: "LayoutGrid", path: "/dashboard", items: [] },
    {
      label: "Devices",
      icon: "Cpu",
      path: "",
      items: [
        { label: "Device List", icon: "Monitor", path: "/dashboard/devices" },
        {
          label: "Calibration",
          icon: "Gauge",
          path: "",
          items: [
            { label: "Schedules", icon: "CalendarClock", path: "/dashboard/calibration-scheduler" },
            { label: "Records", icon: "ClipboardList", path: "/dashboard/calibration" },
          ],
        },
      ],
    },
  ],
  "role-admin": [
    { label: "Dashboard", icon: "LayoutGrid", path: "/dashboard", items: [] },
    {
      label: "Administration",
      icon: "Shield",
      path: "",
      items: [{ label: "Users", icon: "Users", path: "/dashboard/users" }],
    },
  ],
};

const backend = () => {
  mockedPost.mockImplementation(async (url: string, body: { roleId?: string }) => {
    if (url === "/api/v1/menu-groups/get-assignments") return envelope(MENUS[body.roleId ?? ""] ?? []);
    if (url === "/api/v1/auth/logout") return envelope(null);
    if (url === "/api/v1/auth/impersonate/exit") return envelope(null);
    throw new Error(`unexpected POST ${url}`);
  });
};

const signIn = (patch: Partial<User> = {}, isImpersonating = false) =>
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    isImpersonating,
    user: {
      id: "u1",
      username: "ada",
      email: "ada@rs.test",
      roleId: "role-tech",
      firstName: "Ada",
      lastName: "Lovelace",
      ...patch,
    } as User,
  });

const renderShell = async (path = "/dashboard") => {
  mockPathname = path;
  const view = render(
    <DashboardLayout>
      <p>page body</p>
    </DashboardLayout>,
  );
  await waitFor(() => expect(useMenuStore.getState().isMenuLoaded).toBe(true));
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  useMenuStore.getState().clearMenu();
  backend();
});

describe("DashboardLayout shell — the personalised sidebar", () => {
  it("renders only the groups the role is assigned; the others are absent from the DOM", async () => {
    signIn({ roleId: "role-tech" });
    const { container } = await renderShell();

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/get-assignments", { roleId: "role-tech" });
    expect(await screen.findByRole("button", { name: /Devices/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Users/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an admin's menu carries the admin group the technician does not get", async () => {
    signIn({ roleId: "role-admin" });
    await renderShell();

    fireEvent.click(await screen.findByRole("button", { name: /Administration/ }));
    expect(screen.getByRole("link", { name: /Users/ })).toHaveAttribute("href", "/dashboard/users");
    expect(screen.queryByText("Devices")).not.toBeInTheDocument();
  });

  it("a group opens on click, and its sub-group opens in turn", async () => {
    signIn();
    await renderShell();

    expect(screen.queryByRole("link", { name: /Device List/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Devices/ }));
    expect(screen.getByRole("link", { name: /Device List/ })).toHaveAttribute("href", "/dashboard/devices");

    expect(screen.queryByRole("link", { name: /Schedules/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Calibration/ }));
    expect(screen.getByRole("link", { name: /Schedules/ })).toHaveAttribute(
      "href",
      "/dashboard/calibration-scheduler",
    );

    // …and closes again.
    fireEvent.click(screen.getByRole("button", { name: /Devices/ }));
    expect(screen.queryByRole("link", { name: /Device List/ })).not.toBeInTheDocument();
  });

  it("the group holding the current page is open on arrival", async () => {
    signIn();
    await renderShell("/dashboard/devices/abc");

    expect(await screen.findByRole("link", { name: /Device List/ })).toBeInTheDocument();
  });

  it("a menu that fails to load is an error with a retry, and no navigation is offered", async () => {
    signIn();
    mockedPost.mockRejectedValueOnce(httpError(500, "Menu service unavailable"));
    mockPathname = "/dashboard";
    render(
      <DashboardLayout>
        <p>page body</p>
      </DashboardLayout>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Menu service unavailable");
    expect(screen.queryByRole("button", { name: /Devices/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: /Devices/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows who is signed in, and signing out ends the session and goes to the login page", async () => {
    signIn();
    await renderShell();

    const nav = screen.getByRole("complementary");
    expect(within(nav).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(nav).getByText("ada@rs.test")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/logout", { sessionId: undefined });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it("falls back to the username when the name is incomplete", async () => {
    signIn({ firstName: "Ada", lastName: undefined, email: undefined });
    await renderShell();

    expect(within(screen.getByRole("complementary")).getByText("ada")).toBeInTheDocument();
  });

  it("on a narrow screen the sidebar opens from the top bar and closes from its own button", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      signIn();
      await renderShell();
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      const aside = screen.getByRole("complementary");
      expect(aside.className).toContain("-translate-x-full");
      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
      expect(aside.className).toContain("translate-x-0");

      fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
      expect(aside.className).toContain("-translate-x-full");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});

describe("DashboardLayout shell — impersonation", () => {
  it("no banner when not impersonating", async () => {
    signIn();
    await renderShell();

    expect(screen.queryByText(/Impersonating/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Exit impersonation/ })).not.toBeInTheDocument();
  });

  it("the banner names the impersonated user, and exiting ends that session and goes to sign-in", async () => {
    signIn({ username: "nurse.jo" }, true);
    const { container } = await renderShell();

    expect(screen.getByText(/Impersonating/)).toHaveTextContent("Impersonating nurse.jo");
    expect(await axeViolations(container)).toEqual([]);

    let release: (v: unknown) => void = () => undefined;
    mockedPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Exit impersonation/ }));

    // While the request is in flight the button cannot be pressed twice.
    const busy = await screen.findByRole("button", { name: /Exiting/ });
    expect(busy).toBeDisabled();

    await act(async () => {
      release(envelope(null));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/impersonate/exit", {});
    expect(useAuthStore.getState()).toMatchObject({ isImpersonating: false, isAuthenticated: false, user: null });
  });

  it("exiting still leaves the impersonated session when the backend call fails", async () => {
    signIn({ username: "nurse.jo" }, true);
    await renderShell();

    mockedPost.mockRejectedValueOnce(httpError(500, "boom"));
    fireEvent.click(screen.getByRole("button", { name: /Exit impersonation/ }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/login"));
    expect(useAuthStore.getState()).toMatchObject({ isImpersonating: false, user: null });
  });

  it("names the user by email when there is no username", async () => {
    signIn({ username: undefined as unknown as string, email: "jo@rs.test" }, true);
    await renderShell();

    expect(screen.getByText(/Impersonating/)).toHaveTextContent("Impersonating jo@rs.test");
  });
});
