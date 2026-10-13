/**
 * A-369 (ADR-075 Am. 1) — the OpenAPI document states the two coded refusals of a tenant-less
 * account: 400 `TENANT_REQUIRED` on a user create and role change, 403 `ACCOUNT_HAS_NO_TENANT` on the
 * password and passkey sign-ins. Read from the route docs modules and from the generated
 * `openapi.json` (which `openapi:check` keeps equal to them). The codes and texts are the ones the
 * services throw (utils/tenantRequired.util; the refusals themselves are proved by
 * services/tenantRequired.a369).
 */
import * as fs from "fs";
import * as path from "path";
import { accountHasNoTenant403, tenantRequired400 } from "../../docs/openapi/tenantRequiredErrors";
import { ACCOUNT_HAS_NO_TENANT_MESSAGE, TENANT_REQUIRED_MESSAGE } from "../../utils/tenantRequired.util";

interface Doc {
  paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema?: { properties?: Record<string, { enum?: string[] }> }; example?: Record<string, unknown> }> }> }>>;
}
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../openapi.json"), "utf8")) as Doc;

const codeOf = (route: string, status: string) => doc.paths[route]?.["post"]?.responses[status]?.content?.["application/json"];

describe("A-369 — the OpenAPI document's tenant refusals", () => {
  it.each([
    ["/api/v1/users/create", "400", "TENANT_REQUIRED"],
    ["/api/v1/users/role-update", "400", "TENANT_REQUIRED"],
    ["/api/v1/auth/login", "403", "ACCOUNT_HAS_NO_TENANT"],
    ["/api/v1/auth/passkey/verify", "403", "ACCOUNT_HAS_NO_TENANT"],
  ])("%s answers %s with the top-level code %s (optional: the status's other refusals carry none)", (route, status, code) => {
    const response = codeOf(route, status);
    expect(response?.schema?.properties?.["code"]?.enum).toEqual([code]);
    expect(response?.example).toMatchObject({ success: false, status: Number(status), data: null, code });
  });

  it("the bodies validate the coded refusal and the uncoded ones alike; never another code", () => {
    const required = { success: false, status: 400, message: TENANT_REQUIRED_MESSAGE, data: null, code: "TENANT_REQUIRED" };
    expect(tenantRequired400.body.safeParse(required).success).toBe(true);
    expect(tenantRequired400.body.safeParse({ ...required, code: undefined, message: "Validation Error" }).success).toBe(true);
    expect(tenantRequired400.body.safeParse({ ...required, code: "OTHER" }).success).toBe(false);
    const noTenant = { success: false, status: 403, message: ACCOUNT_HAS_NO_TENANT_MESSAGE, data: null, code: "ACCOUNT_HAS_NO_TENANT" };
    expect(accountHasNoTenant403.body.safeParse(noTenant).success).toBe(true);
    expect(accountHasNoTenant403.example).toEqual(noTenant);
  });
});
