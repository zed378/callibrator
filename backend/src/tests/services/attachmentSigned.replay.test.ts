/**
 * P21-09d — G-23 (spec P19-04 § 9.3, § 9.5; AM-22, FT-77, FT-78): the v3 signed link and the
 * key/row integrity check, over memoryDb with the REAL models, hooks and attachment service.
 *
 *  - a link minted in a BOUND context names the issuer `b<id>` and the row's facility, and
 *    redeems while nothing changed;
 *  - the row moved to another facility → 404 (the old link dies);
 *  - the bound issuer re-bound to another facility, or its facility ended → 404;
 *  - an unbound issuer's (`u`) link survives the same binding change of someone else, and
 *    carries `-` for a standalone file;
 *  - a v2 (four-part) token → 403 before any row is read;
 *  - minting or opening a row whose key segment disagrees with its facility → 404, logged as an
 *    integrity error; `rekey_pending` and a legacy key on the SELF facility are accepted.
 */
import fs from "node:fs";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as ModelsModule from "../../models";
import type * as ServiceModule from "../../services/attachment.service";
import type * as StorageModule from "../../services/storage";
import { tenantStorage } from "../../middlewares/tenantContext.middleware";
import type { ClientFacilityId, TenantId } from "../../types/ids";
import type { FakeStorageModule } from "../fixtures/fakeStorage";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));

