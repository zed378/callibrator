// A-60 — the SSO callback page hands the store a one-time code, not a token.
// The store posts it to the sso-session server route and must stop on a
// refusal: the old version ignored the route's answer and went on to fetch
// the user with whatever auth cookie the browser already held.

import { useAuthStore } from "../authStore";
import { authService } from "@/api/services/auth.service";

jest.mock("@/api/services/auth.service", () => ({
  authService: {
    verifyAndFetchUser: jest.fn(),
  },
}));

const verifyAndFetchUser = authService.verifyAndFetchUser as jest.Mock;

const routeAnswers = (status: number, body: unknown) =>
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

describe("authStore.loginWithSSOCode (A-60)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as jest.Mock;
    useAuthStore.setState({ user: null, isAuthenticated: false, error: null });
  });

  it("posts only the code to the sso-session route, then loads the user", async () => {
    routeAnswers(200, { success: true });
    verifyAndFetchUser.mockResolvedValueOnce({
      id: "u1",
      first_name: "Ada",
      tenantId: "t1",
    });

    await useAuthStore.getState().loginWithSSOCode("the-code");

    expect(global.fetch).toHaveBeenCalledWith("/api/v1/auth/sso-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "the-code" }),
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.firstName).toBe("Ada");
  });

  it("throws the route's message and never fetches the user when the code is refused", async () => {
    routeAnswers(401, { success: false, message: "Invalid or expired SSO code" });

    await expect(useAuthStore.getState().loginWithSSOCode("used")).rejects.toThrow(
      "Invalid or expired SSO code",
    );
    expect(verifyAndFetchUser).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().error).toBe("Invalid or expired SSO code");
  });

  it("falls back to a generic message when the refusal has no body", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("no body");
      },
    });

    await expect(useAuthStore.getState().loginWithSSOCode("x")).rejects.toThrow(
      "SSO Login failed",
    );
    expect(verifyAndFetchUser).not.toHaveBeenCalled();
  });
});
