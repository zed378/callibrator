/**
 * D-26 (ADR-064, ADR-083) — a native ENUM's labels and the lists that mirror
 * them are maintained separately, and nothing compared them.
 *
 * ADR-064 decided native ENUMs stay (a new value is an `ALTER TYPE … ADD
 * VALUE` migration, because `sync()` never adds one). What it left open is the
 * drift check. A value added to a constant or a validator but not to the model
 * is accepted at the edge and then refused by PostgreSQL with a type error —
 * a 500, not a 400; a value added to the model but not to the constant is
 * unreachable.
 *
 * This reads every ENUM from the REAL models (the barrel, on an unconnected
 * PostgreSQL-dialect Sequelize) and holds each to what mirrors it:
 *
 *  - a CONSTANT that lists the same values — equal, in the same order (the
 *    order is the PostgreSQL type's sort order when sync() creates it);
 *  - a VALIDATOR (a Zod `z.enum(...)` on the same key, in every exported schema
 *    of the module that has one) — every value it admits must be a model
 *    value, or the request passes validation and fails in the database.
 *    `equal` validators must admit all of them too;
 *  - NONE, with the reason: only service code writes the column.
 *
 * The registry must name every ENUM attribute, so a new ENUM fails here until
 * someone says what mirrors it. The database half — each model's labels equal
 * the labels of the column's type in `pg_enum` — is dataLayer.dbD.live.test.js
 * on PostgreSQL 18, fresh and upgraded.
 */
import type * as ModelsModule from "../../models";
import type { ModelStatic, Model, Sequelize as SequelizeType } from "sequelize";
import { z } from "zod";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<{ Sequelize: typeof SequelizeType }>("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const models = require("../../models") as typeof ModelsModule;

const allModels = [...new Set(Object.values(models.sequelize.models))] as ModelStatic<Model>[];

interface EnumAttributeDef {
  type?: {
    key?: string;
    values?: readonly string[];
  };
}

/** `{ "Model.attr": ["value", …] }` for every ENUM attribute of every model. */
const modelEnums = (): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const Model of allModels) {
    const rawAttrs = (Model as unknown as { getAttributes(): Record<string, EnumAttributeDef> }).getAttributes();
    for (const [attr, def] of Object.entries(rawAttrs)) {
      if (def.type?.key === "ENUM" && def.type.values) {
        out[`${Model.name}.${attr}`] = [...def.type.values];
      }
    }
  }
  return out;
};

const validator = (name: string): Record<string, unknown> => require(`../../validators/${name}`) as Record<string, unknown>;
const constant = (name: string): Record<string, unknown> => require(`../../constants/${name}`) as Record<string, unknown>;
const states = (): Record<string, readonly string[]> => require("@callibrator/contracts/states") as Record<string, readonly string[]>;
const inspection = (): Record<string, readonly string[]> => require("@callibrator/contracts/inspectionValues") as Record<string, readonly string[]>;
const deviceValues = (): Record<string, readonly string[]> => require("@callibrator/contracts/deviceValues") as Record<string, readonly string[]>;
/* eslint-enable @typescript-eslint/no-require-imports */

interface ZodWithDef {
  def?: { innerType?: unknown; out?: unknown; in?: unknown };
  _def?: { innerType?: unknown; out?: unknown; in?: unknown };
}

/**
 * The enum values a field schema restricts to, looking through the wrappers
 * the validators use (optional, nullable, default, a pipe that folds case, a
 * union with "" or null, an array's items). `null` and `""` are not values: on
 * a query schema they mean "no filter". Null when the field is not an enum.
 *
 * @param schema - a field schema
 * @returns the values
 */
