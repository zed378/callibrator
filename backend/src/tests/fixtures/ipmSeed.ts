/**
 * ipmSeed — one synthetic IPM world over memoryDb for the P21-03 suites (spec
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 17): tenant A with SELF, F1 and F2; a device and a
 * room in each of F1 and F2; tenant B with one device; the base checklist (catalogueSeed) and a
 * device type whose own checklist pins every section kind the capture uses; sessions in every
 * state.
 *
 * Principals: `staff` (TECHNICIAN, unbound), `admin` (TENANT_ADMIN, unbound), `bound` and
 * `bound2` (HEALTHCARE TECHNICIAN bound to F1), `other` (tenant B). Synthetic data only.
 */
import type { MemoryDb } from "./memoryDb";
import type { Principal, TwoTenantWorld } from "./routeClient";
import { BASE_V1, DEF, DEFINITION_ROWS, seedCatalogue } from "./catalogueSeed";

export const IPM = Object.freeze({
  SELF: "50505050-5050-4050-8050-505050505050",
  F1: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
  F2: "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2",
  FB: "fbfbfbfb-fbfb-4fbf-8fbf-fbfbfbfbfbfb",
  BOUND: "cccccccc-0000-4000-8000-0000000000f1",
  BOUND2: "cccccccc-0000-4000-8000-0000000000f2",
  TYPE: "7e7e7e7e-0000-4000-8000-000000000001",
  TYPE_TEMPLATE: "7e7e7e7e-0000-4000-8000-000000000002",
  TYPE_V1: "7e7e7e7e-0000-4000-8000-000000000003",
  TYPE_V0: "7e7e7e7e-0000-4000-8000-000000000004",
  TYPE_DRAFT: "7e7e7e7e-0000-4000-8000-000000000005",
  ITEM_PLACEMENT: "7e7e0000-0000-4000-8000-0000000000a1",
  ITEM_LEAK: "7e7e0000-0000-4000-8000-0000000000a2",
  ITEM_PRESSURE: "7e7e0000-0000-4000-8000-0000000000a3",
  ITEM_POWER: "7e7e0000-0000-4000-8000-0000000000a4",
  ITEM_BASE_TEMP: "7e7e0000-0000-4000-8000-0000000000a5",
  D1: "d1000000-0000-4000-8000-0000000000f1",
  D2: "d1000000-0000-4000-8000-0000000000f2",
  DB: "d1000000-0000-4000-8000-0000000000fb",
  ROOM1: "a0000000-0000-4000-8000-0000000000f1",
  ROOM2: "a0000000-0000-4000-8000-0000000000f2",
  STORE1: "a0000000-0000-4000-8000-0000000000e1",
  /** Submitted sessions: F1's (by staff), F2's, tenant B's. */
  S1: "5e550000-0000-4000-8000-0000000000f1",
  S2: "5e550000-0000-4000-8000-0000000000f2",
  SB: "5e550000-0000-4000-8000-0000000000fb",
  /** Drafts: the bound technician's in F1, and one in F2 (by staff). */
  DRAFT1: "5e550000-0000-4000-8000-0000000001f1",
  DRAFT2: "5e550000-0000-4000-8000-0000000001f2",
  RESULT1: "5e55aaaa-0000-4000-8000-0000000000f1",
});

/** The principals of the world. */
export interface IpmWorld {
  readonly staff: Principal;
  readonly admin: Principal;
  readonly bound: Principal;
  readonly bound2: Principal;
  readonly other: Principal;
  readonly tenantA: string;
  readonly tenantB: string;
}

const definition = (id: string): Record<string, unknown> => {
  const row = DEFINITION_ROWS.find((d) => d["id"] === id) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "status"));
};

const item = (id: string, versionId: string, def: string, sortOrder: number, origin = "type"): Record<string, unknown> => ({
  ...definition(def),
  id,
  versionId,
  itemDefinitionId: def,
  origin,
  required: true,
  sortOrder,
});

