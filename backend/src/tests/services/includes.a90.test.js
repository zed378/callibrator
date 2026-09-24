/**
 * A-90 — implicit INNER JOINs on includes of defaultScoped models.
 *
 * User, CalibrationDevice, Warehouse, Role, Tenant, Category (and the other
 * models with a `defaultScope` `where: { is_deleted: false }`) make Sequelize
 * default an include of them to `required: true` — an INNER JOIN — even when
 * the include names no `where` (A-75). Since A-87 (ADR-048) the hooks also put
 * the tenant predicate in that join's ON clause, so an INNER include now drops
 * the PARENT row when its reference is null, soft-deleted, or points outside
 * the tenant (the super admin acting inside a tenant: calibration performer,
 * stock adjuster, SOP author, backup creator, session user).
 *
 * Measured, not assumed — the technique of qms.includes.a75.test.js and
 * tenantScope.includes.a87.test.js: the REAL models barrel (real models, real
 * associations, real global tenant hooks) on an UNCONNECTED PostgreSQL-dialect
 * Sequelize whose `query` is a recorder. Each service/controller is called for
 * real, inside a tenant context, and the SQL it sends is asserted on:
 *
 *   - the join is LEFT OUTER — a row whose reference is null, soft-deleted, or
 *     foreign is still listed (with the relation read as null), and
 *   - the tenant predicate is still in that join's ON clause — the foreign row
 *     itself is never returned (ADR-048 is not weakened).
 *
 * For findAndCountAll the COUNT is asserted too: an INNER JOIN there makes
 * `meta.total` disagree with the rows a client can page through.
 *
 * Sites that are INNER on purpose (the include is a filter) are pinned as
 * INNER, so a well-meant "fix" to LEFT fails here and has to read the comment
 * at the call site.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql, options) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockSql.statements.push(text);
    // count() reads { count }; findOne/findByPk (plain) read one row or null;
    // a row SELECT reads an array.
    if (/^SELECT count\(/i.test(text)) {return { count: 0 };}
    return options && options.plain ? null : [];
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
// sanitize-html pulls an ESM-only htmlparser2 that this jest config does not
// transform; content.service only needs it for writes.
jest.mock("sanitize-html", () =>
  Object.assign((html) => String(html || ""), {
    defaults: { allowedTags: [], allowedAttributes: {} },
    simpleTransform: () => () => ({}),
  }),
);
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id) => `user-perms:${id}` },
}));

const fs = require("fs");
const { Readable } = require("stream");
const models = require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const calibrationRecordsService = require("../../services/calibrationRecords.service");
const calibrationDevicesService = require("../../services/calibrationDevices.service");
const stockService = require("../../services/stock.service");
const sopService = require("../../services/sop.service");
const supplierScorecardService = require("../../services/supplierScorecard.service");
const tenantBackupService = require("../../services/tenantBackup.service");
const tenantBackupController = require("../../controllers/tenantBackup.controller");
const sessionController = require("../../controllers/session.controller");
const contentService = require("../../services/content.service");
const userPermissionService = require("../../services/userPermission.service");
const workflowService = require("../../services/workflow.service");
const apiKeyService = require("../../services/apiKey.service");

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

/** Run `fn` as a request of TENANT — the context the hooks read. */
const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

