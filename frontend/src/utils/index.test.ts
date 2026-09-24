import {
  capitalize,
  debounce,
  formatDate,
  formatDateTime,
  generateId,
  isAuthenticated,
  truncateText,
} from "./index";

describe("utils", () => {
  it("formatDate / formatDateTime accept a string or a Date", () => {
    expect(formatDate("2026-09-24T12:00:00Z")).toBe("September 24, 2026");
    expect(formatDate(new Date("2026-01-02T12:00:00Z"))).toBe("January 2, 2026");
    expect(formatDateTime(new Date(2026, 8, 24, 13, 5))).toMatch(/September 24, 2026.*01:05 PM/);
    expect(formatDateTime("2026-09-24T00:00:00")).toMatch(/September 24, 2026/);
  });

  it("truncateText leaves short text alone and ellipsises long text", () => {
    expect(truncateText("abc", 3)).toBe("abc");
    expect(truncateText("abcdef", 3)).toBe("abc...");
  });

  it("debounce runs once, with the last arguments, after the wait", () => {
    jest.useFakeTimers();
    const fn = jest.fn();
    const d = debounce(fn as (...a: unknown[]) => unknown, 100);
    d("a");
    d("b");
    jest.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
    jest.useRealTimers();
  });

  it("generateId is a non-empty string that differs between calls", () => {
    const a = generateId();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(generateId()).not.toBe(a);
  });

  it("capitalize", () => {
    expect(capitalize("")).toBe("");
    expect(capitalize("ward")).toBe("Ward");
  });

  it("isAuthenticated reads only the non-httpOnly marker cookie", () => {
    document.cookie = "auth_logged_in=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    expect(isAuthenticated()).toBe(false);
    document.cookie = "auth_logged_in=true;path=/";
    expect(isAuthenticated()).toBe(true);
    document.cookie = "auth_logged_in=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
  });
});
