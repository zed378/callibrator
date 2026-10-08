/**
 * P20-04 — G-S11 (spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 9.1; ADR-126 Am. 1 § 8):
 * `IdempotencyKey` is tenant-scoped and NOT facility-scoped, so under the facility deny a bound
 * technician could never record or replay its own capture keys — FACILITY_READABLE gives it the
 * `own-user` rule on `userId`. The REAL model and hooks over memoryDb, as the principals the
 * middleware of P21-03 will run under:
 *  - a bound technician reads its OWN key, never a colleague's, never an API key's row (no user);
 *  - an unbound principal of the tenant reads every key of the tenant (the positive control);
 *  - a principal of another tenant reads none;
 *  - a bound principal whose context names no user reads none (the deny sentinel).
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Models from "../../models";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { FACILITY_READABLE } from "../../constants/facilityAccess";
import type { ClientFacilityId, TenantId, UserId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof Models>("../../models");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const OTHER_TENANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TenantId;
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" as ClientFacilityId;
const TECHNICIAN = "11111111-1111-4111-8111-111111111111" as UserId;
const COLLEAGUE = "22222222-2222-4222-8222-222222222222" as UserId;
const API_KEY = "33333333-3333-4333-8333-333333333333";

const context = (over: Partial<TenantContextStore> = {}): TenantContextStore => ({
  tenantId: T,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: TECHNICIAN,
  clientFacilityId: F1,
  facilityBound: true,
  ...over,
});

const keysSeen = async (over: Partial<TenantContextStore> = {}): Promise<string[]> =>
  tenantStorage.run(context(over), async () =>
    (await models.IdempotencyKey.findAll({ order: [["id", "ASC"]] })).map((row) => String(row.get("id"))),
  );

const seedKey = (id: string, values: Record<string, unknown>): void => {
  mdb.seed("IdempotencyKey", {
    id,
    tenantId: T,
    userId: null,
    apiKeyId: null,
    key: "44444444-4444-4444-8444-444444444444",
    route: "POST /ipm/sessions",
    requestHash: "a".repeat(64),
    scopeFingerprint: "b".repeat(64),
    status: "completed",
    ...values,
  });
};

const MINE = "00000000-0000-4000-8000-000000000001";
const THEIRS = "00000000-0000-4000-8000-000000000002";
const KEYS_ROW = "00000000-0000-4000-8000-000000000003";
const ELSEWHERE = "00000000-0000-4000-8000-000000000004";

beforeEach(() => {
  mdb.reset();
  seedKey(MINE, { userId: TECHNICIAN });
  seedKey(THEIRS, { userId: COLLEAGUE });
  seedKey(KEYS_ROW, { apiKeyId: API_KEY });
  seedKey(ELSEWHERE, { tenantId: OTHER_TENANT, userId: TECHNICIAN });
});

describe("G-S11 — IdempotencyKey is FACILITY_READABLE by its own user", () => {
  it("the entry is the own-user rule on userId (ADR-126 Am. 1 § 8)", () => {
    expect(FACILITY_READABLE.IdempotencyKey).toMatchObject({ rule: "own-user", attribute: "userId" });
  });

  it("a bound technician reads its own key only — not a colleague's, not an API key's", async () => {
    expect(await keysSeen()).toEqual([MINE]);
  });

  it("an unbound principal of the tenant reads every key of the tenant, and none of another tenant", async () => {
    expect(await keysSeen({ facilityBound: false, clientFacilityId: null })).toEqual([MINE, THEIRS, KEYS_ROW]);
  });

  it("another tenant's principal reads none of these, bound or not", async () => {
    expect(await keysSeen({ tenantId: OTHER_TENANT, userId: COLLEAGUE })).toEqual([]);
    expect(await keysSeen({ tenantId: OTHER_TENANT, userId: TECHNICIAN })).toEqual([ELSEWHERE]);
  });

  it("a bound principal whose context names no user reads none", async () => {
    expect(await keysSeen({ userId: null })).toEqual([]);
  });
});
