/**
 * P21-03b — G-26 (spec P19-02 § 9.2; AM-25; FT-92): the `Idempotency-Key` middleware on the IPM
 * session routes, over memoryDb (the real IdempotencyKey model and its tenant + own-user facility
 * rule).
 *
 *  - a replay answers the STORED status with the session RE-READ now (one row, one audit row);
 *  - a different body under the key → 409 IDEMPOTENCY_KEY_REUSED; a changed access → 409
 *    IDEMPOTENCY_SCOPE_CHANGED; a request still in flight → 409 IDEMPOTENCY_IN_FLIGHT, and a stale
 *    one is taken over;
 *  - a refused request (4xx) frees its key, so the corrected retry runs;
 *  - a resource gone from view answers the replay 404;
 *  - the purge removes expired keys of every tenant (and only those).
 */
import { UniqueConstraintError } from "sequelize";
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type * as SessionsRoute from "../../routes/api/ipmSessions.route";
import type * as IdempotencyService from "../../services/idempotency.service";
import type * as IdempotencyMiddleware from "../../middlewares/idempotency.middleware";
import type * as TenantContext from "../../middlewares/tenantContext.middleware";
import type * as ActivityLog from "../../middlewares/activityLog.middleware";
import type ModelsModule from "../../models";
import { IPM, seedIpmWorld, type IpmWorld } from "../fixtures/ipmSeed";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const sessions = jest.requireActual<typeof SessionsRoute>("../../routes/api/ipmSessions.route");
const keys = jest.requireActual<typeof IdempotencyService>("../../services/idempotency.service");
const { canonicalJson } = jest.requireActual<typeof IdempotencyMiddleware>("../../middlewares/idempotency.middleware");
const { tenantStorage } = jest.requireActual<typeof TenantContext>("../../middlewares/tenantContext.middleware");
const { logger } = jest.requireActual<typeof ActivityLog>("../../middlewares/activityLog.middleware");
const models = jest.requireActual<typeof ModelsModule>("../../models");

const KEY = "1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d";
let world: IpmWorld;

interface Body {
  data?: Record<string, unknown> | null;
  message?: string;
  code?: string;
}
interface Res { status: number; body: Body; headers: Record<string, unknown> }

beforeEach(() => {
  mdb.reset();
  grantAllMenus();
  world = seedIpmWorld(mdb, twoTenants(), seedTenants);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const send = (principal: Principal, method: string, url: string, body: unknown = {}, key: string | null = KEY): Promise<Res> => {
  as(principal);
  return call(sessions, method, url, {
    body,
    headers: key === null ? {} : { "Idempotency-Key": key },
    baseUrl: "/api/v1/ipm/sessions",
    routeFile: "api/ipmSessions.route.ts",
  }) as Promise<Res>;
};
const keyRows = (): Record<string, unknown>[] => mdb.rows("IdempotencyKey");
const sessionsOf = (device: string): Record<string, unknown>[] => mdb.rows("InspectionSession").filter((r) => r["deviceId"] === device);
const inTenant = <T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> =>
  tenantStorage.run({ tenantId: tenantId as TenantId, isSuperAdmin: false, isSystemTask: false, userId, clientFacilityId: null, facilityBound: false }, fn);
const request = (overrides: Partial<IdempotencyService.IdempotencyRequest> = {}): IdempotencyService.IdempotencyRequest => ({
  tenantId: world.tenantA as TenantId,
  userId: world.staff.id,
  apiKeyId: null,
  key: KEY,
  route: "POST /api/v1/ipm/sessions/",
  requestHash: "a".repeat(64),
  scopeFingerprint: "b".repeat(64),
  ...overrides,
});

describe("G-26 — a replay answers the stored status with the resource re-read now", () => {
  it("creates once; the repeat answers 201 with the same session, re-read, and writes nothing", async () => {
    const first = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect(first.status).toBe(201);
    expect(keyRows()).toEqual([
      expect.objectContaining({ status: "completed", responseStatus: 201, resourceType: "InspectionSession", resourceId: first.body.data?.["id"], userId: world.staff.id }),
    ]);
    const writes = mdb.committed().length;
    const again = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect([again.status, again.body.message, again.headers["idempotent-replayed"]]).toEqual([201, "Replayed", "true"]);
    expect(again.body.data?.["id"]).toBe(first.body.data?.["id"]);
    expect(mdb.committed().slice(writes)).toEqual([]);
    expect(sessionsOf(IPM.D1).filter((r) => r["status"] === "draft" && r["createdBy"] === world.staff.id)).toHaveLength(1);
  });

  it("the replay re-reads in the CURRENT context: a session gone from view answers 404", async () => {
    const first = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const table = (mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown }).rowsOf(
      (mdb as unknown as { model: (n: string) => unknown }).model("InspectionSession"),
    );
    Object.assign(table.find((r) => r["id"] === first.body.data?.["id"]) as Record<string, unknown>, { tenantId: world.tenantB });
    expect((await send(world.staff, "POST", "/", { deviceId: IPM.D1 })).status).toBe(404);
  });

  it("an edit replayed answers 200 and does not bump the revision twice", async () => {
    await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, notes: "Once" });
    const again = await send(world.staff, "PATCH", `/${IPM.DRAFT2}`, { revision: 0, notes: "Once" });
    expect([again.status, again.body.data?.["revision"]]).toEqual([200, 1]);
  });

  it("a completed key with no resource replays its status alone", async () => {
    await inTenant(world.tenantA, world.staff.id, async () => {
      const begun = await keys.beginIdempotentRequest(request());
      expect(begun.kind).toBe("proceed");
      if (begun.kind === "proceed") {
        await keys.releaseIdempotentRequest(begun.handle, 204);
        await keys.releaseIdempotentRequest(begun.handle, 500); // settled already: a no-op
      }
      expect(await keys.beginIdempotentRequest(request())).toEqual({ kind: "replay", status: 204, resourceType: null, resourceId: null });
    });
  });

  it("the route answers a replay of a key completed without a resource with no data", async () => {
    const first = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const row = keyRows()[0] as Record<string, unknown>;
    expect(row["route"]).toMatch(/^POST \//);
    const table = (mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown }).rowsOf(
      (mdb as unknown as { model: (n: string) => unknown }).model("IdempotencyKey"),
    );
    Object.assign(table[0] as Record<string, unknown>, { resourceId: null, responseStatus: null });
    const again = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect([again.status, again.body.data, first.status]).toEqual([200, null, 201]);
  });
});

