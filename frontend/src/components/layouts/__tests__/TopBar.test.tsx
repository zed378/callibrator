/** @jest-environment jsdom */
/**
 * The dashboard top bar: the page heading, the mobile navigation toggle, the
 * theme switch and the signed-in user's avatar. Search and notifications have
 * their own tests (GlobalSearch.*, NotificationBell) and are stubbed here.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("../GlobalSearch", () => () => null);
jest.mock("../NotificationBell", () => () => null);

import TopBar from "../TopBar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
});

const renderAt = (pathname: string, onToggleSidebar = jest.fn()) =>
  render(
    <ThemeProvider>
      <TopBar pathname={pathname} onToggleSidebar={onToggleSidebar} />
    </ThemeProvider>,
  );

beforeEach(() => {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u1", username: "ada", email: "a@x.test" } as User,
  });
});

describe("TopBar", () => {
  it("heads a dashboard page 'Dashboard' and shows the user's avatar", async () => {
    const { container } = renderAt("/dashboard/devices");

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "ada" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each(["/dashboard/profile", "/dashboard/account"])("heads %s 'Account'", (path) => {
    renderAt(path);

    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
  });

  it("the navigation button asks the layout to open the sidebar", () => {
    const toggle = jest.fn();
    renderAt("/dashboard", toggle);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));

    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("the theme switch toggles dark mode and remembers it", () => {
    localStorage.removeItem("hdc-theme-preference");
    renderAt("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("hdc-theme-preference")).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });

  it("with no user the avatar is labelled generically", () => {
    useAuthStore.setState({ user: null });
    renderAt("/dashboard");

    expect(screen.getByRole("img", { name: "User" })).toBeInTheDocument();
  });
});
