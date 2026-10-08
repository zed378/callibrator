/**
 * P21-03c — IPM photos through `POST /attachments` (spec P19-02 § 10.2, § 12; ADR-132 Am. 1 § 5)
 * and G-O8 (P19-08 § 9.5; § 16.2 `attachments.idempotency.p2103`): the upload honours
 * `Idempotency-Key`, its request hash covering the file's SHA-256.
 *
 * REAL: the router chain (auth double → tenant context + facility route gate, dynamicAccess, the
 * bound upload gate, idempotency), the controller, attachment.service, the hooks over memoryDb,
 * the fake storage. DOUBLED: multer (a real temporary file handed in as `req.file`), the quota
 * check, the quarantine guard and the virus scan.
 *
 *  - an IPM photo is accepted on the caller's own DRAFT only (another technician's: 403; a
 *    submitted session: 409 IPM_NOT_DRAFT), with `purpose = ipm_evidence`, in the session's facility;
 *  - a bound principal needs `ipm` write for it (a ROOM USER: 403 FACILITY_UPLOAD_REFUSED);
 *  - a photo of a submitted IPM cannot be deleted (409 IPM_NOT_DRAFT); a draft's can;
 *  - a replayed upload stores one file; another file under the same key → 409.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type { FakeStorageModule } from "../fixtures/fakeStorage";
import type * as RouteModule from "../../routes/api/attachments.route";
import type { NextFunction, Request, Response } from "express";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";

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
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const router = jest.requireActual<typeof RouteModule>("../../routes/api/attachments.route");

const KEY = "2e2e2e2e-2e2e-4e2e-8e2e-2e2e2e2e2e2e";
const PHOTO_S1 = "a7000000-0000-4000-8000-0000000000f1";
const PHOTO_DRAFT = "a7000000-0000-4000-8000-0000000000f2";

interface Res { status: number; body: { code?: string; message?: string; data?: Record<string, unknown> } }
let world: IpmWorld;
let room: Principal;
let tmp = "";

const writeFile = (content: string): string => {
  const file = path.join(tmp, `photo-${String(Math.random()).slice(2)}.jpg`);
  fs.writeFileSync(file, content);
  return file;
};

const upload = async (who: Principal, body: Record<string, unknown>, opts: { key?: string; content?: string } = {}): Promise<Res> => {
  const file = writeFile(opts.content ?? "jpeg-bytes");
  as(who);
  return (await call(router, "POST", "/", {
    body,
    headers: opts.key ? { "Idempotency-Key": opts.key } : {},
    routeFile: "api/attachments.route.ts",
    file: { path: file, filename: path.basename(file), originalname: "photo.jpg", mimetype: "image/jpeg", size: 10 },
  })) as Res;
};

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2103-ipm-photo-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  mdb.reset();
  storage.__reset();
  grantAllMenus();
  const fx = twoTenants();
  world = seedIpmWorld(mdb, fx, seedTenants);
  room = { ...fx.principal(fx.tenantA, "ROOM_USER"), id: "cccccccc-0000-4000-8000-0000000000f3", clientFacilityId: IPM.F1 } as unknown as Principal;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const IPM_PHOTO = (sessionId: string): Record<string, unknown> => ({ resourceType: "inspectionsession", resourceId: sessionId });

describe("an IPM photo is evidence of the capture (P19-02 § 12)", () => {
  it("the bound technician's own draft: 201, purpose ipm_evidence, in the session's facility", async () => {
    const res = await upload(world.bound, IPM_PHOTO(IPM.DRAFT1));
    expect(res.status).toBe(201);
    expect(mdb.rows("Attachment")[0]).toMatchObject({ resourceType: "inspectionsession", resourceId: IPM.DRAFT1, purpose: "ipm_evidence", clientFacilityId: IPM.F1 });
  });

  it("another technician's draft → 403; a submitted session → 409 IPM_NOT_DRAFT; nothing stored", async () => {
    const other = await upload(world.bound2, IPM_PHOTO(IPM.DRAFT1));
    expect([other.status, other.body.message]).toEqual([403, "Only the technician who started this IPM can add photos to it."]);
    const submitted = await upload(world.staff, IPM_PHOTO(IPM.S1));
    expect([submitted.status, submitted.body.code, submitted.body.message]).toEqual([409, "IPM_NOT_DRAFT", "Photos are added to an IPM draft only; this IPM is submitted."]);
    expect(mdb.rows("Attachment")).toEqual([]);
  });

  it("another facility's session is the 404 of a missing one for a bound uploader", async () => {
    const foreign = await upload(world.bound, IPM_PHOTO(IPM.DRAFT2));
    const missing = await upload(world.bound, IPM_PHOTO("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"));
    expect([foreign.status, foreign.body]).toEqual([404, missing.body]);
  });

  it("a bound ROOM USER (ipm read) is refused by the bound gate", async () => {
    const res = await upload(room, IPM_PHOTO(IPM.DRAFT1));
    expect([res.status, res.body.code, res.body.message]).toEqual([403, "FACILITY_UPLOAD_REFUSED", "Attaching this photo needs ipm write."]);
  });

  it("an API key is no technician: 403", async () => {
    const key = { ...world.staff, isApiKey: true, apiKeyScopes: ["equipment:read"], role: { id: null, name: "API_KEY", roleLevel: 0 } } as unknown as Principal;
    const res = await upload(key, IPM_PHOTO(IPM.DRAFT2));
    expect([res.status, res.body.message]).toEqual([403, "Only the technician who started this IPM can add photos to it."]);
  });

  it("a photo of a submitted IPM cannot be deleted; a draft's can", async () => {
    const photo = (id: string, sessionId: string): Record<string, unknown> => ({
      id,
      tenantId: world.tenantA,
      clientFacilityId: IPM.F1,
      resourceType: "inspectionsession",
      resourceId: sessionId,
      purpose: "ipm_evidence",
      fileName: "p.jpg",
      originalName: "p.jpg",
      folder: "uploads/attachments",
      mimeType: "image/jpeg",
      size: 3,
      uploadedBy: IPM.BOUND,
    });
    mdb.seed("Attachment", [photo(PHOTO_S1, IPM.S1), photo(PHOTO_DRAFT, IPM.DRAFT1)]);
    as(world.staff);
    const locked = (await call(router, "DELETE", `/${PHOTO_S1}`, { routeFile: "api/attachments.route.ts" })) as Res;
    expect([locked.status, locked.body.code, locked.body.message]).toEqual([409, "IPM_NOT_DRAFT", "Photos of a submitted IPM are part of its record."]);
    as(world.staff);
    expect(((await call(router, "DELETE", `/${PHOTO_DRAFT}`, { routeFile: "api/attachments.route.ts" })) as Res).status).toBe(200);
  });
});

describe("G-O8 — a replayed photo upload stores one file", () => {
  it("the same file under the same key answers the stored 201 with the row re-read; the replay's upload is removed", async () => {
    const first = await upload(world.bound, IPM_PHOTO(IPM.DRAFT1), { key: KEY });
    const before = fs.readdirSync(tmp).length;
    const again = await upload(world.bound, IPM_PHOTO(IPM.DRAFT1), { key: KEY });
    expect([first.status, again.status, again.body.data?.["id"]]).toEqual([201, 201, first.body.data?.["id"]]);
    expect(mdb.rows("Attachment")).toHaveLength(1);
    expect(fs.readdirSync(tmp).length).toBe(before);
  });

  it("another file under the same key → 409 IDEMPOTENCY_KEY_REUSED, the upload removed (a failed removal is tolerated)", async () => {
    await upload(world.bound, IPM_PHOTO(IPM.DRAFT1), { key: KEY });
    jest.spyOn(fs.promises, "unlink").mockRejectedValueOnce(new Error("busy"));
    const res = await upload(world.bound, IPM_PHOTO(IPM.DRAFT1), { key: KEY, content: "other-bytes" });
    expect([res.status, res.body.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(mdb.rows("Attachment")).toHaveLength(1);
  });

  it("an API key's key is its own (api_key_id), and its scope is the key's", async () => {
    const key = { ...world.staff, isApiKey: true, apiKeyScopes: ["equipment:read"], role: { id: null, name: "API_KEY", roleLevel: 0 } } as unknown as Principal;
    const res = await upload(key, { resourceType: "generic" }, { key: KEY });
    expect(res.status).toBe(201);
    expect(mdb.rows("IdempotencyKey")[0]).toMatchObject({ apiKeyId: world.staff.id, userId: null, status: "completed", resourceType: "Attachment" });
  });
});