describe("G-26 — the 409s", () => {
  it("a different body under the key → 409 IDEMPOTENCY_KEY_REUSED", async () => {
    await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1, capturedOffline: true });
    expect([res.status, res.body.code, res.body.message]).toEqual([409, "IDEMPOTENCY_KEY_REUSED", "This key was used for a different request."]);
  });

  it("AM-25: the same request under a changed access → 409 IDEMPOTENCY_SCOPE_CHANGED", async () => {
    await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const promoted: Principal = { ...world.staff, role: { ...world.staff.role, id: world.admin.role.id } };
    const res = await send(promoted, "POST", "/", { deviceId: IPM.D1 });
    expect([res.status, res.body.code, res.body.message]).toEqual([409, "IDEMPOTENCY_SCOPE_CHANGED", "This request was made under a different access; review it."]);
  });

  it("another user's key with the same value is not found (per user, FT-53)", async () => {
    await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    const res = await send(world.bound2, "POST", "/", { deviceId: IPM.D1 });
    expect(res.status).toBe(201);
  });

  it("a request still in flight → 409 IDEMPOTENCY_IN_FLIGHT; a stale one is taken over", async () => {
    await inTenant(world.tenantA, world.staff.id, async () => {
      expect((await keys.beginIdempotentRequest(request())).kind).toBe("proceed");
      expect(await keys.beginIdempotentRequest(request())).toEqual({
        kind: "conflict",
        code: "IDEMPOTENCY_IN_FLIGHT",
        message: "This request is still being processed; retry shortly.",
      });
      const table = (mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown }).rowsOf(
        (mdb as unknown as { model: (n: string) => unknown }).model("IdempotencyKey"),
      );
      Object.assign(table[0] as Record<string, unknown>, { createdAt: new Date(Date.now() - keys.IDEMPOTENCY_STALE_MS - 1000) });
      expect((await keys.beginIdempotentRequest(request())).kind).toBe("proceed");
      expect(keyRows()).toHaveLength(1);
    });
  });

  it("a stale row that will not go away ends in IDEMPOTENCY_IN_FLIGHT (bounded retries)", async () => {
    await inTenant(world.tenantA, world.staff.id, async () => {
      await keys.beginIdempotentRequest(request());
      const table = (mdb as unknown as { rowsOf: (m: unknown) => Record<string, unknown>[]; model: (n: string) => unknown }).rowsOf(
        (mdb as unknown as { model: (n: string) => unknown }).model("IdempotencyKey"),
      );
      Object.assign(table[0] as Record<string, unknown>, { createdAt: new Date(0) });
      jest.spyOn(models.IdempotencyKey, "destroy").mockResolvedValue(0);
      expect(await keys.beginIdempotentRequest(request())).toMatchObject({ kind: "conflict", code: "IDEMPOTENCY_IN_FLIGHT" });
    });
  });

  it("two first attempts at once: the loser reads the winner's row", async () => {
    await inTenant(world.tenantA, world.staff.id, async () => {
      await keys.beginIdempotentRequest(request());
      const real = models.IdempotencyKey.findOne.bind(models.IdempotencyKey);
      jest.spyOn(models.IdempotencyKey, "findOne").mockResolvedValueOnce(null).mockImplementation(real);
      jest.spyOn(models.IdempotencyKey, "create").mockRejectedValueOnce(new UniqueConstraintError({ message: "dup" }));
      expect(await keys.beginIdempotentRequest(request())).toMatchObject({ kind: "conflict", code: "IDEMPOTENCY_IN_FLIGHT" });
    });
  });

  it("an unexpected insert failure reaches the error handler (500), and no route runs", async () => {
    jest.spyOn(models.IdempotencyKey, "create").mockRejectedValueOnce(new Error("database gone"));
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect(res.status).toBe(500);
    expect(sessionsOf(IPM.D1).filter((r) => r["createdBy"] === world.staff.id && r["status"] === "draft")).toHaveLength(0);
  });

  it("a header that is not a UUID v4 → 400", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1 }, "not-a-key");
    expect([res.status, res.body.message]).toEqual([400, "Idempotency-Key must be a UUID v4."]);
  });
});

