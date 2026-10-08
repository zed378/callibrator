/**
 * G-11 (P20-07; ADR-124 Am. 2; spec MEMORY/specs/P19-04-client-facilities.md § 5.1, § 6.3;
 * docs/SECURITY/15 § 11) — the facility-scoped model set, read from the REAL model registry.
 *
 *  1. The § 5.1 table: exactly these models declare `clientFacilityId` (the evidence chain, the
 *     nullable set, the binding, the audit trail) — a new one is a reviewed decision, here.
 *  2. A model with a device key (`deviceId` / `device_id`) declares `clientFacilityId`, or is on
 *     PROVIDER_INTERNAL with its reason — a device-owned table that forgets the facility is the
 *     "forgetting" failure class of spec § 1.
 *  3. `ClientFacility` declares no `clientFacilityId` (it IS the facility, AM-8); neither model of
 *     the dimension is paranoid or has a defaultScope (G-F3: an include must never be an INNER
 *     JOIN).
 *  4. No model declares an index on `client_facility_id` and none declares a `references` for it:
 *     the keys are composite and every index is the migrations' (ADR-100 Am. 3 — db.sync() runs
 *     before the migrator; an index on a migration-added column kills the upgrade boot).
 *  5. Every association to `ClientFacility` is `constraints: false` (sync must not build a second,
 *     single-column key beside the migration's composite one).
 *
 * Fail-before: each rule is shown to bite on a planted model (the `bites` cases).
 */
import type * as SequelizeModule from "sequelize";
import type * as ModelsModule from "../../models";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = (() => Promise.resolve([])) as unknown as typeof db.query;
  return { db };
});

interface AttributeLike {
  field?: string;
  allowNull?: boolean;
  references?: unknown;
}
interface IndexLike {
  fields: (string | { name?: string; attribute?: string })[];
}
interface AssociationLike {
  target: { name: string };
  associationType: string;
  options: { constraints?: boolean };
}
interface ModelLike {
  name: string;
  getAttributes(): Record<string, AttributeLike>;
  options: { paranoid?: boolean; defaultScope?: Record<string, unknown> };
  _indexes?: IndexLike[];
  associations: Record<string, AssociationLike>;
}

/** spec § 5.1: the models that carry the facility, and whether the column is NOT NULL in the database. */
const FACILITY_SCOPED: Readonly<Record<string, { databaseNotNull: boolean; why: string }>> = Object.freeze({
  CalibrationDevice: { databaseNotNull: true, why: "the root of the evidence chain (0118)" },
  CalibrationRecord: { databaseNotNull: true, why: "its device's facility (0119)" },
  Certificate: { databaseNotNull: true, why: "its device's facility (0120)" },
  MaintenanceWorkOrder: { databaseNotNull: true, why: "its device's facility (0121)" },
  IotReading: { databaseNotNull: true, why: "its device's facility (0122)" },
  NonConformance: { databaseNotNull: false, why: "its device's facility, NULL without a device (0123)" },
  Attachment: { databaseNotNull: false, why: "its linked record's facility, NULL otherwise (0123, AM-7)" },
  Warehouse: { databaseNotNull: false, why: "a room's facility; NULL = the provider's store (0123, G-F4)" },
  User: { databaseNotNull: false, why: "the binding: set ⇔ bound (0123)" },
  AuditLog: { databaseNotNull: false, why: "where the act happened; no FK, no back-fill (0117)" },
  // P20-04 (ADR-126 § 1, Am. 2 § 5): the IPM aggregate — the device's facility, and the session's.
  InspectionSession: { databaseNotNull: true, why: "its device's facility (0126)" },
  InspectionResult: { databaseNotNull: true, why: "its session's facility (0126)" },
  InspectionSessionSignature: { databaseNotNull: true, why: "its session's facility (0126)" },
});

/** Models with a device key that are NOT facility-scoped — provider-internal, DENY for bound principals (P21-09). */
const PROVIDER_INTERNAL: Readonly<Record<string, string>> = Object.freeze({
  AssetFinance: "finance is the provider's business, not the client facility's (spec § 5.1)",
  ClientFacilityMove: "the move log names the facility the device left — another client (spec § 5.5)",
});

const FACILITY_KEYS = new Set(["clientFacilityId", "client_facility_id"]);
const hasFacility = (m: ModelLike): boolean => Object.keys(m.getAttributes()).some((a) => FACILITY_KEYS.has(a));
const hasDevice = (m: ModelLike): boolean =>
  Object.entries(m.getAttributes()).some(([a, d]) => a === "deviceId" || a === "device_id" || d.field === "device_id");
const indexedColumns = (m: ModelLike): string[] =>
  (m._indexes ?? []).flatMap((i) => i.fields.map((f) => (typeof f === "string" ? f : (f.name ?? f.attribute ?? ""))));

