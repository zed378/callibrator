/** @jest-environment jsdom */
/**
 * ThemeContext: the saved preference wins (light by default — the OS setting
 * is reported but not applied), the choice is remembered, the `.dark` class
 * on <html> follows it, and the OS setting is tracked live.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../ThemeContext";
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
});

function Probe() {
  const { theme, systemTheme, toggleTheme } = useTheme();
  return (
    <div>
      <p>theme:{theme}</p>
      <p>system:{systemTheme}</p>
      <button type="button" onClick={toggleTheme}>
        Toggle theme
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

describe("ThemeContext", () => {
  it("starts light with no saved preference, even when the OS is dark", async () => {
    osDark = true;
    const { container } = renderProbe();

    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(screen.getByText("system:dark")).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a saved dark preference is applied on load", () => {
    localStorage.setItem("hdc-theme-preference", "dark");
    renderProbe();

    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("an unrecognised saved value falls back to light", () => {
    localStorage.setItem("hdc-theme-preference", "sepia");
    renderProbe();

    expect(screen.getByText("theme:light")).toBeInTheDocument();
  });

  it("toggling switches the theme both ways and saves each choice", () => {
    renderProbe();

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(screen.getByText("theme:dark")).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("hdc-theme-preference")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
    expect(screen.getByText("theme:light")).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    expect(localStorage.getItem("hdc-theme-preference")).toBe("light");
  });

  it("follows the OS setting as it changes, and stops listening on unmount", () => {
    const { unmount } = renderProbe();
    expect(listeners).toHaveLength(1);

    act(() => listeners.forEach((l) => l({ matches: true })));
    expect(screen.getByText("system:dark")).toBeInTheDocument();

    unmount();
    expect(listeners).toHaveLength(0);
  });

  it("useTheme outside the provider is a programming error", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow("useTheme must be used within a ThemeProvider");
    spy.mockRestore();
  });
});