describe("G-26 — a refused request frees its key", () => {
  it("a 409 is not stored: the corrected retry under the same key runs", async () => {
    const refused = await send(world.staff, "POST", "/", { deviceId: IPM.D2 });
    expect([refused.status, refused.body.code]).toEqual([409, "IPM_DRAFT_EXISTS"]);
    expect(keyRows()).toEqual([]);
    const retried = await send(world.staff, "POST", "/", { deviceId: IPM.D1 });
    expect(retried.status).toBe(201);
  });

  it("a key that cannot be settled is logged, and the answer still goes out", async () => {
    const error = jest.spyOn(logger, "error").mockImplementation(() => logger);
    jest.spyOn(models.IdempotencyKey, "destroy").mockRejectedValueOnce(new Error("settle failed"));
    const refused = await send(world.staff, "POST", "/", { deviceId: IPM.D2 });
    expect(refused.status).toBe(409);
    expect(error).toHaveBeenCalledWith("Idempotency key could not be settled", { error: "Error: settle failed" });
  });

  it("no header: the route runs as before and no key is written", async () => {
    const res = await send(world.staff, "POST", "/", { deviceId: IPM.D1 }, null);
    expect([res.status, keyRows()]).toEqual([201, []]);
  });
});

describe("the nightly purge (spec § 9.1)", () => {
  it("removes expired keys of every tenant, and only those", async () => {
    const at = (days: number): Date => new Date(Date.now() + days * 86400000);
    mdb.seed("IdempotencyKey", [
      { id: "11111111-0000-4000-8000-000000000001", tenantId: world.tenantA, userId: world.staff.id, key: KEY, route: "r", requestHash: "a".repeat(64), scopeFingerprint: "b".repeat(64), status: "completed", expiresAt: at(-1) },
      { id: "11111111-0000-4000-8000-000000000002", tenantId: world.tenantB, userId: world.other.id, key: KEY, route: "r", requestHash: "a".repeat(64), scopeFingerprint: "b".repeat(64), status: "in_flight", expiresAt: at(-2) },
      { id: "11111111-0000-4000-8000-000000000003", tenantId: world.tenantA, userId: world.admin.id, key: KEY, route: "r", requestHash: "a".repeat(64), scopeFingerprint: "b".repeat(64), status: "completed", expiresAt: at(5) },
    ]);
    expect(await keys.purgeExpiredIdempotencyKeys()).toEqual({ deleted: 2, stoppedEarly: false });
    expect(keyRows().map((r) => r["id"])).toEqual(["11111111-0000-4000-8000-000000000003"]);
  });

  it("stops at its bound and says so", async () => {
    jest.spyOn(models.IdempotencyKey, "findAll").mockResolvedValue([{ id: "x" }] as never);
    jest.spyOn(models.IdempotencyKey, "destroy").mockResolvedValue(1);
    expect(await keys.purgeExpiredIdempotencyKeys(new Date())).toEqual({ deleted: 50, stoppedEarly: true });
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth, drops undefined, writes dates as ISO text", () => {
    expect(canonicalJson({ b: [{ d: 1, c: null }], a: new Date("2026-10-09T00:00:00Z"), u: undefined })).toBe(
      '{"a":"2026-10-09T00:00:00.000Z","b":[{"c":null,"d":1}]}',
    );
    expect(canonicalJson(undefined)).toBe("null");
  });
});
