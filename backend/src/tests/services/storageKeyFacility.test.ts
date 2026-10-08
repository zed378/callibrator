/**
 * P21-09d — G-23 (spec P19-04 § 9.3): the facility segment of a storage key.
 *
 *  - `buildKey` writes `t/<tenant>/f/<facility>/<domain>/<name>` for a facility-owned file, the
 *    facility UUID-validated and only for `attachments` / `branding`; without a facility the key is
 *    exactly as before (a provider-internal or legacy file); `assertKeyForTenant` is unchanged;
 *  - `facilityOfKey` reads the segment back, null for a key without one (or a malformed one);
 *  - an upload linked to a record of a facility is stored under that facility's segment, and the
 *    row names the facility; a standalone upload keeps the tenant key.
 */
jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../models", () => ({
  Attachment: { create: jest.fn(), findOne: jest.fn() },
  Certificate: { findOne: jest.fn() },
  CalibrationDevice: { findOne: jest.fn(), rawAttributes: { isDeleted: {}, clientFacilityId: {} } },
  AuditLog: { create: jest.fn() },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn((cb: (t: string) => unknown) => cb("TX")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(() => Promise.resolve({})) }));
jest.mock("../../utils/upload.util", () => ({
  assertInQuarantine: jest.fn((p: string) => p),
  getUploadUrl: (fileName: string, folder: string) => `/${folder}/${fileName}`,
}));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn(() => Promise.resolve({ clean: true })) }));
jest.mock("../../services/storedFile.service", () => ({ putLocalFile: jest.fn(() => Promise.resolve()) }));
jest.mock("fs", () => {
  const actual = jest.requireActual<typeof FsModule>("fs");
  return {
    ...actual,
    createReadStream: jest.fn(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- inside a mock factory
      const { EventEmitter } = require("events") as typeof EventsModule;
      const emitter = new EventEmitter();
      setImmediate(() => {
        emitter.emit("data", Buffer.from("x"));
        emitter.emit("end");
      });
      return emitter;
    }),
    promises: { ...actual.promises, unlink: jest.fn(() => Promise.resolve()) },
  };
});

import keys from "../../services/storage/keys";
import type * as FsModule from "fs";
import type * as EventsModule from "events";
import type * as AttachmentService from "../../services/attachment.service";

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const DEVICE = "d1d1d1d1-0000-4000-8000-000000000001";

describe("G-23 storage keys — the facility segment", () => {
  it("a facility-owned key, and the unchanged tenant key without one", () => {
    expect(keys.buildKey({ tenantId: T, clientFacilityId: F1, domain: "attachments", name: "a.pdf" })).toBe(`t/${T}/f/${F1}/attachments/a.pdf`);
    expect(keys.buildKey({ tenantId: T, clientFacilityId: F1, domain: "branding", name: "logo.png" })).toBe(`t/${T}/f/${F1}/branding/logo.png`);
    expect(keys.buildKey({ tenantId: T, domain: "attachments", name: "a.pdf" })).toBe(`t/${T}/attachments/a.pdf`);
    expect(keys.buildKey({ tenantId: T, clientFacilityId: null, domain: "attachments", name: "a.pdf" })).toBe(`t/${T}/attachments/a.pdf`);
  });

  it.each([
    ["a facility that is not a UUID", { tenantId: T, clientFacilityId: "../x", domain: "attachments", name: "a.pdf" }],
    ["a facility under no tenant", { tenantId: null, clientFacilityId: F1, domain: "attachments", name: "a.pdf" }],
    ["a facility on a provider domain", { tenantId: T, clientFacilityId: F1, domain: "backups", name: "a.gz" }],
  ])("refuses %s (400)", (_label, input) => {
    expect(() => keys.buildKey(input)).toThrow(expect.objectContaining({ status: 400 }) as Error);
  });

  it("a facility key still belongs to its tenant, and to no other", () => {
    const key = keys.buildKey({ tenantId: T, clientFacilityId: F1, domain: "attachments", name: "a.pdf" });
    expect(keys.assertKeyForTenant(key, T)).toBe(key);
    expect(() => keys.assertKeyForTenant(key, "bbbbbbbb-0000-4000-8000-000000000002")).toThrow();
  });

  it("facilityOfKey reads the segment; null for a legacy, global or malformed key", () => {
    expect(keys.facilityOfKey(`t/${T}/f/${F1}/attachments/a.pdf`)).toBe(F1);
    expect(keys.facilityOfKey(`t/${T}/attachments/a.pdf`)).toBeNull();
    expect(keys.facilityOfKey("global/branding/logo.png")).toBeNull();
    expect(keys.facilityOfKey(`t/${T}/f/not-a-uuid/attachments/a.pdf`)).toBeNull();
    expect(keys.facilityOfKey(`t/${T}/f/${F1}`)).toBeNull();
    expect(keys.facilityOfKey(`t/${T}/f`)).toBeNull();
    expect(keys.facilityOfKey(42)).toBeNull();
  });
});

describe("G-23 an upload is stored under its record's facility", () => {
  const models = jest.requireMock<Record<string, { findOne: jest.Mock; create: jest.Mock }>>("../../models");
  const service = jest.requireActual<typeof AttachmentService>("../../services/attachment.service");
  const storage = jest.requireMock<{ __objects: Map<string, unknown>; __reset(): void }>("../../services/storage");
  const createdValues = (): Record<string, unknown> =>
    ((models["Attachment"] as { create: jest.Mock<Promise<unknown>, [Record<string, unknown>]> }).create.mock.calls[0]?.[0]) ?? {};
  const file = { path: "/q/f.pdf", filename: "f.pdf", originalname: "F.pdf", mimetype: "application/pdf", size: 1 };

  beforeEach(() => {
    storage.__reset();
    (models["Attachment"] as { create: jest.Mock }).create.mockImplementation((values: Record<string, unknown>) =>
      Promise.resolve({ id: "att-1", folder: "uploads/attachments", ...values }),
    );
  });

  it("a device photo in F1: key `t/<tenant>/f/<F1>/attachments/…`, the row names F1", async () => {
    (models["CalibrationDevice"] as { findOne: jest.Mock }).findOne.mockResolvedValue({ id: DEVICE, clientFacilityId: F1 });
    const created = await service.createAttachment(T, file, { resourceType: "device", resourceId: DEVICE, uploadedBy: "u-1" });
    expect((models["CalibrationDevice"] as { findOne: jest.Mock }).findOne).toHaveBeenCalledWith({
      where: { id: DEVICE, tenantId: T, isDeleted: false },
      attributes: ["id", "clientFacilityId"],
    });
    const values = createdValues();
    expect(values["storageKey"]).toBe(`t/${T}/f/${F1}/attachments/f.pdf`);
    expect(values["clientFacilityId"]).toBe(F1);
    expect(created).toMatchObject({ resourceType: "device", resourceId: DEVICE });
  });

  it("a standalone upload keeps the tenant key and names no facility", async () => {
    await service.createAttachment(T, file, { resourceType: "generic", uploadedBy: "u-1" });
    const values = createdValues();
    expect(values["storageKey"]).toBe(`t/${T}/attachments/f.pdf`);
    expect(values).not.toHaveProperty("clientFacilityId");
  });
});