const enumValues = (schema: unknown): string[] | null => {
  if (schema instanceof z.ZodEnum) {
    return [...schema.options] as string[];
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return enumValues(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    const d = (schema as unknown as ZodWithDef).def ?? (schema as unknown as ZodWithDef)._def;
    return enumValues(d?.innerType);
  }
  if (schema instanceof z.ZodPipe) {
    const d = (schema as unknown as ZodWithDef).def ?? (schema as unknown as ZodWithDef)._def;
    return enumValues(d?.out) ?? enumValues(d?.in);
  }
  if (schema instanceof z.ZodArray) {
    return enumValues(schema.element);
  }
  if (schema instanceof z.ZodUnion) {
    const lists = (schema.options as unknown[]).map(enumValues).filter((x): x is string[] => Boolean(x));
    return lists.length > 0 ? lists.flat() : null;
  }
  return null;
};

/**
 * Every enum list for `key` across a validator module's exported object
 * schemas (an array schema's item list counts).
 */
const zodAllowLists = (mod: Record<string, unknown>, key: string): string[][] =>
  Object.values(mod)
    .filter((schema): schema is z.ZodObject<z.ZodRawShape> => schema instanceof z.ZodObject && Boolean(schema.shape[key]))
    .map((schema) => enumValues(schema.shape[key]))
    .filter((x): x is string[] => Boolean(x));

const NO_MIRROR = "no shared list: only service code writes this column, from its own literals";

interface MirrorEntry {
  constants?: readonly (() => readonly string[])[];
  validators?: readonly (readonly [string, string, "equal" | "subset"])[];
  none?: string;
}

const cVal = (mod: string, key: string): readonly string[] =>
  constant(mod)[key] as readonly string[];

/**
 * Each ENUM attribute: its constant mirrors (equal, ordered), its validator
 * mirrors ([module, key, "equal"|"subset"]), or `none` with the reason.
 */
const MIRRORS: Readonly<Record<string, MirrorEntry>> = Object.freeze({
  // P10-05 (ADR-098 §6): one list per ENUM in constants/accessRequest.ts, read
  // by the model, migration 0099 and the validator.
  "AccessRequest.deviceCountBand": { constants: [() => cVal("accessRequest", "DEVICE_COUNT_BANDS")] },
  "AccessRequest.facilityType": { constants: [() => cVal("accessRequest", "FACILITY_TYPES")] },
  "AccessRequest.locale": { constants: [() => cVal("accessRequest", "REQUEST_LOCALES")] },
  "AccessRequest.status": { constants: [() => cVal("accessRequest", "ACCESS_REQUEST_STATUSES")] },
  "AssetFinance.depreciationMethod": { validators: [["finance.validator", "depreciationMethod", "equal"]] },
  "AuditLog.action": {
    constants: [
      () => cVal("auditActions", "AUDIT_ACTIONS"),
      () => cVal("index", "AUDIT_ACTIONS"),
    ],
  },
  "AuditLog.actorType": { constants: [() => cVal("systemActors", "ACTOR_TYPE_VALUES")] },
  "BatchJob.status": { none: NO_MIRROR },
  // P20-02 (ADR-132, ADR-133; migration 0128): the device register's and calibration dates' tuples
  // live once in @callibrator/contracts/deviceValues, read by the models and the migration.
  "CalibrationDevice.condition": { constants: [() => deviceValues()["DEVICE_CONDITIONS"] as readonly string[]] },
  "CalibrationDevice.conditionSource": { constants: [() => deviceValues()["DEVICE_CONDITION_SOURCES"] as readonly string[]] },
  "CalibrationDevice.nextCalibrationDateSource": { constants: [() => deviceValues()["NEXT_CALIBRATION_DATE_SOURCES"] as readonly string[]] },
  "CalibrationRecord.entryKind": { constants: [() => deviceValues()["CALIBRATION_ENTRY_KINDS"] as readonly string[]] },
  "CalibrationDevice.status": { validators: [["calibrationDevices.validator", "status", "equal"]] },
  // qms.validator spreads these same constants; its `status` key is shared
  // by the non-conformance and CAPA schemas, so the constant is the mirror.
  "Capa.status": { constants: [() => cVal("qmsConstants", "CAPA_STATUSES")] },
  "Certificate.status": {
    constants: [
      () => Object.values((models.Certificate as unknown as { STATUS: Record<string, string> }).STATUS),
      () => validator("certificate.validator")["CERTIFICATE_STATUS"] as readonly string[],
    ],
  },
  "Certificate.type": {
    constants: [
      () => Object.values((models.Certificate as unknown as { CERTIFICATE_TYPES: Record<string, string> }).CERTIFICATE_TYPES),
      () => validator("certificate.validator")["CERTIFICATE_TYPES"] as readonly string[],
    ],
  },
  // P20-07 (ADR-124 Am. 2): the client facility's kind and lifecycle, and the move's — one list each in
  // @callibrator/contracts/states.
  "ClientFacility.kind": { constants: [() => states()["CLIENT_FACILITY_KINDS"] as readonly string[]] },
  "ClientFacility.status": { constants: [() => states()["CLIENT_FACILITY_STATUSES"] as readonly string[]] },
  "ClientFacilityMove.status": { constants: [() => states()["CLIENT_FACILITY_MOVE_STATUSES"] as readonly string[]] },
  "ConsentRecord.status": { none: NO_MIRROR },
  "CustomDomain.domainType": { validators: [["customDomains.validator", "type", "equal"]] },
  "CustomDomain.status": { none: "customDomains.service DOMAIN_STATUS (not loadable without the service's I/O); the live test holds the column to the model" },
  "DsarRequest.status": { none: NO_MIRROR },
  "DsarRequest.type": { none: NO_MIRROR },
  "ESignatureRecord.action": { none: NO_MIRROR },
  "ESignatureRecord.authMethod": {
    // `sso` is written by the server for a federated session; no request may choose it.
    validators: [
      ["certificate.validator", "authMethod", "subset"],
      ["workflow.validator", "authMethod", "subset"],
    ],
  },
  "Invoice.status": { none: NO_MIRROR },
  "MaintenanceWorkOrder.priority": { validators: [["maintenance.validator", "priority", "equal"]] },
  "MaintenanceWorkOrder.status": { validators: [["maintenance.validator", "status", "equal"]] },
  "MaintenanceWorkOrder.type": { validators: [["maintenance.validator", "type", "equal"]] },
  "NonConformance.severity": {
    constants: [() => cVal("qmsConstants", "NC_SEVERITIES")],
    validators: [["qms.validator", "severity", "equal"]],
  },
  "NonConformance.status": { constants: [() => cVal("qmsConstants", "NC_STATUSES")] },
  "Notification.type": { none: NO_MIRROR },
  "Post.status": { validators: [["content.validator", "status", "equal"]] },
  "Post.type": { validators: [["content.validator", "type", "equal"]] },
  "SignatureRecord.status": { none: NO_MIRROR },
  "SignatureWorkflow.status": { none: NO_MIRROR },
  "SignatureWorkflowStep.status": { none: NO_MIRROR },
  "SopDocument.status": { none: NO_MIRROR },
  "SopTrainingAcknowledgment.status": { none: NO_MIRROR },
  "StockAdjustment.type": { validators: [["stock.validator", "type", "equal"]] },
  "StockOpname.status": { none: "stock.validator's `status` key is shared by the opname and transfer schemas; held by the live test" },
  "StockTransfer.status": { none: "stock.validator's `status` key is shared by the opname and transfer schemas; held by the live test" },
  "Subscription.billingCycle": { validators: [["billing.validator", "billingCycle", "equal"]] },
  "Subscription.status": { validators: [["billing.validator", "status", "equal"]] },
  "Tenant.billingCycle": { none: NO_MIRROR },
  "Tenant.plan": { validators: [["tenantHierarchy.validator", "plan", "equal"]] },
  "Tenant.status": { constants: [() => Object.values((constant("tenantStatus") as { TENANT_STATUS: Record<string, string> }).TENANT_STATUS)] },
  "TenantBackup.status": { constants: [() => Object.values((models.TenantBackup as unknown as { STATUS: Record<string, string> }).STATUS)] },
  "UsageAlert.comparison": { validators: [["meteredBilling.validator", "comparison", "equal"]] },
  // P20-01 / P20-03 (ADR-125 Am. 1): the catalogue's vocabularies and state
  // tuples live once in @callibrator/contracts (states.ts, inspectionValues.ts),
  // read by the models, migrations 0111/0112 and (P21-01) the request schemas.
  "DeviceType.status": { constants: [() => states()["DEVICE_TYPE_STATUSES"] as readonly string[]] },
  // P20-04 (ADR-126 Am. 1–2): the idempotency key's two states and the IPM aggregate's vocabularies.
  "IdempotencyKey.status": { constants: [() => states()["IDEMPOTENCY_KEY_STATUSES"] as readonly string[]] },
  "InspectionItemDefinition.inputKind": { constants: [() => inspection()["INSPECTION_INPUT_KINDS"] as readonly string[]] },
  "InspectionItemDefinition.limitOp": { constants: [() => inspection()["INSPECTION_LIMIT_OPS"] as readonly string[]] },
  "InspectionItemDefinition.section": { constants: [() => inspection()["INSPECTION_SECTIONS"] as readonly string[]] },
  "InspectionItemDefinition.status": { constants: [() => states()["INSPECTION_ITEM_DEFINITION_STATUSES"] as readonly string[]] },
  "InspectionResult.cleanliness": { constants: [() => inspection()["INSPECTION_CLEANLINESS"] as readonly string[]] },
  "InspectionResult.computedOutcome": { constants: [() => inspection()["INSPECTION_OVERALL_OUTCOMES"] as readonly string[]] },
  "InspectionResult.inputKind": { constants: [() => inspection()["INSPECTION_INPUT_KINDS"] as readonly string[]] },
  "InspectionResult.outcome": { constants: [() => inspection()["INSPECTION_OUTCOMES"] as readonly string[]] },
  "InspectionResult.outcomeSource": { constants: [() => inspection()["INSPECTION_OUTCOME_SOURCES"] as readonly string[]] },
  "InspectionResult.section": { constants: [() => inspection()["INSPECTION_SECTIONS"] as readonly string[]] },
  "InspectionSession.inspectionOutcome": { constants: [() => inspection()["INSPECTION_OVERALL_OUTCOMES"] as readonly string[]] },
  "InspectionSession.maintenanceOutcome": { constants: [() => inspection()["INSPECTION_OVERALL_OUTCOMES"] as readonly string[]] },
  "InspectionSession.recommendation": { constants: [() => inspection()["INSPECTION_RECOMMENDATIONS"] as readonly string[]] },
  "InspectionSession.status": { constants: [() => states()["INSPECTION_SESSION_STATUSES"] as readonly string[]] },
  "InspectionSessionSignature.authMethod": { constants: [() => inspection()["INSPECTION_SIGNATURE_AUTH_METHODS"] as readonly string[]] },
  "InspectionSessionSignature.kind": { constants: [() => inspection()["INSPECTION_SIGNATURE_KINDS"] as readonly string[]] },
  "InspectionSessionSignature.meaning": { constants: [() => inspection()["INSPECTION_SIGNATURE_MEANINGS"] as readonly string[]] },
  "InspectionTemplate.status": { constants: [() => states()["INSPECTION_TEMPLATE_STATUSES"] as readonly string[]] },
  "InspectionTemplateItem.inputKind": { constants: [() => inspection()["INSPECTION_INPUT_KINDS"] as readonly string[]] },
  "InspectionTemplateItem.limitOp": { constants: [() => inspection()["INSPECTION_LIMIT_OPS"] as readonly string[]] },
  "InspectionTemplateItem.origin": { constants: [() => inspection()["TEMPLATE_ITEM_ORIGINS"] as readonly string[]] },
  "InspectionTemplateItem.section": { constants: [() => inspection()["INSPECTION_SECTIONS"] as readonly string[]] },
  "InspectionTemplateProposal.kind": { constants: [() => inspection()["TEMPLATE_PROPOSAL_KINDS"] as readonly string[]] },
  "InspectionTemplateProposal.status": { constants: [() => states()["TEMPLATE_PROPOSAL_STATUSES"] as readonly string[]] },
  "InspectionTemplateVersion.status": { constants: [() => states()["TEMPLATE_VERSION_STATUSES"] as readonly string[]] },
  // The rsync image import (upstream adoption): its lifecycle, one list in @callibrator/contracts/states.
  "UpstreamFileImport.status": { constants: [() => states()["UPSTREAM_FILE_IMPORT_STATUSES"] as readonly string[]] },
  // The SQL-dump import (P24-06): its lifecycle, one list in @callibrator/contracts/states.
  "UpstreamSqlImport.status": { constants: [() => states()["UPSTREAM_SQL_IMPORT_STATUSES"] as readonly string[]] },
  "Vendor.approvalStatus": { none: NO_MIRROR },
  "Vendor.status": { none: NO_MIRROR },
  "Vendor.type": { none: NO_MIRROR },
  "Warehouse.kind": { constants: [() => deviceValues()["WAREHOUSE_KINDS"] as readonly string[]] },
  "Warehouse.status": { none: NO_MIRROR },
  "WebhookDelivery.status": { none: NO_MIRROR },
  "Workflow.resourceType": { validators: [["workflow.validator", "resourceType", "equal"]] },
  "WorkflowAction.action": { validators: [["workflow.validator", "action", "equal"]] },
  "WorkflowInstance.status": { none: NO_MIRROR },
});

describe("D-26 — every native ENUM is held to what mirrors it", () => {
  const enums = modelEnums();

  it("the registry names every ENUM attribute of every model, and nothing else", () => {
    expect(Object.keys(enums).length).toBeGreaterThan(40);
    expect(Object.keys(MIRRORS).sort()).toEqual(Object.keys(enums).sort());
  });

  it("every entry either names a mirror or says why it has none", () => {
    for (const [key, entry] of Object.entries(MIRRORS)) {
      const named = Boolean((entry.constants ?? []).length || (entry.validators ?? []).length);
      expect({ key, ok: named !== Boolean(entry.none) }).toEqual({ key, ok: true });
    }
  });

  it("a constant mirror lists exactly the model's labels, in the same order", () => {
    for (const [key, entry] of Object.entries(MIRRORS)) {
      for (const read of entry.constants ?? []) {
        expect({ key, values: [...read()] }).toEqual({ key, values: enums[key] });
      }
    }
  });

  it("a validator admits only values the column can store (and all of them where it is `equal`)", () => {
    for (const [key, entry] of Object.entries(MIRRORS)) {
      for (const [moduleName, field, relation] of entry.validators ?? []) {
        const lists = zodAllowLists(validator(moduleName), field);
        // Not vacuous: the validator really constrains this key.
        expect({ key, module: moduleName, field, found: lists.length > 0 }).toEqual({ key, module: moduleName, field, found: true });
        for (const list of lists) {
          const unstorable = list.filter((value) => !enums[key]?.includes(value));
          expect({ key, module: moduleName, unstorable }).toEqual({ key, module: moduleName, unstorable: [] });
          if (relation === "equal") {
            expect({ key, module: moduleName, values: [...list].sort() }).toEqual({ key, module: moduleName, values: [...(enums[key] ?? [])].sort() });
          }
        }
      }
    }
  });

  it("bites: a validator admitting a value the ENUM lacks is reported", () => {
    const drifted = { schema: z.object({ status: z.enum(["Open", "Reopened"]).nullable().optional() }) };
    const [list] = zodAllowLists(drifted, "status");
    const model = enums["MaintenanceWorkOrder.status"] as string[];
    expect((list as string[]).filter((value) => !model.includes(value))).toEqual(["Reopened"]);
  });
});
