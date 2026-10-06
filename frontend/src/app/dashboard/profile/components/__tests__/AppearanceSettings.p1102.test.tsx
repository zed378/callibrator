/** @jest-environment jsdom */
/**
 * P11-02 (ADR-122, P11-Q4 A): "Use device setting" forgets the stored choice
 * on both surfaces and the page follows the device again. Rendered with the
 * real ThemeProvider and lib/theme.ts.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import AppearanceSettings from "../AppearanceSettings";
import { axeViolations } from "@/tests/a11y/axe";

let osDark = true;
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return osDark;
      },
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
});

beforeEach(() => {
  osDark = true;
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme-choice");
});

const renderIt = () =>
  render(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );

describe("AppearanceSettings (P11-02)", () => {
  it("with a choice stored, the button clears it and the device decides", async () => {
    localStorage.setItem("hdc-theme-preference", "light");
    const { container } = renderIt();
    expect(screen.getByText(/Light mode, as you chose/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Use device setting" }));

    expect(localStorage.getItem("hdc-theme-preference")).toBeNull();
    expect(document.documentElement).not.toHaveAttribute("data-theme-choice");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByText(/Dark mode, following this device's setting/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use device setting" })).toBeDisabled();
  });

  it("with nothing stored, there is nothing to clear", () => {
    osDark = false;
    renderIt();
    expect(screen.getByText(/Light mode, following this device's setting/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use device setting" })).toBeDisabled();
  });
});
