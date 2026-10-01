/**
 * P6-11 (the stock-take gap) — scheduling a stock opname and moving its status
 * each commit ONE audit row in their own transaction.
 *
 * `createOpname` and `updateOpnameStatus` wrote the opname with no audit row:
 * a stock count (ISO 13485 §7.5 control of product) could be scheduled,
 * started and completed with nothing recording who did it. They were listed as
 * KNOWN GAP entries in tests/guards/auditCoverage.p611.test.ts.
 *
 * The actor is the request's principal (auditPrincipal: the user id, IP and
 * user agent; nothing else about the person). An opname already refuses an API
 * key (Q-51, denyApiKey on both routes), so the actor is always a user.
 *
 * REAL router, controller, service, audit service and models on memoryDb,
 * whose transactions undo their writes on rollback.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
import type { Principal } from "../fixtures/routeClient";
import type AuditService from "../../services/audit.service";
import type * as StockRoute from "../../routes/api/stock.route";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock(),
);

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { twoTenants, seedTenants, grantAllMenus, as, call } = jest.requireActual<typeof RouteClient>("../fixtures/routeClient");
const auditService = jest.requireActual<typeof AuditService>("../../services/audit.service");
const router = jest.requireActual<typeof StockRoute>("../../routes/api/stock.route");

const WAREHOUSE = "a1000000-0000-4000-8000-000000000611";
const OPNAME = "a4000000-0000-4000-8000-000000000611";
let admin: Principal;
let tenantId: string;

/** The committed writes of one model, and whether each shares its transaction with an audit row. */
const committedWith = (model: string): { writes: number; audits: number; sameTx: boolean } => {
  const committed = mdb.committed();
  const writes = committed.filter((w) => w.model === model);
  const audits = committed.filter((w) => w.model === "AuditLog");
  const txs = new Set(writes.map((w) => w.tx));
  return {
    writes: writes.length,
    audits: audits.length,
    sameTx: audits.every((a) => a.tx !== null && txs.has(a.tx)) && writes.every((w) => w.tx !== null),
  };
};

beforeEach(() => {
  mdb.reset();
  jest.restoreAllMocks();
  grantAllMenus();
  const fx = twoTenants();
  admin = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");
  tenantId = fx.tenantA.id;
  seedTenants(mdb, fx, [admin]);
  mdb.seed("Warehouse", { id: WAREHOUSE, tenantId, name: "Main", code: "WH-611" });
  mdb.seed("StockOpname", { id: OPNAME, tenantId, warehouseId: WAREHOUSE, status: "draft", scheduledAt: new Date("2030-01-01"), performedBy: admin.id });
  as(admin);
});

describe("P6-11 — a stock opname is audited in its transaction", () => {
  it("POST /opname commits the opname and ONE CREATE audit row together", async () => {
    const res = await call(router, "POST", "/opname", { body: { warehouseId: WAREHOUSE, scheduledAt: "2030-02-01", notes: "Quarterly count" } });
    expect(res.status).toBe(201);
    expect(committedWith("StockOpname")).toEqual({ writes: 1, audits: 1, sameTx: true });
    expect(mdb.rows("AuditLog")).toEqual([
      expect.objectContaining({ tenantId, userId: admin.id, action: "CREATE", resourceType: "StockOpname" }),
    ]);
  });

  it("PATCH /opname/:opnameId commits the status and ONE UPDATE audit row together", async () => {
    const res = await call(router, "PATCH", `/opname/${OPNAME}`, { body: { status: "completed" } });
    expect(res.status).toBe(200);
    expect(committedWith("StockOpname")).toEqual({ writes: 1, audits: 1, sameTx: true });
    const [row] = mdb.rows("AuditLog");
    expect(row).toEqual(
      expect.objectContaining({ tenantId, userId: admin.id, action: "UPDATE", resourceType: "StockOpname", resourceId: OPNAME }),
    );
    expect((row?.["changes"] as { before?: unknown; after?: unknown } | undefined)).toEqual(
      expect.objectContaining({ before: expect.objectContaining({ status: "draft" }) as unknown, after: expect.objectContaining({ status: "completed" }) as unknown }),
    );
  });

  it("a failed audit row rolls the status change back", async () => {
    const real = auditService.logAction.bind(auditService);
    jest.spyOn(auditService, "logAction").mockImplementation(async (entry, options) => {
      await real(entry, options);
      throw new Error("forced rollback after the audit row was written");
    });
    const res = await call(router, "PATCH", `/opname/${OPNAME}`, { body: { status: "in_progress" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mdb.rows("StockOpname").find((r) => r["id"] === OPNAME)?.["status"]).toBe("draft");
    expect(mdb.committed()).toEqual([]);
  });
});
