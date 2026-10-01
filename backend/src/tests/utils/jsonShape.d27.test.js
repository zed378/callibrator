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
  // Amendment 1 added WebauthnCredential.transports.
  it("finds the sixteen JSON/JSONB columns (the audit's fourteen, ADR-107's signedSnapshot, ADR-108's transports)", () => {
    expect(jsonAttributes()).toHaveLength(16);
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
