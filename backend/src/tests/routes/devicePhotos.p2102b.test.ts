/**
 * P21-02b — the device photos (spec P19-03 § 7.2, § 11; ADR-132 Am. 3; 08-FILE-POLICY § 2 – § 5):
 *
 *  - an upload stores the original (location metadata removed) and two metadata-free derivatives
 *    under the DEVICE's facility, with its purpose, its audit row and its facility stamped;
 *  - a front / serial-plate photo REPLACES the live one in one transaction (the old row soft-
 *    deleted, three audit rows); `device_other` accumulates;
 *  - refusals by CONTENT, each a top-level code: HEIC 415, another type 415, too small / not
 *    decoding / over the pixel limit 422, a virus 422, no file 400, an IPM purpose 400 — and
 *    nothing stored for any of them;
 *  - a failed put or a failed transaction leaves no object;
 *  - a replayed upload stores one photo; a bound F1 technician uploads to F1's device (N-6);
 *  - the delete is a soft delete, audited; a photo of another device, or no photo, is a 404;
 *  - the derivatives open through a signed link bound to its variant; the generic delete, the
 *    deleted-file sweep and the device move's re-key carry them with the original.
 *
 * REAL: the router chain, the controller, devicePhoto.service, the image pipeline, attachment.service,
 * the hooks over memoryDb, the fake storage (real key rules). DOUBLED: multer (a real temporary file
 * as `req.file`), the quota check, the quarantine guard, the virus scan.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as DevicesRoute from "../../routes/api/calibrationDevices.route";
import type * as AttachmentsRoute from "../../routes/api/attachments.route";
import type AttachmentServiceModule from "../../services/attachment.service";
import type * as Derivatives from "../../services/devicePhoto/imageDerivatives";
import type AuditServiceModule from "../../services/audit.service";
import type * as RekeyModule from "../../services/attachmentRekey.service";
import type SweepModule from "../../services/attachmentFileSweep.service";
import type * as PhotoService from "../../services/devicePhoto.service";
import type ModelsModule from "../../models";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import { GPS_MARKER, exifSegment, heic, jpeg, png } from "../fixtures/photoFixtures";

jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
}));
jest.mock("../../utils/upload.util", () => ({
  ...jest.requireActual<object>("../../utils/upload.util"),
  upload: () => (_req: Request, _res: Response, next: NextFunction) => {
    next();
  },
  assertInQuarantine: (p: string) => p,
}));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn(() => Promise.resolve({ clean: true })) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const storage = jest.requireMock<FakeStorageModule>("../../services/storage");
const virusScan = jest.requireMock<{ scanFile: jest.Mock }>("../../services/virusScan.service");
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const devices = jest.requireActual<typeof DevicesRoute>("../../routes/api/calibrationDevices.route");
const attachmentsRouter = jest.requireActual<typeof AttachmentsRoute>("../../routes/api/attachments.route");
const attachmentService = jest.requireActual<typeof AttachmentServiceModule>("../../services/attachment.service");
const derivatives = jest.requireActual<typeof Derivatives>("../../services/devicePhoto/imageDerivatives");
const auditService = jest.requireActual<typeof AuditServiceModule>("../../services/audit.service");
const rekey = jest.requireActual<typeof RekeyModule>("../../services/attachmentRekey.service");
const sweep = jest.requireActual<typeof SweepModule>("../../services/attachmentFileSweep.service");
const photoService = jest.requireActual<typeof PhotoService>("../../services/devicePhoto.service");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const KEY = "2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2b02";
interface Res { status: number; body: { code?: string; message?: string; data?: Record<string, unknown> } }

let world: IpmWorld;
let tmp = "";

const held = (bytes: Buffer): Record<string, unknown> => {
  const file = path.join(tmp, `photo-${String(Math.random()).slice(2)}.bin`);
  fs.writeFileSync(file, bytes);
  return { path: file, filename: path.basename(file), originalname: "IMG_0001.jpg", mimetype: "image/jpeg", size: bytes.length };
};

const upload = async (
  who: Principal,
  device: string,
  purpose: string,
  bytes: Buffer | null,
  opts: { key?: string } = {},
): Promise<Res> => {
  as(who);
  return (await call(devices, "POST", `/${device}/photos`, {
    body: { purpose },
    headers: opts.key ? { "Idempotency-Key": opts.key } : {},
    routeFile: "api/calibrationDevices.route.ts",
    baseUrl: "/api/v1/calibration-devices",
    ...(bytes ? { file: held(bytes) } : {}),
  })) as Res;
};

const remove = async (who: Principal, device: string, attachmentId: string): Promise<Res> => {
  as(who);
  return (await call(devices, "DELETE", `/${device}/photos/${attachmentId}`, {
    routeFile: "api/calibrationDevices.route.ts",
    baseUrl: "/api/v1/calibration-devices",
  })) as Res;
};

const keys = (): string[] => [...storage.__objects.keys()].sort();
const live = (): Record<string, unknown>[] => mdb.rows("Attachment").filter((r) => r["isDeleted"] !== true);
const audits = (): Record<string, unknown>[] => mdb.rows("AuditLog");
const operations = (): unknown[] => audits().map((a) => [a["action"], a["resourceType"], (a["changes"] as Record<string, unknown> | null)?.["operation"]]);

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2102b-photo-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  mdb.reset();
  storage.__reset();
  grantAllMenus();
  virusScan.scanFile.mockClear();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an upload (08 § 2 – § 4)", () => {
  it("201: the original without its GPS, two derivatives, under the device's facility; the row and its audit row", async () => {
    const source = jpeg(1800, 1200, [exifSegment({ orientation: 1 })]);
    const res = await upload(world.staff, IPM.D1, "device_front", source);

    expect(res.status).toBe(201);
    const id = res.body.data?.["id"] as string;
    expect(res.body.data).toMatchObject({ calibrationDeviceId: IPM.D1, purpose: "device_front", mimeType: "image/jpeg", width: 1800, height: 1200, variants: ["original", "display", "thumb"], replacedAttachmentId: null });
    const prefix = `t/${world.tenantA}/f/${IPM.F1}/attachments/${id}`;
    expect(keys()).toEqual([`${prefix}.display.jpg`, `${prefix}.jpg`, `${prefix}.thumb.jpg`]);
    const original = storage.__objects.get(`${prefix}.jpg`)?.body as Buffer;
    expect(original.includes(GPS_MARKER)).toBe(false);
    expect(source.includes(GPS_MARKER)).toBe(true);
    expect(mdb.rows("Attachment")).toEqual([
      expect.objectContaining({ id, resourceType: "device", resourceId: IPM.D1, purpose: "device_front", clientFacilityId: IPM.F1, storageKey: `${prefix}.jpg`, originalName: "device_front.jpg", mimeType: "image/jpeg" }),
    ]);
    expect(operations()).toEqual([["CREATE", "Attachment", "UPLOAD_DEVICE_PHOTO"]]);
    expect(JSON.stringify(audits())).not.toContain("IMG_0001");
    expect(virusScan.scanFile).toHaveBeenCalledTimes(1);
  });

  it("a PNG is stored as .png with JPEG derivatives", async () => {
    const res = await upload(world.staff, IPM.D1, "device_other", png(64, 48, { text: true }));
    expect([res.status, res.body.data?.["mimeType"]]).toEqual([201, "image/png"]);
    expect(keys().filter((k) => k.endsWith(".png"))).toHaveLength(1);
  });

  it("the replace (F-28): one live front photo; the old row soft-deleted; three audit rows; device_other accumulates", async () => {
    const first = await upload(world.staff, IPM.D1, "device_front", jpeg(32, 32));
    const second = await upload(world.staff, IPM.D1, "device_front", jpeg(40, 40));
    expect([first.status, second.status, second.body.message, second.body.data?.["replacedAttachmentId"]]).toEqual([201, 201, "Device photo replaced", first.body.data?.["id"]]);
    expect(live().map((r) => r["id"])).toEqual([second.body.data?.["id"]]);
    expect(operations()).toEqual([
      ["CREATE", "Attachment", "UPLOAD_DEVICE_PHOTO"],
      ["DELETE", "Attachment", "REPLACE_DEVICE_PHOTO"],
      ["CREATE", "Attachment", "UPLOAD_DEVICE_PHOTO"],
      ["UPDATE", "CalibrationDevice", "REPLACE_DEVICE_PHOTO"],
    ]);
    // The replaced photo's bytes stay for the sweep (ADR-083): six objects.
    expect(keys()).toHaveLength(6);

    await upload(world.staff, IPM.D1, "device_other", jpeg(16, 16));
    await upload(world.staff, IPM.D1, "device_other", jpeg(16, 16));
    expect(live().filter((r) => r["purpose"] === "device_other")).toHaveLength(2);
  });

  it("a bound F1 technician uploads to F1's device (N-6); the photo is F1's", async () => {
    const res = await upload(world.bound, IPM.D1, "device_serial_plate", jpeg(24, 24));
    expect(res.status).toBe(201);
    expect(mdb.rows("Attachment")[0]).toMatchObject({ clientFacilityId: IPM.F1, uploadedBy: IPM.BOUND });
  });

  it("a replayed upload (Idempotency-Key) answers the same photo and stores one", async () => {
    const bytes = jpeg(20, 20);
    const first = await upload(world.staff, IPM.D1, "device_front", bytes, { key: KEY });
    const again = await upload(world.staff, IPM.D1, "device_front", bytes, { key: KEY });
    expect([first.status, again.status, again.body.data?.["id"], again.body.data?.["purpose"]]).toEqual([201, 201, first.body.data?.["id"], "device_front"]);
    expect(mdb.rows("Attachment")).toHaveLength(1);
  });
});

describe("refusals by content — a top-level code, nothing stored", () => {
  const big = (): Buffer => {
    // A structurally valid JPEG whose frame header claims 13,000 × 100 px (over 12,000 a side).
    const small = jpeg(8, 8);
    const at = small.indexOf(Buffer.from([0xff, 0xc0]));
    const out = Buffer.from(small);
    out.writeUInt16BE(100, at + 5);
    out.writeUInt16BE(13000, at + 7);
    return Buffer.concat([out, Buffer.alloc(1024)]);
  };
  const corrupt = (): Buffer => {
    const good = jpeg(64, 64);
    return Buffer.concat([good.subarray(0, good.length - 300), Buffer.alloc(298, 0xff), Buffer.from([0xff, 0xd9])]);
  };

  it.each([
    ["HEIC", (): Buffer => heic(), 415, "PHOTO_HEIC_UNSUPPORTED"],
    ["a GIF", (): Buffer => Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(2048)]), 415, "PHOTO_TYPE_UNSUPPORTED"],
    ["a 600-byte JPEG", (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(597)]), 422, "PHOTO_UNDECODABLE"],
    ["a JPEG without a frame", (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), Buffer.alloc(2048)]), 422, "PHOTO_UNDECODABLE"],
    ["over the pixel limit", big, 422, "PHOTO_IMAGE_TOO_LARGE"],
    ["pixels that do not decode", corrupt, 422, "PHOTO_UNDECODABLE"],
  ])("%s → %i %s", async (_name, bytes, status, code) => {
    const res = await upload(world.staff, IPM.D1, "device_front", bytes());
    expect([res.status, res.body.code]).toEqual([status, code]);
    expect([keys(), mdb.rows("Attachment"), audits()]).toEqual([[], [], []]);
  });

  it("a virus → 422 PHOTO_REJECTED_BY_SCAN", async () => {
    virusScan.scanFile.mockResolvedValueOnce({ clean: false, reason: "Eicar-Test-Signature" });
    const res = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    expect([res.status, res.body.code, keys()]).toEqual([422, "PHOTO_REJECTED_BY_SCAN", []]);
  });

  it("no file → 400 PHOTO_FILE_REQUIRED; an IPM purpose or an unknown field → 400", async () => {
    const none = await upload(world.staff, IPM.D1, "device_front", null);
    const ipm = await upload(world.staff, IPM.D1, "ipm_evidence", jpeg(16, 16));
    expect([none.status, none.body.code, ipm.status]).toEqual([400, "PHOTO_FILE_REQUIRED", 400]);
    expect(keys()).toEqual([]);
  });

  it("a failure other than a decode is not dressed as one (500), and stores nothing", async () => {
    jest.spyOn(derivatives, "buildDerivatives").mockImplementationOnce(() => {
      throw new Error("out of memory");
    });
    const res = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    expect([res.status, keys()]).toEqual([500, []]);
  });
});

describe("a failure after the bytes leaves no object", () => {
  it("a put that fails part-way removes what was written", async () => {
    const scoped = await storage.getTenantStorage(world.tenantA);
    storage.getTenantStorage.mockResolvedValueOnce({
      ...scoped,
      put: jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("disk full")),
      delete: jest.fn().mockResolvedValue({}),
    });
    const res = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    expect(res.status).toBe(500);
    expect(mdb.rows("Attachment")).toEqual([]);
  });

  it("a transaction that fails (the audit write) removes the three objects", async () => {
    jest.spyOn(auditService, "logAction").mockRejectedValueOnce(new Error("audit down"));
    const res = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    expect([res.status, keys(), mdb.rows("Attachment")]).toEqual([500, [], []]);
  });
});

describe("the device gone between the check and the transaction; the replay reader", () => {
  it("a device deleted after the bytes were checked is a 404, and the objects are removed", async () => {
    const real = models.CalibrationDevice.findOne.bind(models.CalibrationDevice);
    jest.spyOn(models.CalibrationDevice, "findOne").mockImplementationOnce(real).mockResolvedValueOnce(null);
    const res = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    expect([res.status, res.body.message, keys()]).toEqual([404, "Calibration device not found", []]);
  });

  it("the replay reader answers a photo that is gone from view with a 404", async () => {
    await expect(photoService.readDevicePhoto("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).rejects.toMatchObject({ status: 404 });
  });
});

describe("the delete (a soft delete, audited)", () => {
  it("200; the row soft-deleted with DELETE_DEVICE_PHOTO; the bytes stay for the sweep", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    const id = up.body.data?.["id"] as string;
    const res = await remove(world.staff, IPM.D1, id);
    expect([res.status, res.body.data]).toEqual([200, { id }]);
    expect(live()).toEqual([]);
    expect(operations()).toEqual([
      ["CREATE", "Attachment", "UPLOAD_DEVICE_PHOTO"],
      ["DELETE", "Attachment", "DELETE_DEVICE_PHOTO"],
    ]);
    expect(keys()).toHaveLength(3);
  });

  it("a photo of another device, a document that is no photo, a missing id → the same 404", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    const id = up.body.data?.["id"] as string;
    mdb.seed("Attachment", { id: "a7000000-0000-4000-8000-0000000002b1", tenantId: world.tenantA, clientFacilityId: IPM.F1, resourceType: "device", resourceId: IPM.D1, purpose: null, fileName: "m.pdf", originalName: "m.pdf", folder: "uploads/attachments", mimeType: "application/pdf", size: 3, uploadedBy: null });
    const otherDevice = await remove(world.staff, IPM.D2, id);
    const document = await remove(world.staff, IPM.D1, "a7000000-0000-4000-8000-0000000002b1");
    const missing = await remove(world.staff, IPM.D1, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    expect([otherDevice.status, document.status, missing.status]).toEqual([404, 404, 404]);
    expect([otherDevice.body, document.body]).toEqual([missing.body, missing.body]);
  });
});

describe("the derivatives travel with the original", () => {
  it("a signed link opens the variant it was made for and no other (the variant is signed)", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    const id = up.body.data?.["id"] as string;
    as(world.staff);
    const minted = (await call(attachmentsRouter, "POST", `/${id}/signed-url`, { body: { variant: "thumb" }, routeFile: "api/attachments.route.ts" })) as Res;
    expect(minted.status).toBe(200);
    const { url, token } = minted.body.data as { url: string; token: string };
    expect(url).toContain(`/signed?token=${token}&variant=thumb`);

    const thumb = await attachmentService.getSignedDownload(id, token, "thumb");
    expect([thumb.object?.meta.key, thumb.mimeType, thumb.fileName]).toEqual([`t/${world.tenantA}/f/${IPM.F1}/attachments/${id}.thumb.jpg`, "image/jpeg", `${id}.thumb.jpg`]);
    for (const other of ["display", undefined, "original", "bogus"]) {
      await expect(attachmentService.getSignedDownload(id, token, other)).rejects.toMatchObject({ status: 403 });
    }
    // An original's link is unchanged (no variant in the URL).
    as(world.staff);
    const original = (await call(attachmentsRouter, "POST", `/${id}/signed-url`, { body: {}, routeFile: "api/attachments.route.ts" })) as Res;
    expect((original.body.data as { url: string }).url).not.toContain("variant");
  });

  it("a variant of a file that has none → 404; a variant that is none of the three → 400", async () => {
    mdb.seed("Attachment", { id: "a7000000-0000-4000-8000-0000000002b2", tenantId: world.tenantA, clientFacilityId: IPM.F1, resourceType: "device", resourceId: IPM.D1, purpose: null, storageKey: `t/${world.tenantA}/f/${IPM.F1}/attachments/x.pdf`, fileName: "x.pdf", originalName: "x.pdf", folder: "uploads/attachments", mimeType: "application/pdf", size: 3, uploadedBy: null });
    as(world.staff);
    const none = (await call(attachmentsRouter, "POST", "/a7000000-0000-4000-8000-0000000002b2/signed-url", { body: { variant: "display" }, routeFile: "api/attachments.route.ts" })) as Res;
    expect([none.status, none.body.message]).toEqual([404, "This attachment has no such variant"]);
    await expect(attachmentService.generateSignedUrl(world.tenantA, "a7000000-0000-4000-8000-0000000002b2", { issuer: { userId: IPM.BOUND }, variant: "huge" })).rejects.toMatchObject({ status: 400 });
  });

  it("the generic DELETE /attachments/:id removes a device photo's derivatives with it", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    as(world.staff);
    const res = (await call(attachmentsRouter, "DELETE", `/${up.body.data?.["id"] as string}`, { routeFile: "api/attachments.route.ts" })) as Res;
    expect([res.status, keys()]).toEqual([200, []]);
  });

  it("the deleted-file sweep removes the derivatives with the original", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    await remove(world.staff, IPM.D1, up.body.data?.["id"] as string);
    // 400 days later: past any retention window (at most a year is configured anywhere).
    await sweep.sweepDeletedAttachmentFiles({ now: new Date(Date.now() + 400 * 24 * 3600 * 1000) });
    expect(keys()).toEqual([]);
  });

  it("the device move's re-key moves the derivatives with the original", async () => {
    const up = await upload(world.staff, IPM.D1, "device_front", jpeg(16, 16));
    const id = up.body.data?.["id"] as string;
    // The move flagged the row (P19-04 § 9.4): its facility is F2's, its key still F1's.
    const row = mdb.rows("Attachment")[0] as Record<string, unknown>;
    mdb.reset();
    mdb.seed("Attachment", { ...row, clientFacilityId: IPM.F2, rekeyPending: true });
    const summary = await rekey.rekeyTenantAttachments(world.tenantA);
    expect(summary).toMatchObject({ rekeyed: 1, failed: 0 });
    const prefix = `t/${world.tenantA}/f/${IPM.F2}/attachments/${id}`;
    expect(keys()).toEqual([`${prefix}.display.jpg`, `${prefix}.jpg`, `${prefix}.thumb.jpg`]);
  });
});
