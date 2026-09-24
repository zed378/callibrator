/**
 * A-141 — the MFA client calls the backend contract of auth.route.js:
 *  - POST /auth/mfa/verify answers `data.recoveryCodes` (shown once);
 *  - POST /auth/mfa/disable takes `currentPassword` + `code` or `recoveryCode`;
 *  - POST /auth/mfa/login takes `recoveryCode` in place of `code`.
 *
 * Fail-before: mfaVerify resolved to nothing (the codes were dropped),
 * mfaDisable did not exist, and mfaLogin could only send `code`.
 */
import { authService } from "./auth.service";
import { api } from "../client";

jest.mock("../client", () => ({
  api: { post: jest.fn(), get: jest.fn() },
}));

const post = api.post as jest.Mock;

beforeEach(() => {
  post.mockReset();
});

describe("A-141: MFA client", () => {
  it("mfaVerify returns the recovery codes from data.recoveryCodes", async () => {
    post.mockResolvedValue({
      success: true,
      data: { recoveryCodes: ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"] },
    });

    const result = await authService.mfaVerify("123456");

    expect(post).toHaveBeenCalledWith("/api/v1/auth/mfa/verify", { code: "123456" });
    expect(result).toEqual({ recoveryCodes: ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"] });
  });

  it("mfaVerify tolerates a response without codes (an older backend)", async () => {
    post.mockResolvedValue({ success: true, data: null });
    await expect(authService.mfaVerify("123456")).resolves.toEqual({ recoveryCodes: [] });
  });

  it("mfaDisable posts the re-authentication as given", async () => {
    post.mockResolvedValue({ success: true });

    await authService.mfaDisable({ currentPassword: "pw", recoveryCode: "AAAA-BBBB-CCCC-DDDD" });

    expect(post).toHaveBeenCalledWith("/api/v1/auth/mfa/disable", {
      currentPassword: "pw",
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
  });

  it("mfaLogin sends `code` by default and `recoveryCode` when asked", async () => {
    post.mockResolvedValue({ success: true });

    await authService.mfaLogin("tmp", "123456");
    await authService.mfaLogin("tmp", "AAAA-BBBB-CCCC-DDDD", true);

    expect(post).toHaveBeenNthCalledWith(1, "/api/v1/auth/mfa/login", {
      token: "tmp",
      code: "123456",
    });
    expect(post).toHaveBeenNthCalledWith(2, "/api/v1/auth/mfa/login", {
      token: "tmp",
      recoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
  });
});