/** A submitted session row (memoryDb holds no CHECK: only what the reads need). */
export const submittedSession = (id: string, tenantId: string, facility: string, device: string, by: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  tenantId,
  clientFacilityId: facility,
  deviceId: device,
  templateVersionId: IPM.TYPE_V1,
  status: "submitted",
  revision: 3,
  performedAt: new Date("2026-10-01T02:00:00Z"),
  receivedAt: new Date("2026-10-01T02:00:00Z"),
  capturedOffline: false,
  createdBy: by,
  updatedBy: by,
  performedBy: by,
  submittedAt: new Date("2026-10-01T03:00:00Z"),
  submittedBy: by,
  visitNumber: 1,
  inspectionOutcome: "pass",
  maintenanceOutcome: "pass",
  recommendation: "fit_for_use",
  performerSnapshot: { name: "Teknisi Sintetis", role: "TECHNICIAN", organisation: "Lab Sintetis" },
  createdAt: new Date("2026-10-01T02:00:00Z"),
  updatedAt: new Date("2026-10-01T03:00:00Z"),
  ...extra,
});

/**
 * Seed the world.
 *
 * @param mdb - the memoryDb
 * @param fx - the two-tenant fixture
 * @param seedTenants - routeClient#seedTenants
 * @returns the principals
 */
