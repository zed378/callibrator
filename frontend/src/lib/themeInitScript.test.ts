/** @jest-environment jsdom */
/**
 * The pre-paint theme script (ADR-122, P11-Q4 A), run as the browser runs it.
 *
 * Fail-before (HEAD 4584df3, the script inline in app/layout.tsx): with
 * nothing stored it REMOVED `.dark` whatever the device said, so a visitor on
 * a dark device saw a dark landing, signed in, and got a light dashboard
 * (spec P11-00 D10); and nothing followed a device change on a page without
 * a toggle.
 */
import { THEME_INIT_SCRIPT } from "./themeInitScript";

type Listener = (e: { matches: boolean }) => void;
let listeners: Listener[] = [];

const device = (dark: boolean | null) => {
  listeners = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value:
      dark === null
        ? undefined
        : (query: string) => ({
            matches: query === "(prefers-color-scheme: dark)" ? dark : false,
            media: query,
            addEventListener: (_: string, l: Listener) => listeners.push(l),
            removeEventListener: jest.fn(),
          }),
  });
};

const run = () => new Function(THEME_INIT_SCRIPT)();
const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().className = "";
  root().removeAttribute("data-theme-choice");
});

describe("THEME_INIT_SCRIPT", () => {
  it.each([
    [null, false, false],
    [null, true, true],
    ["light", true, false],
    ["dark", false, true],
    ["sepia", true, true],
  ] as const)("stored %p on a %s-dark device → .dark is %s", (stored, deviceDark, dark) => {
    device(deviceDark);
    if (stored) localStorage.setItem("hdc-theme-preference", stored);
    root().classList.toggle("dark", !dark); // the opposite, to prove it is set
    run();
    expect(root().classList.contains("dark")).toBe(dark);
    const marked = stored === "light" || stored === "dark" ? stored : null;
    expect(root().getAttribute("data-theme-choice")).toBe(marked);
  });

  it("follows a device change only while nothing is chosen", () => {
    device(false);
    run();
    listeners.forEach((l) => l({ matches: true }));
    expect(root()).toHaveClass("dark");

    root().setAttribute("data-theme-choice", "dark");
    listeners.forEach((l) => l({ matches: false }));
    expect(root()).toHaveClass("dark");
  });

  it("survives blocked storage and a browser without matchMedia", () => {
    device(true);
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    run();
    expect(root()).toHaveClass("dark");
    spy.mockRestore();

    device(null);
    root().className = "dark";
    expect(run).not.toThrow();
    expect(root()).not.toHaveClass("dark");
  });
});
