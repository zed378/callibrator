/**
 * P21-09 — G-02 of docs/SECURITY/15 § 11 (spec MEMORY/specs/P19-04-client-facilities.md § 17):
 * the facility dimension over the REAL model registry, deny by default.
 *
 * For EVERY tenant-scoped model the barrel defines (read from the registry, not from a list —
 * a model added tomorrow is covered tomorrow), as a facility-BOUND principal of facility F1:
 *  - a facility model's row of F2 is invisible; its row of F1 is visible;
 *  - a FACILITY_READABLE model's row is visible only when its rule matches (own facility / own user);
 *  - every other tenant model (provider-internal) is invisible — while the SAME row is visible to an
 *    unbound principal of the same tenant (the positive control: the seed is reachable, the deny
 *    made the difference);
 *  - a bound principal whose context names no facility sees no facility row (NO_FACILITY_ID).
 * The REAL models and hooks run over memoryDb; nothing is mocked but the wire.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as Models from "../../models";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { FACILITY_READABLE } from "../../constants/facilityAccess";
import type { ClientFacilityId, TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
jest.requireActual<typeof Models>("../../models");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" as ClientFacilityId;
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2" as ClientFacilityId;
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ROW = "99999999-9999-4999-8999-999999999999";

interface RegistryModel {
  readonly name: string;
  readonly rawAttributes: Record<string, unknown>;
  readonly primaryKeyAttribute: string;
  unscoped(): { findAll(options: Record<string, unknown>): Promise<unknown[]> };
}

const registry = (): RegistryModel[] => Object.values(mdb.sequelize.models) as unknown as RegistryModel[];
const tenantKey = (m: RegistryModel): string | null =>
  "tenantId" in m.rawAttributes ? "tenantId" : "tenant_id" in m.rawAttributes ? "tenant_id" : null;
const facilityKey = (m: RegistryModel): string | null =>
  "clientFacilityId" in m.rawAttributes ? "clientFacilityId" : "client_facility_id" in m.rawAttributes ? "client_facility_id" : null;

const context = (over: Partial<TenantContextStore> = {}): TenantContextStore => ({
  tenantId: T,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: U1,
  clientFacilityId: F1,
  facilityBound: true,
  ...over,
});
const read = (m: RegistryModel, over: Partial<TenantContextStore> = {}): Promise<unknown[]> =>
  tenantStorage.run(context(over), () => m.unscoped().findAll({ paranoid: false }));

const tenantModels = registry().filter((m) => tenantKey(m) !== null);
const readable = FACILITY_READABLE as Readonly<Record<string, { rule: string; attribute: string }>>;
const facilityModels = tenantModels.filter((m) => facilityKey(m) !== null);
const readableModels = tenantModels.filter((m) => facilityKey(m) === null && m.name in readable);
const internalModels = tenantModels.filter((m) => facilityKey(m) === null && !(m.name in readable));

const seedRow = (m: RegistryModel, extra: Record<string, unknown>): void => {
  mdb.seed(m.name, { [m.primaryKeyAttribute]: ROW, [tenantKey(m) as string]: T, ...extra });
};

beforeEach(() => {
  mdb.reset();
});

describe("G-02 — the facility dimension over the real registry", () => {
  it("the registry holds facility, readable and provider-internal models (the lists below are not empty)", () => {
    expect(facilityModels.map((m) => m.name)).toEqual(
      expect.arrayContaining(["CalibrationDevice", "CalibrationRecord", "Certificate", "MaintenanceWorkOrder", "IotReading", "User", "AuditLog"]),
    );
    expect(readableModels.map((m) => m.name).sort()).toEqual(Object.keys(readable).sort());
    // Named here so G-12 (facilityReadable.guard) finds each entry's exercising test.
    expect(Object.keys(readable).sort()).toEqual(["ClientFacility", "ConsentRecord", "DsarRequest", "Notification", "Session"]);
    expect(internalModels.length).toBeGreaterThan(20);
  });

  it.each(facilityModels.map((m) => [m.name, m] as const))("%s: another facility's row is invisible, its own visible, none without a facility", async (_name, m) => {
    const key = facilityKey(m) as string;
    seedRow(m, { [key]: F2 });
    expect(await read(m)).toHaveLength(0);
    expect(await read(m, { facilityBound: false, clientFacilityId: null })).toHaveLength(1);
    mdb.reset();
    seedRow(m, { [key]: F1 });
    expect(await read(m)).toHaveLength(1);
    expect(await read(m, { clientFacilityId: null })).toHaveLength(0);
  });

  it.each(readableModels.map((m) => [m.name, m] as const))("%s (FACILITY_READABLE): only its rule's row", async (_name, m) => {
    const entry = readable[m.name] as { rule: string; attribute: string };
    const mine = entry.rule === "own-facility" ? F1 : U1;
    const other = entry.rule === "own-facility" ? F2 : U2;
    if (entry.attribute === m.primaryKeyAttribute) {
      mdb.seed(m.name, { [m.primaryKeyAttribute]: other, [tenantKey(m) as string]: T });
      mdb.seed(m.name, { [m.primaryKeyAttribute]: mine, [tenantKey(m) as string]: T });
    } else {
      mdb.seed(m.name, { [m.primaryKeyAttribute]: ROW, [tenantKey(m) as string]: T, [entry.attribute]: other });
      mdb.seed(m.name, { [m.primaryKeyAttribute]: "88888888-8888-4888-8888-888888888888", [tenantKey(m) as string]: T, [entry.attribute]: mine });
    }
    const rows = (await read(m)) as { get(key: string): unknown }[];
    expect(rows.map((r) => r.get(entry.attribute))).toEqual([mine]);
    expect(await read(m, { facilityBound: false, clientFacilityId: null })).toHaveLength(2);
  });

  it.each(internalModels.map((m) => [m.name, m] as const))("%s (provider-internal): denied to a bound principal, visible unbound", async (_name, m) => {
    seedRow(m, {});
    expect(await read(m)).toHaveLength(0);
    expect(await read(m, { facilityBound: false, clientFacilityId: null })).toHaveLength(1);
  });
});
