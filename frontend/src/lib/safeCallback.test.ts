// F-60 — the post-sign-in destination is a same-origin path or the fallback.
import { safeCallbackPath } from "./safeCallback";

describe("safeCallbackPath (F-60: no open redirect after sign-in)", () => {
  it("keeps a same-origin path, with its query", () => {
    expect(safeCallbackPath("/dashboard/devices?page=2")).toBe("/dashboard/devices?page=2");
  });

  it.each([
    "https://evil.example/login",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "/dash\nboard",
  ])("refuses %p", (value) => {
    expect(safeCallbackPath(value)).toBe("/dashboard");
  });

  it("falls back when absent, to the given fallback", () => {
    expect(safeCallbackPath(null)).toBe("/dashboard");
    expect(safeCallbackPath(undefined, "/home")).toBe("/home");
    expect(safeCallbackPath("", "/x")).toBe("/x");
  });
});