/** The rule violations of the given models (the guard's whole logic, so a planted model can show it bites). */
const violations = (models: readonly ModelLike[]): string[] => {
  const out: string[] = [];
  for (const m of models) {
    if (hasDevice(m) && !hasFacility(m) && !(m.name in PROVIDER_INTERNAL)) {
      out.push(`${m.name}: has a device key but no clientFacilityId and no PROVIDER_INTERNAL reason`);
    }
    if (indexedColumns(m).some((c) => FACILITY_KEYS.has(c))) {
      out.push(`${m.name}: declares an index on client_facility_id (the migrations own it — ADR-100 Am. 3)`);
    }
    for (const [attribute, definition] of Object.entries(m.getAttributes())) {
      if (FACILITY_KEYS.has(attribute) && definition.references) {
        out.push(`${m.name}.${attribute}: declares a references (the facility keys are composite — the migrations')`);
      }
    }
    for (const association of Object.values(m.associations)) {
      if (association.target.name === "ClientFacility" && association.options.constraints !== false) {
        out.push(`${m.name} → ClientFacility: an association with a constraint (sync would build a single-column key)`);
      }
    }
  }
  return out;
};

describe("G-11 — the facility-scoped models (P20-07)", () => {
  const barrel = jest.requireActual<typeof ModelsModule>("../../models") as unknown as {
    sequelize: { models: Record<string, ModelLike> };
  };
  const models = [...new Set(Object.values(barrel.sequelize.models))];
  const byName = (name: string): ModelLike => {
    const model = models.find((m) => m.name === name);
    if (!model) {
      throw new Error(`no model ${name}`);
    }
    return model;
  };

  it("exactly the spec § 5.1 models declare clientFacilityId", () => {
    expect(models.filter(hasFacility).map((m) => m.name).sort()).toEqual(Object.keys(FACILITY_SCOPED).sort());
  });

  it("every model with a device key declares the facility or is a reviewed provider-internal one — and the rules hold for every model", () => {
    expect(violations(models)).toEqual([]);
    for (const name of Object.keys(PROVIDER_INTERNAL)) {
      expect(hasDevice(byName(name))).toBe(true);
      expect(hasFacility(byName(name))).toBe(false);
    }
  });

  it("the attribute is nullable on every model — the database holds NOT NULL where § 5.1 says (ADR-124 Am. 3: it fills it)", () => {
    for (const name of Object.keys(FACILITY_SCOPED)) {
      expect(byName(name).getAttributes()["clientFacilityId"]).toMatchObject({ allowNull: true });
    }
  });

  it("ClientFacility is the facility: no clientFacilityId; it and the move log are neither paranoid nor default-scoped (G-F3)", () => {
    expect(hasFacility(byName("ClientFacility"))).toBe(false);
    for (const name of ["ClientFacility", "ClientFacilityMove"]) {
      const m = byName(name);
      expect(m.options.paranoid).toBe(false);
      expect(m.options.defaultScope ?? {}).toEqual({});
      expect(indexedColumns(m)).toEqual([]);
    }
  });

  it("the device and the user name their facility through constraint-free associations", () => {
    for (const name of ["CalibrationDevice", "User"]) {
      const association = byName(name).associations["clientFacility"];
      expect(association).toMatchObject({ associationType: "BelongsTo", options: { constraints: false } });
      expect(association?.target.name).toBe("ClientFacility");
    }
  });

  describe("bites (fail-before, planted models)", () => {
    const planted = (over: Partial<ModelLike> & { attributes: Record<string, AttributeLike> }): ModelLike => ({
      name: over.name ?? "Planted",
      getAttributes: () => over.attributes,
      options: { paranoid: false },
      _indexes: over._indexes ?? [],
      associations: over.associations ?? {},
    });

    it("a device-owned model that forgets the facility", () => {
      expect(violations([planted({ name: "IpmSessionDraft", attributes: { deviceId: { field: "device_id" } } })])).toEqual([
        "IpmSessionDraft: has a device key but no clientFacilityId and no PROVIDER_INTERNAL reason",
      ]);
    });

    it("a model index on client_facility_id, and a references on it", () => {
      expect(
        violations([
          planted({
            name: "Planted",
            attributes: { clientFacilityId: { field: "client_facility_id", references: { model: "client_facilities" } } },
            _indexes: [{ fields: ["client_facility_id"] }],
          }),
        ]),
      ).toEqual([
        "Planted: declares an index on client_facility_id (the migrations own it — ADR-100 Am. 3)",
        "Planted.clientFacilityId: declares a references (the facility keys are composite — the migrations')",
      ]);
    });

    it("an association to ClientFacility with its default constraint", () => {
      expect(
        violations([
          planted({
            attributes: { clientFacilityId: {} },
            associations: { clientFacility: { target: { name: "ClientFacility" }, associationType: "BelongsTo", options: {} } },
          }),
        ]),
      ).toEqual(["Planted → ClientFacility: an association with a constraint (sync would build a single-column key)"]);
    });
  });
});