export const seedIpmWorld = (
  mdb: MemoryDb,
  fx: TwoTenantWorld,
  seedTenants: (mdb: MemoryDb, fx: TwoTenantWorld, principals: readonly Principal[]) => void,
): IpmWorld => {
  const staff = fx.principal(fx.tenantA, "TECHNICIAN");
  const admin = fx.principal(fx.tenantA, "TENANT_ADMIN");
  const tech = fx.principal(fx.tenantA, "HEALTHCARE_TECHNICIAN");
  const bound = { ...tech, id: IPM.BOUND, clientFacilityId: IPM.F1 } as unknown as Principal;
  const bound2 = { ...tech, id: IPM.BOUND2, clientFacilityId: IPM.F1 } as unknown as Principal;
  const other = fx.principal(fx.tenantB, "TECHNICIAN");
  seedTenants(mdb, fx, [staff, admin, other]);
  const T = fx.tenantA.id;
  const B = fx.tenantB.id;
  for (const [id, name] of [
    [IPM.BOUND, "boundf1"],
    [IPM.BOUND2, "boundf1b"],
  ] as const) {
    mdb.seed("User", { id, tenantId: T, username: name, email: `${name}@example.test`, password: "x", firstName: "Bound", lastName: name, roleId: tech.role.id, clientFacilityId: IPM.F1, status: "ACTIVE", isActive: true });
  }
  mdb.seed("ClientFacility", [
    { id: IPM.SELF, tenantId: T, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: IPM.F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: IPM.F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
    { id: IPM.FB, tenantId: B, name: "Facility B", code: "F-000B", status: "active" },
  ]);
  mdb.seed("Warehouse", [
    { id: IPM.ROOM1, tenantId: T, name: "Ruang 1", code: "R-1", clientFacilityId: IPM.F1, kind: "room", status: "active", isDeleted: false },
    { id: IPM.ROOM2, tenantId: T, name: "Ruang 2", code: "R-2", clientFacilityId: IPM.F2, kind: "room", status: "active", isDeleted: false },
    { id: IPM.STORE1, tenantId: T, name: "Gudang 1", code: "S-1", clientFacilityId: IPM.F1, kind: "store", status: "active", isDeleted: false },
  ]);
  mdb.seed("DeviceType", { id: IPM.TYPE, name: "Synthetic Pump Type", status: "active" });
  mdb.seed("CalibrationDevice", [
    { id: IPM.D1, tenantId: T, clientFacilityId: IPM.F1, name: "Alat sintetis 1", serialNumber: "SN-1", qrCode: "TST000001", deviceTypeId: IPM.TYPE, status: "active", isDeleted: false },
    { id: IPM.D2, tenantId: T, clientFacilityId: IPM.F2, name: "Alat sintetis 2", serialNumber: "SN-2", qrCode: "TST000002", deviceTypeId: IPM.TYPE, status: "active", isDeleted: false },
    { id: IPM.DB, tenantId: B, clientFacilityId: IPM.FB, name: "Alat sintetis B", serialNumber: "SN-B", deviceTypeId: IPM.TYPE, status: "active", isDeleted: false },
  ]);
  seedCatalogue(mdb);
  mdb.seed("InspectionTemplate", { id: IPM.TYPE_TEMPLATE, deviceTypeId: IPM.TYPE, status: "active" });
  const version = (id: string, status: string, versionNumber: number | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    templateId: IPM.TYPE_TEMPLATE,
    status,
    versionNumber,
    contentHash: status === "draft" ? null : "b".repeat(64),
    revision: 0,
    ...extra,
  });
  mdb.seed("InspectionTemplateVersion", [
    version(IPM.TYPE_V0, "retired", 1, { publishedAt: new Date("2026-09-01T00:00:00Z"), retiredAt: new Date("2026-10-02T00:00:00Z") }),
    version(IPM.TYPE_V1, "published", 2, { publishedAt: new Date("2026-10-02T00:00:00Z") }),
    version(IPM.TYPE_DRAFT, "draft", null),
  ]);
  mdb.seed("InspectionTemplateItem", [
    item(IPM.ITEM_BASE_TEMP, IPM.TYPE_V1, DEF.temperature, 0, "base"),
    item(IPM.ITEM_PLACEMENT, IPM.TYPE_V1, DEF.placement, 0),
    item(IPM.ITEM_LEAK, IPM.TYPE_V1, DEF.leakage, 0),
    item(IPM.ITEM_PRESSURE, IPM.TYPE_V1, DEF.pressure, 0),
    item(IPM.ITEM_POWER, IPM.TYPE_V1, DEF.power, 0),
  ]);
  mdb.seed("InspectionSession", [
    submittedSession(IPM.S1, T, IPM.F1, IPM.D1, staff.id),
    submittedSession(IPM.S2, T, IPM.F2, IPM.D2, staff.id),
    submittedSession(IPM.SB, B, IPM.FB, IPM.DB, other.id),
    {
      id: IPM.DRAFT1,
      tenantId: T,
      clientFacilityId: IPM.F1,
      deviceId: IPM.D1,
      templateVersionId: IPM.TYPE_V1,
      status: "draft",
      revision: 0,
      performedAt: new Date("2026-10-08T02:00:00Z"),
      receivedAt: new Date("2026-10-08T02:00:00Z"),
      capturedOffline: false,
      createdBy: IPM.BOUND,
      updatedBy: IPM.BOUND,
      performedBy: IPM.BOUND,
      createdAt: new Date("2026-10-08T02:00:00Z"),
      updatedAt: new Date("2026-10-08T02:00:00Z"),
    },
    {
      id: IPM.DRAFT2,
      tenantId: T,
      clientFacilityId: IPM.F2,
      deviceId: IPM.D2,
      templateVersionId: IPM.TYPE_V1,
      status: "draft",
      revision: 0,
      performedAt: new Date("2026-10-08T02:00:00Z"),
      receivedAt: new Date("2026-10-08T02:00:00Z"),
      capturedOffline: false,
      createdBy: staff.id,
      updatedBy: staff.id,
      performedBy: staff.id,
      createdAt: new Date("2026-10-08T02:00:00Z"),
      updatedAt: new Date("2026-10-08T02:00:00Z"),
    },
  ]);
  mdb.seed("InspectionResult", {
    id: IPM.RESULT1,
    tenantId: T,
    clientFacilityId: IPM.F1,
    sessionId: IPM.S1,
    section: "function",
    inputKind: "tri_state",
    templateItemId: IPM.ITEM_POWER,
    itemDefinitionId: DEF.power,
    isAdHoc: false,
    labelSnapshot: "Synthetic power-on check",
    outcome: "pass",
    outcomeSource: "technician",
    warnFlag: false,
    disagreementFlag: false,
    sortOrder: 1,
  });
  return { staff, admin, bound, bound2, other, tenantA: T, tenantB: B };
};

/** The base checklist's version (a device without a type pins it). */
export const BASE_VERSION = BASE_V1;
