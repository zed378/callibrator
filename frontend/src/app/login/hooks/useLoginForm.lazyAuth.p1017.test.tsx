/** @jest-environment jsdom */
/**
 * P10-17 perf addendum — the sign-in page's API layer loads on demand.
 *
 * axios, the auth service and the auth store (./authRuntime) were ~32 KB gzip
 * of /login's first-load JavaScript. The hook now imports them with import():
 *  - not while the page renders;
 *  - at the visitor's first key press, tap or click (prefetch), once;
 *  - and in any case before a step talks to the API (a submit with no
 *    prefetch still works).
 *
 * Fail-before: the hook imported them statically, so the module factory below
 * ran as soon as the hook was imported.
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

// Counted outside jest.fn so beforeEach's clearAllMocks cannot hide a load
// that happened when the hook module was imported.
let mockRuntimeLoads = 0;
const mockDiscoverLogin = jest.fn(async () => ({ next: "password" }));
jest.mock("./authRuntime", () => {
  mockRuntimeLoads += 1;
  return {
    authService: { discoverLogin: mockDiscoverLogin },
    useAuthStore: { getState: () => ({ user: null }) },
    describeApiError: () => ({ status: null, message: null }),
    destinationAfterSignIn: (url: string) => url,
  };
});

import { useLoginForm } from "./useLoginForm";

const submitEvent = { preventDefault: () => undefined } as unknown as React.FormEvent;
const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("P10-17: the API layer is not part of the sign-in page's first load", () => {
  it("is not loaded by rendering the hook", async () => {
    renderHook(() => useLoginForm());
    await flush();
    expect(mockRuntimeLoads).toBe(0);
  });

  it("is not loaded by input outside the sign-in panel (the theme toggle, the language form)", async () => {
    const { unmount } = renderHook(() => useLoginForm());
    const header = document.body.appendChild(document.createElement("header"));
    const toggle = header.appendChild(document.createElement("button"));

    act(() => {
      toggle.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    });
    await flush();
    expect(mockRuntimeLoads).toBe(0);

    unmount();
    header.remove();
  });

  it("is loaded at the first key press in the panel, and the listener goes after one use", async () => {
    const { unmount } = renderHook(() => useLoginForm());
    const remove = jest.spyOn(document, "removeEventListener");
    const main = document.body.appendChild(document.createElement("main"));
    const field = main.appendChild(document.createElement("input"));

    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    await flush();
    main.remove();
    expect(mockRuntimeLoads).toBe(1);
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("touchstart", expect.any(Function), true);

    unmount();
    remove.mockRestore();
  });

  it("a submit awaits the same import and reaches the API", async () => {
    const { result } = renderHook(() => useLoginForm());
    act(() => result.current.setUsername("user@rs.example"));

    await act(async () => {
      await result.current.handleIdentifierSubmit(submitEvent);
    });

    expect(mockDiscoverLogin).toHaveBeenCalledWith("user@rs.example");
    expect(result.current.step).toBe("password");
  });

  it("removes its listeners when the page goes", async () => {
    const remove = jest.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useLoginForm());
    unmount();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    remove.mockRestore();
  });
});
