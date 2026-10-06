/**
 * `npm run bootstrap:rotate` from a source checkout failed with
 * "JWT_ACCESS_SECRET environment variable is required" (U-09 side finding,
 * 2026-10-05): scripts/rotateBootstrapPassword.ts loaded `../config` — which
 * requires the JWT secrets as it loads — and only then, inside its entry-point
 * block, `../utils/env.util`, which reads backend/.env. Every other CLI here
 * loads env.util FIRST (migrateStorage, migrate, …).
 *
 * Fail-before: against the old module, env.util is never loaded by a require
 * of the script (it was only in the `require.main === module` block), so the
 * first case fails with `order` = ["config", "bootstrapCredential"].
 */
const mockOrder: string[] = [];

jest.mock("../../utils/env.util", () => {
  mockOrder.push("env.util");
  return {};
});
jest.mock("../../config", () => {
  mockOrder.push("config");
  return { db: { close: jest.fn().mockResolvedValue(undefined) } };
});
jest.mock("../../services/bootstrapCredential.service", () => {
  mockOrder.push("bootstrapCredential");
  return { rotateOneTimePassword: jest.fn() };
});

describe("rotateBootstrapPassword — backend/.env is read before anything that reads the environment", () => {
  it("loads env.util before ../config and the credential service", () => {
    jest.isolateModules(() => {
      jest.requireActual("../../scripts/rotateBootstrapPassword");
    });
    expect(mockOrder).toEqual(["env.util", "config", "bootstrapCredential"]);
  });

  it("requiring it runs nothing: the entry point is only `require.main === module` (the in-container dispatcher calls main itself)", () => {
    const service = jest.requireMock<{ rotateOneTimePassword: jest.Mock }>("../../services/bootstrapCredential.service");
    expect(service.rotateOneTimePassword).not.toHaveBeenCalled();
  });
});
