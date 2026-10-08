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

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const { z } = require("zod");
const models = require("../../models");

const allModels = [...new Set(Object.values(models.sequelize.models))];

/** `{ "Model.attr": ["value", …] }` for every ENUM attribute of every model. */
const modelEnums = () => {
  const out = {};
  for (const Model of allModels) {
    for (const [attr, def] of Object.entries(Model.getAttributes())) {
      if (def.type && def.type.key === "ENUM") {
        out[`${Model.name}.${attr}`] = [...def.type.values];
      }
    }
  }
  return out;
};

const validator = (name) => require(`../../validators/${name}`);
const constant = (name) => require(`../../constants/${name}`);
const states = () => require("@callibrator/contracts/states");
const inspection = () => require("@callibrator/contracts/inspectionValues");

/**
 * The enum values a field schema restricts to, looking through the wrappers
 * the validators use (optional, nullable, default, a pipe that folds case, a
 * union with "" or null, an array's items). `null` and `""` are not values: on
 * a query schema they mean "no filter". Null when the field is not an enum.
 *
 * @param {import("zod").ZodType} schema - a field schema
 * @returns {string[]|null} the values
 */
const enumValues = (schema) => {
  if (schema instanceof z.ZodEnum) {
    return [...schema.options];
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return enumValues(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return enumValues(schema.def.innerType);
  }
  if (schema instanceof z.ZodPipe) {
    return enumValues(schema.def.out) ?? enumValues(schema.def.in);
  }
  if (schema instanceof z.ZodArray) {
    return enumValues(schema.element);
  }
  if (schema instanceof z.ZodUnion) {
    const lists = schema.options.map(enumValues).filter(Boolean);
    return lists.length ? lists.flat() : null;
  }
  return null;
};

/**
 * Every enum list for `key` across a validator module's exported object
 * schemas (an array schema's item list counts).
 */
const zodAllowLists = (mod, key) =>
  Object.values(mod)
    .filter((schema) => schema instanceof z.ZodObject && schema.shape[key])
    .map((schema) => enumValues(schema.shape[key]))
    .filter(Boolean);

const NO_MIRROR = "no shared list: only service code writes this column, from its own literals";

/**
 * Each ENUM attribute: its constant mirrors (equal, ordered), its validator
 * mirrors ([module, key, "equal"|"subset"]), or `none` with the reason.
 */
const MIRRORS = Object.freeze({
  // P10-05 (ADR-098 §6): one list per ENUM in constants/accessRequest.ts, read
  // by the model, migration 0099 and the validator.
  "AccessRequest.deviceCountBand": { constants: [() => constant("accessRequest").DEVICE_COUNT_BANDS] },
  "AccessRequest.facilityType": { constants: [() => constant("accessRequest").FACILITY_TYPES] },
  "AccessRequest.locale": { constants: [() => constant("accessRequest").REQUEST_LOCALES] },
  "AccessRequest.status": { constants: [() => constant("accessRequest").ACCESS_REQUEST_STATUSES] },
  "AssetFinance.depreciationMethod": { validators: [["finance.validator", "depreciationMethod", "equal"]] },
  "AuditLog.action": {
    constants: [
      () => constant("auditActions").AUDIT_ACTIONS,
      () => constant("index").AUDIT_ACTIONS,
    ],
  },
  "AuditLog.actorType": { constants: [() => constant("systemActors").ACTOR_TYPE_VALUES] },
  "BatchJob.status": { none: NO_MIRROR },
  "CalibrationDevice.status": { validators: [["calibrationDevices.validator", "status", "equal"]] },
  // qms.validator spreads these same constants; its `status` key is shared
  // by the non-conformance and CAPA schemas, so the constant is the mirror.
  "Capa.status": { constants: [() => constant("qmsConstants").CAPA_STATUSES] },
  "Certificate.status": {
    constants: [
      () => Object.values(models.Certificate.STATUS),
      () => validator("certificate.validator").CERTIFICATE_STATUS,
    ],
  },
  "Certificate.type": {
    constants: [
      () => Object.values(models.Certificate.CERTIFICATE_TYPES),
      () => validator("certificate.validator").CERTIFICATE_TYPES,
    ],
  },
  // P20-07 (ADR-124 Am. 2): the client facility's kind and lifecycle, and the move's — one list each in
  // @callibrator/contracts/states.
  "ClientFacility.kind": { constants: [() => states().CLIENT_FACILITY_KINDS] },
  "ClientFacility.status": { constants: [() => states().CLIENT_FACILITY_STATUSES] },
  "ClientFacilityMove.status": { constants: [() => states().CLIENT_FACILITY_MOVE_STATUSES] },
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
    constants: [() => constant("qmsConstants").NC_SEVERITIES],
    validators: [["qms.validator", "severity", "equal"]],
  },
  "NonConformance.status": { constants: [() => constant("qmsConstants").NC_STATUSES] },
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
  "Tenant.status": { constants: [() => Object.values(constant("tenantStatus").TENANT_STATUS)] },
  "TenantBackup.status": { constants: [() => Object.values(models.TenantBackup.STATUS)] },
  "UsageAlert.comparison": { validators: [["meteredBilling.validator", "comparison", "equal"]] },
  // P20-01 / P20-03 (ADR-125 Am. 1): the catalogue's vocabularies and state
  // tuples live once in @callibrator/contracts (states.ts, inspectionValues.ts),
  // read by the models, migrations 0111/0112 and (P21-01) the request schemas.
  "DeviceType.status": { constants: [() => states().DEVICE_TYPE_STATUSES] },
  // P20-04 (ADR-126 Am. 1–2): the idempotency key's two states and the IPM aggregate's vocabularies.
  "IdempotencyKey.status": { constants: [() => states().IDEMPOTENCY_KEY_STATUSES] },
  "InspectionItemDefinition.inputKind": { constants: [() => inspection().INSPECTION_INPUT_KINDS] },
  "InspectionItemDefinition.limitOp": { constants: [() => inspection().INSPECTION_LIMIT_OPS] },
  "InspectionItemDefinition.section": { constants: [() => inspection().INSPECTION_SECTIONS] },
  "InspectionItemDefinition.status": { constants: [() => states().INSPECTION_ITEM_DEFINITION_STATUSES] },
  "InspectionResult.cleanliness": { constants: [() => inspection().INSPECTION_CLEANLINESS] },
  "InspectionResult.computedOutcome": { constants: [() => inspection().INSPECTION_OVERALL_OUTCOMES] },
  "InspectionResult.inputKind": { constants: [() => inspection().INSPECTION_INPUT_KINDS] },
  "InspectionResult.outcome": { constants: [() => inspection().INSPECTION_OUTCOMES] },
  "InspectionResult.outcomeSource": { constants: [() => inspection().INSPECTION_OUTCOME_SOURCES] },
  "InspectionResult.section": { constants: [() => inspection().INSPECTION_SECTIONS] },
  "InspectionSession.inspectionOutcome": { constants: [() => inspection().INSPECTION_OVERALL_OUTCOMES] },
  "InspectionSession.maintenanceOutcome": { constants: [() => inspection().INSPECTION_OVERALL_OUTCOMES] },
  "InspectionSession.recommendation": { constants: [() => inspection().INSPECTION_RECOMMENDATIONS] },
  "InspectionSession.status": { constants: [() => states().INSPECTION_SESSION_STATUSES] },
  "InspectionSessionSignature.authMethod": { constants: [() => inspection().INSPECTION_SIGNATURE_AUTH_METHODS] },
  "InspectionSessionSignature.kind": { constants: [() => inspection().INSPECTION_SIGNATURE_KINDS] },
  "InspectionSessionSignature.meaning": { constants: [() => inspection().INSPECTION_SIGNATURE_MEANINGS] },
  "InspectionTemplate.status": { constants: [() => states().INSPECTION_TEMPLATE_STATUSES] },
  "InspectionTemplateItem.inputKind": { constants: [() => inspection().INSPECTION_INPUT_KINDS] },
  "InspectionTemplateItem.limitOp": { constants: [() => inspection().INSPECTION_LIMIT_OPS] },
  "InspectionTemplateItem.origin": { constants: [() => inspection().TEMPLATE_ITEM_ORIGINS] },
  "InspectionTemplateItem.section": { constants: [() => inspection().INSPECTION_SECTIONS] },
  "InspectionTemplateProposal.kind": { constants: [() => inspection().TEMPLATE_PROPOSAL_KINDS] },
  "InspectionTemplateProposal.status": { constants: [() => states().TEMPLATE_PROPOSAL_STATUSES] },
  "InspectionTemplateVersion.status": { constants: [() => states().TEMPLATE_VERSION_STATUSES] },
  // The rsync image import (upstream adoption): its lifecycle, one list in @callibrator/contracts/states.
  "UpstreamFileImport.status": { constants: [() => states().UPSTREAM_FILE_IMPORT_STATUSES] },
  // The SQL-dump import (P24-06): its lifecycle, one list in @callibrator/contracts/states.
  "UpstreamSqlImport.status": { constants: [() => states().UPSTREAM_SQL_IMPORT_STATUSES] },
  "Vendor.approvalStatus": { none: NO_MIRROR },
  "Vendor.status": { none: NO_MIRROR },
  "Vendor.type": { none: NO_MIRROR },
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
      const named = Boolean((entry.constants || []).length || (entry.validators || []).length);
      expect({ key, ok: named !== Boolean(entry.none) }).toEqual({ key, ok: true });
    }
  });

  it("a constant mirror lists exactly the model's labels, in the same order", () => {
    for (const [key, entry] of Object.entries(MIRRORS)) {
      for (const read of entry.constants || []) {
        expect({ key, values: [...read()] }).toEqual({ key, values: enums[key] });
      }
    }
  });

  it("a validator admits only values the column can store (and all of them where it is `equal`)", () => {
    for (const [key, entry] of Object.entries(MIRRORS)) {
      for (const [module, field, relation] of entry.validators || []) {
        const lists = zodAllowLists(validator(module), field);
        // Not vacuous: the validator really constrains this key.
        expect({ key, module, field, found: lists.length > 0 }).toEqual({ key, module, field, found: true });
        for (const list of lists) {
          const unstorable = list.filter((value) => !enums[key].includes(value));
          expect({ key, module, unstorable }).toEqual({ key, module, unstorable: [] });
          if (relation === "equal") {
            expect({ key, module, values: [...list].sort() }).toEqual({ key, module, values: [...enums[key]].sort() });
          }
        }
      }
    }
  });

  it("bites: a validator admitting a value the ENUM lacks is reported", () => {
    const drifted = { schema: z.object({ status: z.enum(["Open", "Reopened"]).nullable().optional() }) };
    const [list] = zodAllowLists(drifted, "status");
    const model = enums["MaintenanceWorkOrder.status"];
    expect(list.filter((value) => !model.includes(value))).toEqual(["Reopened"]);
  });
});
