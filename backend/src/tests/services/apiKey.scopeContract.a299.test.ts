/**
 * A-299 — the API-key create dialog offers exactly the scopes the backend
 * accepts.
 *
 * The dialog (frontend CreateApiKeyModal) builds its options from
 * @callibrator/contracts/apiKeyScopes. This guard pins that contract to the
 * backend in both directions:
 *  1. its resources include every MENU_SLUGS value (since A-311 the contract
 *     is the list `apiKey.service#assertScopes` checks against, and a superset:
 *     tests/guards/apiKeyScopeCoverage.a311 holds it to the dynamicAccess gates),
 *     so a slug added to the backend without the contract fails here;
 *  2. EVERY scope the dialog can build is sent through the real `createApiKey`
 *     and accepted, and the ones the old dialog offered (PascalCase names,
 *     `*` resource or action) are refused, so the old options could not pass.
 *
 * Fail-before: of the old dialog's options, only the resource "Vendors" with
 * read or write (lower-cased to the `vendors` slug) could pass; the other
 * six resources ("CalibrationDevices", "Certificates", …) and every `*`
 * choice are refused by assertScopes (asserted below), so nearly every key
 * the dialog built answered 400.
 *
 * Real: the service's scope validation, MENU_SLUGS, the contract. Doubles:
 * the ApiKey model, the transaction and the audit writer.
 */
import {
  API_KEY_SCOPE_ACTIONS,
  API_KEY_SCOPE_RESOURCES,
  apiKeyScope,
} from "@callibrator/contracts/apiKeyScopes";
import type ApiKeyService from "../../services/apiKey.service";
import type * as Constants from "../../constants";

jest.mock("../../models", () => ({
  ApiKey: {
    create: jest.fn((values: Record<string, unknown>) => Promise.resolve({ id: "k-1", ...values })),
  },
  Tenant: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb: (t: string) => unknown) => cb("tx")) },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(() => Promise.resolve({})),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const apiKeyService = require("../../services/apiKey.service") as typeof ApiKeyService;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the real constants, after the mocks
const { MENU_SLUGS } = require("../../constants") as typeof Constants;

const TENANT = "00000000-0000-4000-8000-000000000001" as Parameters<typeof apiKeyService.createApiKey>[0];
const create = (scopes: string[]): Promise<unknown> => apiKeyService.createApiKey(TENANT, { name: "k", scopes });

describe("A-299 — the scope contract is the backend's slug list", () => {
  it("names every MENU_SLUGS value (A-311: the contract is the superset)", () => {
    const listed = new Set<string>(API_KEY_SCOPE_RESOURCES);
    expect(Object.values(MENU_SLUGS).map(String).filter((slug) => !listed.has(slug))).toEqual([]);
  });

  it("accepts every scope the dialog can build", async () => {
    const all = API_KEY_SCOPE_RESOURCES.flatMap((r) => API_KEY_SCOPE_ACTIONS.map((a) => apiKeyScope(r, a)));
    expect(all).toHaveLength(API_KEY_SCOPE_RESOURCES.length * 2);
    await expect(create(all)).resolves.toMatchObject({ scopes: all });
  });

  it.each([
    ["CalibrationDevices:read"],
    ["*"],
    ["*:read"],
    ["equipment:*"],
    ["Certificates:read"],
  ])("refuses the old dialog's option %s with 400", async (scope) => {
    await expect(create([scope])).rejects.toMatchObject({ status: 400 });
  });

  // A-311: "Maintenance" lower-cases to `maintenance`, which a dynamicAccess gate
  // checks; since A-311 it is a scope, so the old option now names a real one.
  it("accepts Maintenance:read since A-311 (a gated resource)", async () => {
    await expect(create(["Maintenance:read"])).resolves.toMatchObject({ scopes: ["maintenance:read"] });
  });
});
