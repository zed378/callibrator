/** @jest-environment jsdom */
/**
 * P10-17 (ADR-118 Amendment 3) — the public light/dark switch shares the app's
 * one theme mechanism: localStorage `hdc-theme-preference` and `.dark` on
 * <html> (what the root layout's init script and the dashboard's ThemeContext
 * read), plus `data-theme-choice` so the public pages follow the system only
 * while the visitor has not chosen.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PublicThemeToggle, THEME_STORAGE_KEY, applyTheme, effectiveDark } from "../PublicThemeToggle";

const setSystemDark = (dark: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" ? dark : false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
};

beforeEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-choice");
  window.localStorage.clear();
  setSystemDark(false);
});

describe("PublicThemeToggle", () => {
  it("follows the system until the visitor chooses", () => {
    setSystemDark(true);
    expect(effectiveDark()).toBe(true);
    document.documentElement.setAttribute("data-theme-choice", "light");
    expect(effectiveDark()).toBe(false);
  });

  it("a click switches, stores the shared key, and marks the choice; the button reports its state", () => {
    render(<PublicThemeToggle label="Mode gelap" />);
    const button = screen.getByRole("button", { name: "Mode gelap" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme-choice")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(button).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("another toggle on the page (header and mobile menu) stays in step", () => {
    render(
      <>
        <PublicThemeToggle label="A" />
        <PublicThemeToggle label="B" />
      </>,
    );
    act(() => applyTheme(true));
    expect(screen.getByRole("button", { name: "A" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "B" })).toHaveAttribute("aria-pressed", "true");
  });

  it("blocked storage still switches the page", () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => applyTheme(true));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    spy.mockRestore();
  });
});
