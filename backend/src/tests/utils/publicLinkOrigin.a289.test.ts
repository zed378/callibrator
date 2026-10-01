/**
 * A-289 (ADR-100) — utils/publicLinkOrigin.util.ts: an emailed link's origin
 * comes from configuration, never from a request. The register path that
 * uses it is controllers/auth.controller.test › register (a forged Origin).
 */
import { configuredFrontendOrigin, DEVELOPMENT_FRONTEND_ORIGIN, emailLinkOrigin } from "../../utils/publicLinkOrigin.util";
import { environment } from "../../config/env";

const env = environment();
const saved = { ...env };
const unset = (key: string): void => {
  Reflect.deleteProperty(env, key);
};
afterEach(() => {
  for (const key of ["NODE_ENV", "FRONTEND_URL", "HOST_URL"]) {
    const value = saved[key];
    if (value === undefined) {
      unset(key);
    } else {
      env[key] = value;
    }
  }
});

it("FRONTEND_URL first, then HOST_URL, trailing slashes stripped", () => {
  env["FRONTEND_URL"] = "https://app.example///";
  env["HOST_URL"] = "https://api.example";
  expect(emailLinkOrigin()).toBe("https://app.example");
  env["FRONTEND_URL"] = "";
  expect(configuredFrontendOrigin()).toBe("https://api.example");
});

it("unset outside production: the developer's front end", () => {
  unset("FRONTEND_URL");
  env["HOST_URL"] = "  ";
  env["NODE_ENV"] = "test";
  expect(configuredFrontendOrigin()).toBeNull();
  expect(emailLinkOrigin()).toBe(DEVELOPMENT_FRONTEND_ORIGIN);
});

it("unset in production: a 500 naming the settings, never a request-derived origin", () => {
  unset("FRONTEND_URL");
  unset("HOST_URL");
  env["NODE_ENV"] = "production";
  let caught: unknown;
  try {
    emailLinkOrigin();
  } catch (e) {
    caught = e;
  }
  expect(caught).toMatchObject({ status: 500 });
  expect((caught as Error).message).toMatch(/FRONTEND_URL or HOST_URL/);
});
