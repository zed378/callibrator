/**
 * A-160 — the API client sends an account its tenant requires to enrol MFA to
 * the MFA page.
 *
 * The backend answers every route but the enrolment ones, change-password,
 * logout and "who am I" with 403 and `code: "MFA_ENROLMENT_REQUIRED"`.
 * Fail-before (baseline 2a157f1): mfaEnrolmentRedirect did not exist.
 */
import {
  CHANGE_PASSWORD_PATH,
  MFA_ENROLMENT_REQUIRED,
  MFA_PATH,
  PASSWORD_CHANGE_REQUIRED,
  mfaEnrolmentRedirect,
  passwordChangeRedirect,
} from "./client";

describe("A-160: mfaEnrolmentRedirect", () => {
  it("the code and path match the backend's (auth.middleware.js MFA_ENROLMENT_REQUIRED_CODE) and the MFA page", () => {
    expect(MFA_ENROLMENT_REQUIRED).toBe("MFA_ENROLMENT_REQUIRED");
    expect(MFA_PATH).toBe("/dashboard/mfa");
  });

  it("a 403 with the code, anywhere else, goes to the MFA page", () => {
    expect(mfaEnrolmentRedirect(403, MFA_ENROLMENT_REQUIRED, "/dashboard")).toBe(MFA_PATH);
    expect(mfaEnrolmentRedirect(403, MFA_ENROLMENT_REQUIRED, "/dashboard/devices")).toBe(MFA_PATH);
  });

  it("not again when already there (no reload loop from the page's own requests)", () => {
    expect(mfaEnrolmentRedirect(403, MFA_ENROLMENT_REQUIRED, MFA_PATH)).toBeNull();
  });

  it("an ordinary 403, or the code on another status, is not a redirect", () => {
    expect(mfaEnrolmentRedirect(403, undefined, "/dashboard")).toBeNull();
    expect(mfaEnrolmentRedirect(403, "SOMETHING_ELSE", "/dashboard")).toBeNull();
    expect(mfaEnrolmentRedirect(401, MFA_ENROLMENT_REQUIRED, "/dashboard")).toBeNull();
    expect(mfaEnrolmentRedirect(undefined, MFA_ENROLMENT_REQUIRED, "/dashboard")).toBeNull();
  });

  it("the two gates do not answer each other's code", () => {
    expect(mfaEnrolmentRedirect(403, PASSWORD_CHANGE_REQUIRED, "/dashboard")).toBeNull();
    expect(passwordChangeRedirect(403, MFA_ENROLMENT_REQUIRED, "/dashboard")).toBeNull();
    // The backend checks the password gate first, so an MFA 403 on the
    // change-password page means the password is already changed: go on to
    // the MFA page.
    expect(mfaEnrolmentRedirect(403, MFA_ENROLMENT_REQUIRED, CHANGE_PASSWORD_PATH)).toBe(MFA_PATH);
  });
});
