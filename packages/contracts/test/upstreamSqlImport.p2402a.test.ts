/**
 * P24-02a — the transform request's body (@callibrator/contracts/upstreamSqlImport; ADR-129
 * Am. 3): the provider tenant is required and must be a UUID; the route's whole request is the
 * run id and that body, checked in one pass.
 */
import {
  requestUpstreamSqlTransformSchema,
  transformUpstreamSqlImportSchema,
} from "@callibrator/contracts/upstreamSqlImport";

const RUN = "a2402000-0000-4000-8000-0000000000e1";
const TENANT = "a2402000-0000-4000-8000-0000000000a1";

describe("P24-02a @callibrator/contracts/upstreamSqlImport — the transform request", () => {
  it("the body needs a provider tenant id, a UUID", () => {
    expect(requestUpstreamSqlTransformSchema.parse({ providerTenantId: TENANT })).toEqual({ providerTenantId: TENANT });
    expect(requestUpstreamSqlTransformSchema.safeParse({}).success).toBe(false);
    expect(requestUpstreamSqlTransformSchema.safeParse({ providerTenantId: "tenant-1" }).success).toBe(false);
  });

  it("the route's request is the run id and the body together; either missing is refused", () => {
    expect(transformUpstreamSqlImportSchema.parse({ id: RUN, providerTenantId: TENANT })).toEqual({ id: RUN, providerTenantId: TENANT });
    expect(transformUpstreamSqlImportSchema.safeParse({ providerTenantId: TENANT }).success).toBe(false);
    expect(transformUpstreamSqlImportSchema.safeParse({ id: RUN }).success).toBe(false);
  });
});