const rowSelects = () => mockSql.statements.filter((s) => /^SELECT (?!count\()/i.test(s));
const counts = () => mockSql.statements.filter((s) => /^SELECT count\(/i.test(s));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const END = "(?= LEFT OUTER JOIN | INNER JOIN | WHERE | ORDER BY | LIMIT |\\) AS |;|$)";

/**
 * The join an include alias produced: its type and its ON condition.
 * A nested include's alias is `parent->child`, as Sequelize writes it.
 * @returns {{ type: string, on: string }}
 */
const join = (sql, table, alias) => {
  const re = new RegExp(`(LEFT OUTER|INNER) JOIN "${esc(table)}" AS "${esc(alias)}" ON (.*?)${END}`);
  const match = sql.match(re);
  if (!match) {throw new Error(`no join for ${alias} in: ${sql}`);}
  return { type: match[1], on: match[2] };
};

/** Every include in `spec` of `sql` is LEFT OUTER, and tenant-scoped ones carry TENANT in the ON clause. */
const expectLeft = (sql, spec) => {
  for (const [table, alias, tenantScoped] of spec) {
    const { type, on } = join(sql, table, alias);
    expect({ alias, type }).toEqual({ alias, type: "LEFT OUTER" });
    if (tenantScoped) {
      expect({ alias, tenantInOn: on.includes(`"${alias}"."tenant_id" = '${TENANT}'`) }).toEqual({
        alias,
        tenantInOn: true,
      });
    }
  }
};

/** A response double that swallows what a controller sends. */
const resDouble = () => {
  const res = { headersSent: false };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  res.download = jest.fn();
  return res;
};

beforeEach(() => {
  mockSql.statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A-90 — a row with a null, soft-deleted or foreign reference is still listed", () => {
  it("calibrationRecords: the list and the detail LEFT-join device and performer", async () => {
    await asTenant(() => calibrationRecordsService.fetchCalibrationRecords({ tenantId: TENANT }));
    await asTenant(() => calibrationRecordsService.fetchSpecificCalibrationRecord(TENANT, ID));

    const [list, detail] = rowSelects();
    const spec = [
      ["calibration_devices", "device", true],
      ["users", "performer", true],
    ];
    expectLeft(list, spec);
    expectLeft(detail, spec);
    expect(counts()[0]).not.toMatch(/INNER JOIN/);
  });

  it("calibrationDevices: the list LEFT-joins warehouse (a device may have no warehouse)", async () => {
    await asTenant(() => calibrationDevicesService.fetchCalibrationDevices({ tenantId: TENANT }));
    await asTenant(() => calibrationDevicesService.fetchSpecificCalibrationDevice(TENANT, ID));

    const [list, detail] = rowSelects();
    expectLeft(list, [["warehouses", "warehouse", true]]);
    expectLeft(detail, [["warehouses", "warehouse", true]]);
    expect(counts()[0]).not.toMatch(/INNER JOIN/);
  });

  it("stock: every one of the seven include sites is a LEFT JOIN", async () => {
    await asTenant(() => stockService.fetchStocks({ tenantId: TENANT }));
    await asTenant(() => stockService.fetchSpecificStock(TENANT, ID).catch(() => {}));
    await asTenant(() => stockService.fetchAdjustments({ tenantId: TENANT }));
    await asTenant(() => stockService.fetchTransfers({ tenantId: TENANT }));
    await asTenant(() => stockService.fetchOpnames({ tenantId: TENANT }));
    await asTenant(() => stockService.getInventoryReport(TENANT));
    await asTenant(() => stockService.exportInventoryCsv(TENANT));

    const [stocks, stock, adjustments, transfers, opnames, report, csv] = rowSelects();
    expectLeft(stocks, [["warehouses", "warehouse", true]]);
    expectLeft(stock, [["warehouses", "warehouse", true]]);
    expectLeft(adjustments, [
      ["warehouses", "warehouse", true],
      ["users", "adjuster", true],
    ]);
    expectLeft(transfers, [
      ["warehouses", "fromWarehouse", true],
      ["warehouses", "toWarehouse", true],
      ["users", "requester", true],
      ["users", "approver", true],
    ]);
    expectLeft(opnames, [
      ["warehouses", "warehouse", true],
      ["users", "performer", true],
    ]);
    expectLeft(report, [["warehouses", "warehouse", true]]);
    expectLeft(csv, [["warehouses", "warehouse", true]]);
    for (const sql of counts()) {expect(sql).not.toMatch(/INNER JOIN/);}
  });

  it("sop: the document list LEFT-joins author", async () => {
    await asTenant(() => sopService.getDocuments(TENANT, 1, 10));

    expectLeft(rowSelects()[0], [["users", "author", true]]);
    expect(counts()[0]).not.toMatch(/INNER JOIN/);
  });

  it("supplierScorecard: the list and the detail LEFT-join evaluator", async () => {
    await asTenant(() => supplierScorecardService.getScorecards(TENANT, {}));
    await asTenant(() => supplierScorecardService.getScorecardById(TENANT, ID).catch(() => {}));

    const [list, detail] = rowSelects();
    expectLeft(list, [["users", "evaluator", true]]);
    expectLeft(detail, [["users", "evaluator", true]]);
    expect(counts()[0]).not.toMatch(/INNER JOIN/);
  });

  it("tenantBackup service: createBackup's re-read and downloadBackup LEFT-join creator (and tenant)", async () => {
    jest.spyOn(models.Tenant, "findByPk").mockResolvedValue({ id: TENANT, toJSON: () => ({ id: TENANT }) });
    jest.spyOn(models.TenantBackup, "createBackup").mockResolvedValue({ id: ID });
    // S-32: the COMPLETED step and its audit row commit in one managed
    // transaction; there is no database here, so run the callback directly.
    jest.spyOn(models.sequelize, "transaction").mockImplementation(async (callback) => callback({}));
    jest.spyOn(models.TenantBackup, "updateStatus").mockResolvedValue(undefined);
    jest.spyOn(models.Users, "findAll").mockResolvedValue([]);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "createReadStream").mockImplementation(() => Readable.from([Buffer.from("zip")]));

    // Before A-90 this threw "User is not associated to TenantBackup!": the
    // `creator` association every one of these includes names did not exist,
    // so createBackup wrote the archive and then marked the backup FAILED.
    const created = await asTenant(() =>
      tenantBackupService.createBackup({ tenantId: TENANT, createdById: ID, name: "b", models }),
    );
    expect(created.status).toBe(201);
    const creator = models.TenantBackup.associations.creator;
    expect(creator.target).toBe(models.User);
    expect(creator.identifierField).toBe("created_by");
    await asTenant(() => tenantBackupService.downloadBackup(ID, models).catch(() => {}));

    const [reread, download] = rowSelects();
    expectLeft(reread, [["users", "creator", true]]);
    expectLeft(download, [
      ["users", "creator", true],
      ["tenants", "tenant", false],
    ]);
  });

  it("tenantBackup controller: getBackup LEFT-joins creator and tenant", async () => {
    await asTenant(() =>
      tenantBackupController.getBackup({ params: { backupId: ID }, user: {} }, resDouble(), jest.fn()),
    );

    expectLeft(rowSelects()[0], [
      ["users", "creator", true],
      ["tenants", "tenant", false],
    ]);
  });

  it("session controller: list, detail and revoke LEFT-join user (and the user's role)", async () => {
    const req = {
      query: {},
      params: { id: ID },
      body: {},
      user: { id: ID, role: { name: "SUPER_ADMIN" } },
    };
    await asTenant(() => sessionController.getAllSessions(req, resDouble(), jest.fn()));
    await asTenant(() => sessionController.getSessionById(req, resDouble(), jest.fn()));
    await asTenant(() => sessionController.revokeSession(req, resDouble(), jest.fn()));

    const [list, detail, revoke] = rowSelects();
    const spec = [
      ["users", "user", true],
      ["roles", "user->role", false],
    ];
    expectLeft(list, spec);
    expectLeft(detail, spec);
    expectLeft(revoke, [["users", "user", true]]);
    expect(counts()[0]).not.toMatch(/INNER JOIN/);
  });
});

describe("A-90 — defaultScoped includes found outside the A-87 list", () => {
  it("content: a published post with no category is still found by slug (categories LEFT-joined)", async () => {
    await contentService.getPublishedPostBySlug("hello").catch(() => {});

    const sql = rowSelects()[0];
    expect(sql).toMatch(/LEFT OUTER JOIN \( "post_categories" AS "categories->PostCategory"/);
    expect(sql).not.toMatch(/INNER JOIN \( "post_categories"/);
  });

  it("userPermission: a user whose role is soft-deleted is still found (role LEFT-joined)", async () => {
    await asTenant(() => userPermissionService.getUserPermissions(ID).catch(() => {}));

    expectLeft(rowSelects()[0], [["roles", "role", false]]);
  });

  it("workflow: a step whose role is soft-deleted stays in the workflow (steps->role LEFT-joined)", async () => {
    await asTenant(() => workflowService.getWorkflows(TENANT));
    await asTenant(() => workflowService.getWorkflowById(TENANT, ID).catch(() => {}));

    for (const sql of rowSelects()) {
      expectLeft(sql, [["roles", "steps->role", false]]);
    }
  });
});

describe("A-90 — includes that are INNER on purpose (pinned, so a 'fix' has to read the comment)", () => {
  it("apiKey.verifyApiKey: a key whose tenant is soft-deleted does not authenticate", async () => {
    await apiKeyService.verifyApiKey("cbk_whatever");

    // The tenant join is the filter: with a LEFT JOIN a soft-deleted tenant
    // reads as `tenant: null`, and auth.middleware's suspended/deleted check
    // (`key.tenant && ...`) would let the key through.
    expect(join(rowSelects()[0], "tenants", "tenant").type).toBe("INNER");
  });
});
