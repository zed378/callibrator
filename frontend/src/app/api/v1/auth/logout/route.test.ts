/**
 * @jest-environment node
 */
// F-06 — the server-side logout must clear the tenant override too. The client
// store deletes it, but this route is the one place every sign-out passes
// through with authority over the whole cookie jar.

const cookieStore = {
  get: jest.fn(),
  delete: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

import { POST } from "./route";

describe("POST /api/v1/auth/logout (F-06)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.get.mockReturnValue(undefined);
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock;
  });

  it("F-06: deletes x_tenant_id and impersonating along with the auth cookies", async () => {
    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { value: "jwt" } : undefined,
    );

    const res = await POST();

    expect(res.status).toBe(200);
    const deleted = cookieStore.delete.mock.calls.map((c) => c[0]);
    expect(deleted).toEqual(
      expect.arrayContaining([
        "auth_token",
        "auth_session",
        "auth_logged_in",
        "x_tenant_id",
        "impersonating",
      ]),
    );
  });

  it("F-06: still clears every cookie when the backend call fails", async () => {
    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { value: "jwt" } : undefined,
    );
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await POST();

    const deleted = cookieStore.delete.mock.calls.map((c) => c[0]);
    expect(deleted).toEqual(
      expect.arrayContaining(["x_tenant_id", "impersonating"]),
    );
    errorSpy.mockRestore();
  });
});
