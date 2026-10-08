/**
 * P20-01 / P20-03 (ADR-125 § 7, Amendment 1 G-4; spec P19-01 § 13
 * "catalogueModels.guard") — the global inspection catalogue stays global, and
 * stays out of the tenant hooks' way, in the REAL barrel:
 *
 *  - the five catalogue models declare no `tenantId` / `tenant_id` /
 *    `clientFacilityId` / `client_facility_id` (the hooks scope a model iff it
 *    declares a tenant attribute — tenantScope.util#tenantKeyOf; ADR-124's
 *    facility dimension must never reach them either);
 *  - none is `paranoid`, none has a `defaultScope` (G-4: an include of a model
 *    with a defaultScope is an INNER JOIN — the A-75 trap — and a session or
 *    device including a retired type or version would vanish);
 *  - none has an association to a tenant-scoped model (ADR-125 § 7: a type's
 *    devices across tenants would be other tenants' data) — walked from
 *    `Model.associations`, so a `DeviceType.hasMany(CalibrationDevice)` added
 *    later fails here;
 *  - unscopedModels.d17 lists each as `global` with ADR-125 as its reason;
 *  - the proposals model IS tenant-scoped, and NOT facility-scoped;
 *  - every association INTO the catalogue from a tenant model (the device's
 *    type, the proposal's targets) is RESTRICT.
 *
 * The rule bites: the check functions are run first against a planted model
 * that breaks each rule (fail-before, in the same file).
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type ModelStatic, type Model } from "sequelize";
import type * as SequelizeModule from "sequelize";
import type * as ModelsModule from "../../models";

jest.mock("../../config", () => {
  const { Sequelize: S } = jest.requireActual<typeof SequelizeModule>("sequelize");
  return { db: new S({ dialect: "postgres", logging: false }) };
});

const models = jest.requireActual<typeof ModelsModule>("../../models");

type AnyModel = ModelStatic<Model>;

const CATALOGUE = [
  "DeviceType",
  "InspectionItemDefinition",
  "InspectionTemplate",
  "InspectionTemplateVersion",
  "InspectionTemplateItem",
] as const;

const TENANT_KEYS = ["tenantId", "tenant_id", "clientFacilityId", "client_facility_id"];

const all = (): AnyModel[] => [...new Set(Object.values(models.sequelize.models))] as AnyModel[];
const byName = (name: string): AnyModel => {
  const found = all().find((m) => m.name === name);
  if (!found) {
    throw new Error(`no model ${name}`);
  }
  return found;
};
const isTenantScoped = (model: AnyModel): boolean => {
  const attributes = model.getAttributes();
  return "tenantId" in attributes || "tenant_id" in attributes;
};

interface ModelInternals {
  options: { paranoid?: boolean; defaultScope?: object };
  associations: Record<string, { target: AnyModel; associationType: string }>;
}

/** Every rule a global catalogue model must keep; each problem is a sentence. */
const problemsOf = (model: AnyModel): string[] => {
  const internals = model as unknown as ModelInternals;
  const problems: string[] = [];
  const attributes = model.getAttributes() as Record<string, { field?: string } | undefined>;
  for (const key of TENANT_KEYS) {
    const declared = Object.entries(attributes).some(([name, a]) => name === key || a?.field === key);
    if (declared) {
      problems.push(`${model.name} declares ${key}`);
    }
  }
  if (internals.options.paranoid) {
    problems.push(`${model.name} is paranoid`);
  }
  if (internals.options.defaultScope && Object.keys(internals.options.defaultScope).length > 0) {
    problems.push(`${model.name} has a defaultScope`);
  }
  for (const [as, association] of Object.entries(internals.associations)) {
    if (isTenantScoped(association.target)) {
      problems.push(`${model.name}.${as} (${association.associationType}) reaches tenant-scoped ${association.target.name}`);
    }
  }
  return problems;
};

describe("P20-03 — the guard bites (fail-before, on planted models)", () => {
  it("a tenant column, paranoid, a defaultScope and an association to a tenant model are each found", () => {
    const s = new Sequelize({ dialect: "postgres", logging: false });
    const Hospital = s.define("PlantedDevice", { tenantId: DataTypes.UUID }, { tableName: "planted_devices" });
    const Planted = s.define(
      "PlantedType",
      { clientFacilityId: DataTypes.UUID },
      { tableName: "planted_types", paranoid: true, defaultScope: { where: { name: "x" } } },
    );
    Planted.hasMany(Hospital, { as: "devices", foreignKey: "typeId" });
    expect(problemsOf(Planted as unknown as AnyModel)).toEqual([
      "PlantedType declares clientFacilityId",
      "PlantedType is paranoid",
      "PlantedType has a defaultScope",
      "PlantedType.devices (HasMany) reaches tenant-scoped PlantedDevice",
    ]);
  });
});

describe("P20-01 / P20-03 — the inspection catalogue is global, unscoped, and reaches no tenant model", () => {
  it.each(CATALOGUE)("%s: no tenant or facility key, not paranoid, no defaultScope, no association to a tenant model", (name) => {
    expect(problemsOf(byName(name))).toEqual([]);
  });

  it("the five are listed in unscopedModels.d17 as `global`, with ADR-125 as the reason", () => {
    const source = fs.readFileSync(path.join(__dirname, "../models/unscopedModels.d17.test.js"), "utf8");
    expect(source).toMatch(/const CATALOGUE = "ADR-125: platform catalogue; writes superAdminOnly/);
    for (const name of CATALOGUE) {
      expect(source).toContain(`  ${name}: { group: "global", why: CATALOGUE },`);
    }
  });

  it("InspectionTemplateProposal IS tenant-scoped (the hooks apply) and NOT facility-scoped (ADR-124 § 5: provider business)", () => {
    const proposal = byName("InspectionTemplateProposal");
    expect(isTenantScoped(proposal)).toBe(true);
    const attributes = proposal.getAttributes() as Record<string, { allowNull?: boolean } | undefined>;
    expect(attributes["tenantId"]?.allowNull).toBe(false);
    expect(Object.keys(attributes).some((k) => /facility/i.test(k))).toBe(false);
  });

  it("every association INTO the catalogue from a tenant model is a RESTRICT belongsTo (tenant → global, the allowed direction)", () => {
    const into = all()
      .filter(isTenantScoped)
      .flatMap((m) =>
        Object.entries((m as unknown as ModelInternals).associations)
          .filter(([, a]) => (CATALOGUE as readonly string[]).includes(a.target.name))
          .map(([as, a]) => ({
            key: `${m.name}.${as}`,
            type: a.associationType,
            onDelete: (a as unknown as { options: { onDelete?: string } }).options.onDelete,
          })),
      )
      .sort((a, b) => a.key.localeCompare(b.key));
    expect(into).toEqual([
      { key: "CalibrationDevice.deviceType", type: "BelongsTo", onDelete: "RESTRICT" },
      // P20-04 (ADR-126 § 1): a result pins its template item, a session its version.
      { key: "InspectionResult.templateItem", type: "BelongsTo", onDelete: "RESTRICT" },
      { key: "InspectionSession.templateVersion", type: "BelongsTo", onDelete: "RESTRICT" },
      { key: "InspectionTemplateProposal.basedOnVersion", type: "BelongsTo", onDelete: "RESTRICT" },
      { key: "InspectionTemplateProposal.deviceType", type: "BelongsTo", onDelete: "RESTRICT" },
      { key: "InspectionTemplateProposal.resultingVersion", type: "BelongsTo", onDelete: "RESTRICT" },
    ]);
  });
});
