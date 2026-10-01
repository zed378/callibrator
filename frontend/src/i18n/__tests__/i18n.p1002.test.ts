/**
 * P10-02 (ADR-098 §4, doc 20 §5) — the public language mechanism.
 *
 *  - no cookie (or an unknown value) → Indonesian; no Accept-Language sniffing;
 *  - the `setLocale` Server Action writes the `locale` cookie HttpOnly,
 *    SameSite=Lax, Path=/, one year, Secure only in production, and never
 *    stores an unknown value;
 *  - `<html lang>` follows the cookie on public pages and stays "en" on the
 *    English-only dashboard;
 *  - both dictionaries carry exactly the same keys (also a compile error), no
 *    empty string, and every `{placeholder}` of a key appears in both;
 *  - `format` fills placeholders and leaves an unknown one visible.
 */
const mockSet = jest.fn();
let mockCookieValue: string | undefined;
jest.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "locale" && mockCookieValue !== undefined ? { value: mockCookieValue } : undefined),
    set: (...args: unknown[]) => mockSet(...args),
  }),
}));

import { DEFAULT_LOCALE, htmlLangFor, LOCALE_COOKIE, resolveLocale } from "../config";
import { getLocale, getServerI18n } from "../server";
import { setLocale } from "../actions";
import { format, pickMessages } from "../index";
import { id } from "../messages/id";
import { en } from "../messages/en";

const form = (locale: string) => {
  const fd = new FormData();
  fd.set("locale", locale);
  return fd;
};

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

beforeEach(() => {
  mockSet.mockReset();
  mockCookieValue = undefined;
});

describe("P10-02: locale resolution", () => {
  it("defaults to Indonesian with no cookie", async () => {
    expect(DEFAULT_LOCALE).toBe("id");
    await expect(getLocale()).resolves.toBe("id");
    const { t } = await getServerI18n();
    expect(t("auth.login.submit")).toBe("Masuk");
  });

  it("follows the cookie, and ignores an unknown value", async () => {
    mockCookieValue = "en";
    await expect(getLocale()).resolves.toBe("en");
    mockCookieValue = "fr";
    await expect(getLocale()).resolves.toBe("id");
    expect(resolveLocale(null)).toBe("id");
  });

  it("<html lang> follows the locale on public pages and is English on the dashboard", () => {
    expect(htmlLangFor("/", "id")).toBe("id");
    expect(htmlLangFor("/login", "en")).toBe("en");
    expect(htmlLangFor("/verify/CERT-1", "id")).toBe("id");
    expect(htmlLangFor("/dashboard", "id")).toBe("en");
    expect(htmlLangFor("/dashboard/devices", "id")).toBe("en");
    expect(htmlLangFor("/dashboardx", "id")).toBe("id");
  });
});

describe("P10-02: the setLocale Server Action", () => {
  const env = process.env as Record<string, string | undefined>;
  const nodeEnv = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = nodeEnv;
  });

  it("sets the cookie HttpOnly, SameSite=Lax, Path=/, one year", async () => {
    await setLocale(form("en"));
    expect(mockSet).toHaveBeenCalledWith(LOCALE_COOKIE, "en", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 31536000,
    });
  });

  it("is Secure in production", async () => {
    env.NODE_ENV = "production";
    await setLocale(form("id"));
    expect(mockSet.mock.calls[0][2]).toMatchObject({ secure: true });
  });

  it("never stores an unknown value", async () => {
    await setLocale(form("<script>"));
    expect(mockSet).toHaveBeenCalledWith(LOCALE_COOKIE, "id", expect.any(Object));
  });
});

describe("P10-02: the dictionaries", () => {
  it("carry the same keys, none empty, with the same placeholders", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(id).sort());
    for (const key of Object.keys(id) as Array<keyof typeof id>) {
      expect(id[key].trim()).not.toBe("");
      expect(en[key].trim()).not.toBe("");
      expect([key, placeholders(en[key])]).toEqual([key, placeholders(id[key])]);
    }
  });

  it("format fills placeholders and leaves an unknown one visible", () => {
    expect(format("Coba lagi dalam {minutes} menit.", { minutes: 3 })).toBe("Coba lagi dalam 3 menit.");
    expect(format("Hi {name}", {})).toBe("Hi {name}");
  });

  it("pickMessages hands a client only the namespaces it asks for", () => {
    const picked = pickMessages(id, ["access."]);
    expect(Object.keys(picked).length).toBeGreaterThan(10);
    expect(Object.keys(picked).every((k) => k.startsWith("access."))).toBe(true);
  });
});
