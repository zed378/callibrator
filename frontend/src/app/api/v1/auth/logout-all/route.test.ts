/**
 * @jest-environment node
 */
// F-61 — logout-all cleared only the three auth cookies; the tenant override
// (x_tenant_id) and the impersonation marker survived it, exactly the F-06
// defect that was fixed in /logout only. It also leaves the F-05 refresh
// cookie behind unless it clears it.

const cookieStore = { get: jest.fn(), delete: jest.fn() };

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { POST } from "./route";

const deleted = () =>
  cookieStore.delete.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : c[0].name));

describe("POST /api/v1/auth/logout-all (F-61)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;
  });

  it("revokes every session at the backend with the caller's token", async () => {
    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { value: "jwt" } : name === "auth_session" ? { value: "s1" } : undefined,
    );

    const res = await POST();

    expect(res.status).toBe(200);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/auth\/logout-all$/);
    expect(init.headers.Authorization).toBe("Bearer jwt");
    expect(init.headers["X-Session"]).toBe("s1");
  });

  it("F-61: clears the tenant override, the impersonation marker and the refresh cookie too", async () => {
    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { value: "jwt" } : undefined,
    );

    await POST();

    expect(deleted()).toEqual(
      expect.arrayContaining([
        "auth_token",
        "auth_session",
        "auth_refresh",
        "auth_logged_in",
        "x_tenant_id",
        "impersonating",
      ]),
    );
  });

  it("clears every cookie even when the backend is down, and without a token calls nothing", async () => {
    cookieStore.get.mockReturnValue(undefined);

    await POST();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(deleted()).toContain("x_tenant_id");

    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { value: "jwt" } : undefined,
    );
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await POST();
    expect(deleted().filter((n) => n === "impersonating")).toHaveLength(2);
    spy.mockRestore();
  });
});