jest.mock("../../services/storage", () =>
  jest.requireActual<{ createFakeStorage: () => unknown }>("../fixtures/fakeStorage").createFakeStorage(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const models = jest.requireActual<typeof ModelsModule>("../../models");
const service = jest.requireActual<typeof ServiceModule>("../../services/attachment.service");
const fake = jest.requireMock<typeof StorageModule & FakeStorageModule>("../../services/storage");

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const SELF = "50505050-5050-4050-8050-505050505050";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const BOUND = "cccccccc-0000-4000-8000-0000000000b1";
const STAFF = "cccccccc-0000-4000-8000-0000000000c1";
const A_F1 = "a1000000-0000-4000-8000-0000000009d1";
const A_LEGACY_SELF = "a1000000-0000-4000-8000-0000000009d2";
const A_LEGACY_F1 = "a1000000-0000-4000-8000-0000000009d3";
const A_STANDALONE = "a1000000-0000-4000-8000-0000000009d4";
const A_PENDING = "a1000000-0000-4000-8000-0000000009d5";

const keyIn = (facility: string | null, name: string): string => (facility ? `t/${T}/f/${facility}/attachments/${name}` : `t/${T}/attachments/${name}`);

const row = (id: string, clientFacilityId: string | null, storageKey: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  tenantId: T,
  resourceType: "generic",
  fileName: `${id}.pdf`,
  originalName: "report.pdf",
  folder: "uploads/attachments",
  mimeType: "application/pdf",
  size: 3,
  uploadedBy: STAFF,
  clientFacilityId,
  storageKey,
  ...extra,
});

const boundCtx = { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: BOUND, clientFacilityId: F1 as ClientFacilityId, facilityBound: true };
const staffCtx = { tenantId: T as TenantId, isSuperAdmin: false, isSystemTask: false, userId: STAFF, clientFacilityId: null, facilityBound: false };

const mintAs = (ctx: typeof boundCtx | typeof staffCtx, id: string): Promise<string> =>
  tenantStorage.run(ctx, async () => (await service.generateSignedUrl(T, id, { issuer: { userId: ctx.userId } })).token);
const redeem = async (id: string, token: string): Promise<number> => {
  try {
    await service.getSignedDownload(id, token);
    return 200;
  } catch (err) {
    return (err as { status?: number }).status ?? 500;
  }
};

beforeEach(async () => {
  mdb.reset();
  fake.__reset();
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  mdb.seed("Tenant", { id: T, name: "Tenant A", code: "TA", status: "active" });
  mdb.seed("ClientFacility", [
    { id: SELF, tenantId: T, name: "Self", code: "SELF", isSelf: true, status: "active" },
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
  ]);
  mdb.seed("User", [
    { id: BOUND, tenantId: T, username: "bound", email: "bound@example.test", password: "x", clientFacilityId: F1, isActive: true, status: "ACTIVE" },
    { id: STAFF, tenantId: T, username: "staff", email: "staff@example.test", password: "x", clientFacilityId: null, isActive: true, status: "ACTIVE" },
  ]);
  mdb.seed("Attachment", [
    row(A_F1, F1, keyIn(F1, "a.pdf")),
    row(A_LEGACY_SELF, SELF, keyIn(null, "b.pdf")),
    row(A_LEGACY_F1, F1, keyIn(null, "c.pdf")),
    row(A_STANDALONE, null, keyIn(null, "d.pdf")),
    row(A_PENDING, F2, keyIn(F1, "e.pdf"), { rekeyPending: true }),
  ]);
  for (const key of [keyIn(F1, "a.pdf"), keyIn(null, "b.pdf"), keyIn(null, "c.pdf"), keyIn(null, "d.pdf"), keyIn(F1, "e.pdf")]) {
    await (await fake.getTenantStorage(T)).put(key, Buffer.from("pdf"), { contentType: "application/pdf" });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("G-23 signed link v3", () => {
  it("a bound mint: issuer `b<id>`, the row's facility in the token, redeems while nothing changed", async () => {
    const token = await mintAs(boundCtx, A_F1);
    const parts = token.split(".");
    expect(parts).toHaveLength(5);
    expect([parts[1], parts[2], parts[3]]).toEqual([T, `b${BOUND}`, F1]);
    expect(await redeem(A_F1, token)).toBe(200);
  });

  it("the row moved to another facility: the old link answers 404", async () => {
    const token = await mintAs(boundCtx, A_F1);
    await models.Attachment.update({ clientFacilityId: F2 as ClientFacilityId, rekeyPending: true }, { where: { id: A_F1 }, facilityMove: "m1" });
    expect(await redeem(A_F1, token)).toBe(404);
  });

  it("the bound issuer re-bound to another facility: 404", async () => {
    const token = await mintAs(boundCtx, A_F1);
    await models.User.update({ clientFacilityId: F2 as ClientFacilityId }, { where: { id: BOUND }, facilityBinding: true });
    expect(await redeem(A_F1, token)).toBe(404);
  });

  it("the bound issuer's facility ended: 404", async () => {
    const token = await mintAs(boundCtx, A_F1);
    await models.ClientFacility.update({ status: "ended" }, { where: { id: F1 } });
    expect(await redeem(A_F1, token)).toBe(404);
  });

  it("an unbound issuer (`u`) is not tied to a binding; a standalone file carries `-`", async () => {
    const token = await mintAs(staffCtx, A_F1);
    expect(token.split(".")[2]).toBe(`u${STAFF}`);
    await models.User.update({ clientFacilityId: F2 as ClientFacilityId }, { where: { id: BOUND }, facilityBinding: true });
    expect(await redeem(A_F1, token)).toBe(200);
    const standalone = await mintAs(staffCtx, A_STANDALONE);
    expect(standalone.split(".")[3]).toBe("-");
    expect(await redeem(A_STANDALONE, standalone)).toBe(200);
  });

  it("a v2 four-part token is refused (403) before any row is read", async () => {
    const [exp, tenant, issuer, , sig] = (await mintAs(staffCtx, A_F1)).split(".");
    expect(await redeem(A_F1, [exp, tenant, issuer, sig].join("."))).toBe(403);
  });

  it("a token whose facility segment was rewritten is refused (403): the facility is signed", async () => {
    const [exp, tenant, issuer, , sig] = (await mintAs(staffCtx, A_F1)).split(".");
    expect(await redeem(A_F1, [exp, tenant, issuer, F2, sig].join("."))).toBe(403);
  });
});

describe("G-23 the key/row integrity check (FT-77)", () => {
  it("a legacy key (no segment) on the SELF facility, a standalone file and a re-key-pending row are accepted", async () => {
    for (const id of [A_LEGACY_SELF, A_STANDALONE, A_PENDING]) {
      expect({ id, status: await redeem(id, await mintAs(staffCtx, id)) }).toEqual({ id, status: 200 });
    }
  });

  it("a legacy key on a non-self facility is refused at minting and at download, as 404", async () => {
    await expect(mintAs(staffCtx, A_LEGACY_F1)).rejects.toMatchObject({ status: 404 });
    await expect(tenantStorage.run(staffCtx, () => service.getDownload(T, A_LEGACY_F1))).rejects.toMatchObject({ status: 404 });
  });

  it("a key with a facility segment on a row with no facility is refused", async () => {
    await models.Attachment.update({ clientFacilityId: null }, { where: { id: A_F1 }, facilityMove: "m3" });
    await expect(tenantStorage.run(staffCtx, () => service.getDownload(T, A_F1))).rejects.toMatchObject({ status: 404 });
  });

  it("a key whose segment names another facility than the row is refused", async () => {
    await models.Attachment.update({ clientFacilityId: F2 as ClientFacilityId }, { where: { id: A_F1 }, facilityMove: "m2" });
    await expect(tenantStorage.run(staffCtx, () => service.getDownload(T, A_F1))).rejects.toMatchObject({ status: 404 });
  });
});
