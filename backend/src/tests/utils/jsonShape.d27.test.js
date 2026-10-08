/**
 * D-27 (ADR-070) — every JSON/JSONB column has a declared shape, validated on
 * write by its model.
 *
 *  1. Discovery: every JSON/JSONB attribute of every model file carries
 *     `validate.shape` for exactly its own "<Model>.<attribute>" entry, and
 *     every declared entry names a JSON attribute — so a fifteenth column, or
 *     a renamed one, fails here rather than going undeclared.
 *  2. Behaviour, through the REAL model definitions (instance.validate(), no
 *     database): the values the application's writers produce pass; the wrong
 *     shapes fail with a message naming the column.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");
const { JSON_SHAPES, jsonShape } = require("../../utils/jsonShape.util");

const MODELS_DIR = path.join(__dirname, "../../models");
const sequelize = new Sequelize({ dialect: "postgres", logging: false });

const models = {};
for (const file of fs.readdirSync(MODELS_DIR)) {
  if (!/\.model\.(js|ts)$/.test(file)) { // ADR-087 Amendment 4
    continue;
  }
  const model = require(path.join(MODELS_DIR, file))(sequelize, DataTypes);
  if (model && model.rawAttributes) {
    models[model.name] = model;
  }
}

const jsonAttributes = () => {
  const out = [];
  for (const [modelName, model] of Object.entries(models)) {
    for (const [attr, def] of Object.entries(model.rawAttributes)) {
      if (def.type instanceof DataTypes.JSON || def.type instanceof DataTypes.JSONB) {
        out.push({ key: `${modelName}.${attr}`, def });
      }
    }
  }
  return out;
};

describe("D-27 — every JSON column is declared", () => {
  // Fourteen at the D-27 audit; ADR-107 added Certificate.signedSnapshot; ADR-108
  // Amendment 1 added WebauthnCredential.transports; P20-03 (ADR-125 § 5)
  // InspectionTemplateProposal.proposedItems.
  // The rsync image import adds three, counts only: UpstreamFileImport.estimate, .progress, .summary.
  // The SQL-dump import (P24-06) adds two, counts and codes only: UpstreamSqlImport.tables, .parseSummary.
  // P20-07 (ADR-124 Am. 2) adds one, counts only: ClientFacilityMove.counts.
  it("finds the twenty-three JSON/JSONB columns (the audit's fourteen, ADR-107's signedSnapshot, ADR-108's transports, P20-03's proposedItems, the rsync import's three, the SQL-dump import's two, P20-07's move counts)", () => {
    expect(jsonAttributes()).toHaveLength(23);
  });

  it("each JSON attribute validates against its OWN declared shape", () => {
    const wrong = jsonAttributes()
      .filter(({ key, def }) => !(def.validate && def.validate.shape && def.validate.shape.shapeKey === key))
      .map(({ key }) => key);
    expect(wrong).toEqual([]);
  });

  it("every declared shape names a JSON attribute that exists", () => {
    const declared = Object.keys(JSON_SHAPES).sort();
    expect(declared).toEqual(jsonAttributes().map(({ key }) => key).sort());
  });

  it("an undeclared key is refused when the model is defined", () => {
    expect(() => jsonShape("Nope.column")).toThrow("No declared JSON shape for Nope.column");
  });
});

// Values the writers produce — each read from the writer named beside it.
const GOOD = {
  "ApiKey.scopes": [["equipment:read", "certificate:write", "equipment"], []],
  "AuditLog.changes": [{ before: { status: "draft" }, after: { status: "approved" } }, {}],
  "CalibrationDevice.uncertaintyBudget": [{ components: [{ name: "ref", u: 0.1 }] }],
  "CalibrationDevice.readingTolerance": [{ temperature: { min: 2, max: 8 } }], // iot.validator
  "CalibrationRecord.results": [{ points: [{ nominal: 10, measured: 10.01 }] }, ""], // create schema allows ""
  // ADR-107: the signing snapshot, with a device and without one.
  "Certificate.signedSnapshot": [
    {
      version: 1,
      issuer: { name: "Lab", email: "lab@x.id", phone: null, address: "Jl. A 1", city: "Jakarta", state: null, zipCode: null, country: "Indonesia", website: null },
      device: { name: "Pump", serialNumber: "SN-1", manufacturer: null, model: null },
      calibratedBy: "Ani",
      approvedBy: null,
      signedBy: "Citra",
    },
    {
      version: 1,
      issuer: { name: null, email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null },
      device: null,
      calibratedBy: null,
      approvedBy: null,
      signedBy: null,
    },
  ],
  "DsarRequest.details": [{ reason: "restriction" }, {}], // gdpr.service#createDsar default {}
  "IotReading.metrics": [{ temperature: 22, humidity: 45 }],
  "SignatureRecord.polygon": [{ points: [[0, 0], [1, 1]] }, [[0, 0], [1, 1]]],
  "SignatureRecord.biometricData": ["base64-capture", { pressure: [0.1] }], // sign schema: a string
  "Tenant.settings": [{ timezone: "Asia/Jakarta" }, {}],
  "TenantBackup.metadata": [{ version: "1.0", tenantId: "t", backupType: "full" }],
  "UsageAlert.notificationChannels": [["email"], ["email", "webhook"]],
  "Webhook.events": [["certificate.signed", "device.overdue"], ["*"]],
  "WebhookDelivery.payload": [{ event: "certificate.signed", data: { id: "c-1" } }, {}],
  // ADR-108 Amendment 1: a passkey's reported transports, or none.
  "WebauthnCredential.transports": [["internal"], ["usb", "nfc", "hybrid"], null],
  // P20-03 (ADR-125 § 5): a proposal's items — an empty list, or objects (their fields are P21-01's contract).
  "InspectionTemplateProposal.proposedItems": [[], [{ section: "function", label: "Synthetic check A", inputKind: "tri_state" }]],
  "UpstreamFileImport.estimate": [
    { files: 0, bytes: 0, classes: {} },
    { files: 4, bytes: 12000, classes: { front: { files: 3, bytes: 9000 }, serial: { files: 1, bytes: 3000 } } },
  ],
  "UpstreamFileImport.progress": [{ filesTransferred: 1, bytesTransferred: 2, filesProcessed: 0, filesToProcess: 3 }],
  "UpstreamFileImport.summary": [
    {
      filesCopied: 4,
      bytesCopied: 1,
      ingested: 3,
      bytesIngested: 1,
      skippedPresent: 0,
      duplicateContent: 0,
      metadataStripped: 2,
      quarantined: 1,
      quarantinedByReason: { file_type_refused: 1 },
      failed: 0,
      durationMs: 10,
    },
  ],
  // P24-06: per upstream table, counts and reason codes only; null before a run ends.
  "UpstreamSqlImport.tables": [
    null,
    {},
    {
      mst_faskes: { staged: true, reason: null, columns: 7, excludedColumns: 0, rowsLoaded: 118, rowsRejected: 1, rowsNotExtracted: 0, rejections: { invalid_date: 1 }, notes: { zero_date: 2 } },
      auth_logins: { staged: false, reason: "not_migrated", columns: 0, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 12, rejections: {}, notes: {} },
    },
  ],
  "UpstreamSqlImport.parseSummary": [
    null,
    { statements: { create_table: 2, insert: 5, set: 3 }, comments: 9, conditionalComments: 4, delimiterRegions: 0, truncated: false, completionMarker: true },
  ],
  // P20-07: a device move's counts per table (and attachments flagged); null while in progress.
  "ClientFacilityMove.counts": [
    null,
    {},
    { calibration_records: 3, certificates: 1, iot_readings: 0, attachments_rekey: 2 },
  ],
};

const BAD = {
  "ApiKey.scopes": [["*"], ["equipment:*"], "equipment:read", [42]],
  "AuditLog.changes": [["before", "after"], "changed", 7],
  "CalibrationDevice.uncertaintyBudget": [[1, 2], "u=0.1"],
  "CalibrationDevice.readingTolerance": [{ temperature: { mx: 8 } }, { temperature: { min: 9, max: 1 } }, []],
  "CalibrationRecord.results": [[1, 2], "ok", 3],
  // ADR-107: every key is hashed, so a missing, extra or mistyped key is refused.
  "Certificate.signedSnapshot": [
    {},
    { version: 2, issuer: {}, device: null, calibratedBy: null, approvedBy: null, signedBy: null },
    {
      version: 1,
      issuer: { name: "Lab", email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null, extra: "x" },
      device: null,
      calibratedBy: null,
      approvedBy: null,
      signedBy: null,
    },
    {
      version: 1,
      issuer: { name: 5, email: null, phone: null, address: null, city: null, state: null, zipCode: null, country: null, website: null },
      device: null,
      calibratedBy: null,
      approvedBy: null,
      signedBy: null,
    },
    "snapshot",
  ],
  "DsarRequest.details": ["reason", []],
  "IotReading.metrics": [22, [22], "22"],
  "SignatureRecord.polygon": ["M0 0 L1 1", 3],
  "SignatureRecord.biometricData": [42, [1]],
  "Tenant.settings": [[], "x"],
  "TenantBackup.metadata": ["v1", []],
  "UsageAlert.notificationChannels": [["sms"], "email"],
  "Webhook.events": [["Certificate Signed"], "certificate.signed", [""]],
  "WebhookDelivery.payload": ["{}", []],
  "WebauthnCredential.transports": [["bluetooth"], "usb", [1], ["usb", "usb", "usb", "usb", "usb", "usb", "usb", "usb"]],
  "InspectionTemplateProposal.proposedItems": [{}, ["label"], [[]], Array.from({ length: 101 }, () => ({}))],
  // Counts only: a file name smuggled in as a key, a negative or fractional count, a class that is not one.
  "UpstreamFileImport.estimate": [{ files: 1, bytes: 1 }, { files: 1, bytes: 1, classes: { inventory: { files: 1, bytes: 1 } } }, { files: -1, bytes: 0, classes: {} }],
  "UpstreamFileImport.progress": [{ filesTransferred: 1 }, { filesTransferred: 1.5, bytesTransferred: 0, filesProcessed: 0, filesToProcess: 0 }],
  "UpstreamFileImport.summary": [
    { filesCopied: 1 },
    {
      filesCopied: 1, bytesCopied: 1, ingested: 1, bytesIngested: 1, skippedPresent: 0, duplicateContent: 0, metadataStripped: 0,
      quarantined: 1, quarantinedByReason: { "foto_depan/IMG_0001.jpg": 1 }, failed: 0, durationMs: 1,
    },
    {
      filesCopied: 1, bytesCopied: 1, ingested: 1, bytesIngested: 1, skippedPresent: 0, duplicateContent: 0, metadataStripped: 0,
      quarantined: 0, quarantinedByReason: {}, failed: 0, durationMs: 1, fileNames: ["x.jpg"],
    },
  ],
  // P24-06: a value smuggled in as a key or a field, a name that is not an identifier, a negative count.
  "UpstreamSqlImport.tables": [
    { t: { staged: true } },
    { "users; DROP": { staged: true, reason: null, columns: 0, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 0, rejections: {}, notes: {} } },
    { t: { staged: true, reason: "Synthetic Name", columns: 0, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 0, rejections: {}, notes: {} } },
    { t: { staged: true, reason: null, columns: 0, excludedColumns: 0, rowsLoaded: -1, rowsRejected: 0, rowsNotExtracted: 0, rejections: {}, notes: {}, sample: "x" } },
  ],
  "UpstreamSqlImport.parseSummary": [
    { comments: 1 },
    { statements: {}, comments: 0, conditionalComments: 0, delimiterRegions: 0, truncated: false, completionMarker: false, firstRow: "x" },
  ],
  // P20-07: a negative or fractional count, a name that is not a table identifier, a value smuggled in.
  "ClientFacilityMove.counts": [
    { calibration_records: -1 },
    { calibration_records: 1.5 },
    { "Synthetic Name": 1 },
    { certificates: "x" },
  ],
};

const buildWith = (key, value) => {
  const [modelName, attr] = key.split(".");
  return models[modelName].build({ [attr]: value });
};

const shapeErrors = async (key, value) => {
  const attr = key.split(".")[1];
  try {
    await buildWith(key, value).validate({ fields: [attr] });
    return [];
  } catch (err) {
    return err.errors.filter((e) => e.path === attr).map((e) => e.message);
  }
};

describe("D-27 — the models accept what the writers write", () => {
  it.each(Object.entries(GOOD).flatMap(([key, values]) => values.map((v) => [key, v])))(
    "%s accepts %j",
    async (key, value) => {
      expect(await shapeErrors(key, value)).toEqual([]);
    },
  );
});

describe("D-27 — and refuse the wrong shape, naming the column", () => {
  it.each(Object.entries(BAD).flatMap(([key, values]) => values.map((v) => [key, v])))(
    "%s refuses %j",
    async (key, value) => {
      const errors = await shapeErrors(key, value);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`${key} has the wrong shape`);
    },
  );

  // P6-02: a correction copies a record's `results` — null when the record had
  // none — and the shape check refused the null with a 500. Nullness belongs
  // to `allowNull`, not the shape.
  it.each(jsonAttributes().map(({ key, def }) => [key, def.allowNull !== false]))(
    "%s: null is decided by allowNull (nullable: %s), never by the shape",
    async (key, nullable) => {
      const attr = key.split(".")[1];
      let messages = [];
      try {
        await buildWith(key, null).validate({ fields: [attr] });
      } catch (err) {
        messages = err.errors.filter((e) => e.path === attr).map((e) => e.message);
      }
      expect(messages.some((m) => m.includes("wrong shape"))).toBe(false);
      expect(messages.length > 0).toBe(!nullable);
    },
  );

  it("the shape validator itself passes null through", () => {
    expect(() => jsonShape("CalibrationRecord.results")(null)).not.toThrow();
    expect(() => jsonShape("CalibrationRecord.results")(3)).toThrow("wrong shape");
  });

  it("every declared column has good AND bad fixtures here", () => {
    expect(Object.keys(GOOD).sort()).toEqual(Object.keys(JSON_SHAPES).sort());
    expect(Object.keys(BAD).sort()).toEqual(Object.keys(JSON_SHAPES).sort());
  });
});
