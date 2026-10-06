/** @jest-environment jsdom */
/**
 * ThemeContext — the dashboard's view of the one theme mechanism (lib/theme.ts,
 * ADR-122 §5, spec P11-00 §6).
 *
 * Fail-before (HEAD 4584df3, the old ThemeContext):
 *   - D10: with nothing stored it started LIGHT even on a dark device
 *     ("starts light with no saved preference, even when the OS is dark" was
 *     this file's first case; P11-Q4 A reverses it);
 *   - D9: toggling wrote storage and `.dark` but never `data-theme-choice`, so
 *     the public CSS kept following the device until a reload;
 *   - a choice made on a public island, in another tab, or "use device
 *     setting" did not exist for it at all.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeContext";
import { applyTheme } from "@/lib/theme";
import { axeViolations } from "@/tests/a11y/axe";

type Listener = (e: { matches: boolean }) => void;
let osDark = false;
let listeners: Listener[] = [];

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return osDark;
      },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.push(l),
      removeEventListener: (_: string, l: Listener) => {
        listeners = listeners.filter((x) => x !== l);
      },
    }),
  });
});

beforeEach(() => {
  osDark = false;
  listeners = [];
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme-choice");
});

const root = () => document.documentElement;

function Probe() {
  const { theme, systemTheme, choice, toggleTheme, followDevice } = useTheme();
  return (
    <div>
      <p>theme:{theme}</p>
      <p>system:{systemTheme}</p>
      <p>choice:{choice ?? "none"}</p>
      <button type="button" onClick={toggleTheme}>
        Toggle theme
      </button>
      <button type="button" onClick={followDevice}>
        Use device setting
      </button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

const deviceChanges = (dark: boolean) =>
  act(() => {
    osDark = dark;
    listeners.forEach((l) => l({ matches: dark }));
  });

describe("ThemeContext (ADR-122)", () => {
  it("D10: with no choice it follows a dark device, and stores nothing", async () => {
    osDark = true;
    const { container } = renderProbe();

    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("choice:none")).toBeInTheDocument();
    expect(root()).toHaveClass("dark");
    expect(root()).not.toHaveAttribute("data-theme-choice");
    expect(localStorage.getItem("hdc-theme-preference")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("with no choice it follows a light device", () => {
    renderProbe();
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(root()).not.toHaveClass("dark");
  });

  it("a saved choice wins over the device, both ways", () => {
    localStorage.setItem("hdc-theme-preference", "dark");
    const { unmount } = renderProbe();
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("choice:dark")).toBeInTheDocument();
    expect(root()).toHaveAttribute("data-theme-choice", "dark");
    unmount();

    osDark = true;
    localStorage.setItem("hdc-theme-preference", "light");
    renderProbe();
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(root()).not.toHaveClass("dark");
  });

  it("an unrecognised saved value is no choice: the device decides", () => {
    osDark = true;
    localStorage.setItem("hdc-theme-preference", "sepia");
    renderProbe();
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("choice:none")).toBeInTheDocument();
  });

  it("D9: toggling marks data-theme-choice as well as .dark and storage, both ways", () => {
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(root()).toHaveClass("dark");
    expect(root()).toHaveAttribute("data-theme-choice", "dark");
    expect(localStorage.getItem("hdc-theme-preference")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(root()).not.toHaveClass("dark");
    expect(root()).toHaveAttribute("data-theme-choice", "light");
    expect(localStorage.getItem("hdc-theme-preference")).toBe("light");
  });

  it("carry-over: a choice made by the public toggle's applyTheme is the dashboard's at once", () => {
    renderProbe();
    act(() => applyTheme(true));
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("choice:dark")).toBeInTheDocument();
  });

  it("carry-over: another tab's choice (a storage event) is applied here", () => {
    renderProbe();
    act(() => {
      localStorage.setItem("hdc-theme-preference", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "hdc-theme-preference", newValue: "dark" }));
    });
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(root()).toHaveAttribute("data-theme-choice", "dark");
    // An unrelated key changes nothing.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x" }));
    });
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
  });

  it('"Use device setting" forgets the choice and follows the device again', () => {
    osDark = true;
    localStorage.setItem("hdc-theme-preference", "light");
    renderProbe();
    expect(screen.getByText("theme:light")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use device setting" }));
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("choice:none")).toBeInTheDocument();
    expect(localStorage.getItem("hdc-theme-preference")).toBeNull();
    expect(root()).not.toHaveAttribute("data-theme-choice");
    expect(root()).toHaveClass("dark");
  });

  it("a device change is followed while nothing is chosen, and ignored once something is", () => {
    renderProbe();
    deviceChanges(true);
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(screen.getByText("system:dark")).toBeInTheDocument();
    expect(root()).toHaveClass("dark");

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" })); // choose light
    deviceChanges(true);
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(root()).not.toHaveClass("dark");
  });

  it("stops listening on unmount", () => {
    const { unmount } = renderProbe();
    expect(listeners.length).toBeGreaterThan(0);
    unmount();
    expect(listeners).toHaveLength(0);
  });

  it("blocked storage still switches the page and clears the choice", () => {
    renderProbe();
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const remove = jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(root()).toHaveClass("dark");
    fireEvent.click(screen.getByRole("button", { name: "Use device setting" }));
    expect(root()).not.toHaveAttribute("data-theme-choice");
    set.mockRestore();
    remove.mockRestore();
    get.mockRestore();
  });

  it("useTheme outside the provider is a programming error", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow("useTheme must be used within a ThemeProvider");
    spy.mockRestore();
  });
});
