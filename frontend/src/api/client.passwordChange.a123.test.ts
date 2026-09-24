/**
 * A-123 (ADR-051 Q-11) — the API client sends an account that must change an
 * administrator-set password to the change-password screen.
 *
 * The backend answers every route but change-password, logout and "who am I"
 * with 403 and `code: "PASSWORD_CHANGE_REQUIRED"`. Fail-before: the client
 * had no such rule (passwordChangeRedirect did not exist), so the user saw a
 * dead dashboard of "Forbidden" toasts.
 */
import {
  CHANGE_PASSWORD_PATH,
  PASSWORD_CHANGE_REQUIRED,
  passwordChangeRedirect,
} from "./client";

describe("A-123: passwordChangeRedirect", () => {
  it("the codes match the backend's (auth.middleware.js PASSWORD_CHANGE_REQUIRED_CODE)", () => {
    expect(PASSWORD_CHANGE_REQUIRED).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(CHANGE_PASSWORD_PATH).toBe("/dashboard/change-password");
  });

  it("a 403 with the code, anywhere else, goes to the change-password screen", () => {
    expect(passwordChangeRedirect(403, PASSWORD_CHANGE_REQUIRED, "/dashboard")).toBe(
      CHANGE_PASSWORD_PATH,
    );
    expect(passwordChangeRedirect(403, PASSWORD_CHANGE_REQUIRED, "/dashboard/devices")).toBe(
      CHANGE_PASSWORD_PATH,
    );
  });

  it("not again when already there (no reload loop from the page's own requests)", () => {
    expect(passwordChangeRedirect(403, PASSWORD_CHANGE_REQUIRED, CHANGE_PASSWORD_PATH)).toBeNull();
  });

  it("an ordinary 403 (a real permission refusal) is not a redirect", () => {
    expect(passwordChangeRedirect(403, undefined, "/dashboard")).toBeNull();
    expect(passwordChangeRedirect(403, "SOMETHING_ELSE", "/dashboard")).toBeNull();
  });

  it("the code on another status is not a redirect", () => {
    expect(passwordChangeRedirect(401, PASSWORD_CHANGE_REQUIRED, "/dashboard")).toBeNull();
    expect(passwordChangeRedirect(undefined, PASSWORD_CHANGE_REQUIRED, "/dashboard")).toBeNull();
  });
});
