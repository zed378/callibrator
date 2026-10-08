/**
 * P21-09 — the facility dimension of the global hooks (ADR-124 Am. 2 § 8; spec
 * MEMORY/specs/P19-04-client-facilities.md § 7.3 – § 7.5; threat model G-01, G-03, G-05, G-06).
 *
 * Drives the REAL Sequelize Model class and PostgreSQL query generator with the real hooks
 * (`register`); only the wire is stubbed, so every assertion reads the SQL PostgreSQL would get
 * (the A-365 / W-33 technique). The direct calls at the end pin the row-level guards.
 *
 * Fail-before (recorded in the P21-09 record): with the facility steps removed from `register`,
 * "a bound principal's find is confined to its facility" sent no `client_facility_id` predicate,
 * and "a provider-internal model is denied" returned the tenant's vendors.
 */
import { DataTypes, Op, Sequelize } from "sequelize";
import type { Model, ModelStatic } from "sequelize";
import {
  applyFacilityAssignment,
  applyFacilityAssignmentBulk,
  assertSameFacility,
  assertUpsertFacility,
  columnOf,
  facilityKeyOf,
  refuseFacilityChange,
  refuseScopedTruncate,
  register,
  resolveFacilityScope,
} from "../../utils/tenantScope.util";
import type { ScopedModel } from "../../utils/tenantScope.util";
import { tenantStorage, type TenantContextStore } from "../../middlewares/tenantContext.middleware";
import { NO_FACILITY_ID, NO_TENANT_ID, type ClientFacilityId, type TenantId } from "../../types/ids";

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TenantId;
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1" as ClientFacilityId;
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2" as ClientFacilityId;
const U1 = "11111111-1111-4111-8111-111111111111";

const ctx = (over: Partial<TenantContextStore> = {}): TenantContextStore => ({
  tenantId: T,
  isSuperAdmin: false,
  isSystemTask: false,
  userId: U1,
  clientFacilityId: F1,
  facilityBound: true,
  ...over,
});
const bound = <R>(fn: () => R, over: Partial<TenantContextStore> = {}): R => tenantStorage.run(ctx(over), fn);
const unbound = <R>(fn: () => R): R => tenantStorage.run(ctx({ clientFacilityId: null, facilityBound: false }), fn);

describe("P21-09 — the facility dimension of the tenant hooks", () => {
  let db: Sequelize;
  let Device: ModelStatic<Model>;
  let Vendor: ModelStatic<Model>;
  let Facility: ModelStatic<Model>;
  let Session: ModelStatic<Model>;
  let Role: ModelStatic<Model>;
  let Tag: ModelStatic<Model>;
  let Reading: ModelStatic<Model>;
  let Note: ModelStatic<Model>;
  let sql: string[];

  beforeAll(() => {
    db = new Sequelize("postgres://u:p@127.0.0.1:5432/none", { dialect: "postgres", logging: false });
    register(db as unknown as Parameters<typeof register>[0]);
    // A fresh definition per attribute: Sequelize writes `field` onto the object it is given.
    const uuid = (): { type: typeof DataTypes.UUID } => ({ type: DataTypes.UUID });
    Vendor = db.define("Vendor", { id: { ...uuid(), primaryKey: true }, tenantId: uuid(), name: DataTypes.STRING }, { tableName: "vendors", underscored: true, timestamps: false });
    Facility = db.define("ClientFacility", { id: { ...uuid(), primaryKey: true }, tenantId: uuid(), name: DataTypes.STRING }, { tableName: "client_facilities", underscored: true, timestamps: false });
    Session = db.define("Session", { id: { ...uuid(), primaryKey: true }, tenant_id: uuid(), user_id: uuid() }, { tableName: "sessions", timestamps: false });
    Role = db.define("Role", { id: { ...uuid(), primaryKey: true }, name: DataTypes.STRING }, { tableName: "roles", underscored: true, timestamps: false });
    Device = db.define(
      "CalibrationDevice",
      { id: { ...uuid(), primaryKey: true }, tenantId: uuid(), clientFacilityId: uuid(), vendorId: uuid(), name: DataTypes.STRING, count: DataTypes.INTEGER },
      { tableName: "calibration_devices", underscored: true, timestamps: false, paranoid: false },
    );
    Reading = db.define(
      "IotReading",
      { id: { ...uuid(), primaryKey: true }, tenantId: uuid(), clientFacilityId: uuid(), deviceId: uuid() },
      { tableName: "iot_readings", underscored: true, timestamps: false },
    );
    Note = db.define(
      "Note",
      { id: { ...uuid(), primaryKey: true }, tenantId: uuid(), clientFacilityId: uuid(), title: DataTypes.STRING },
      { tableName: "notes", underscored: true, timestamps: true, paranoid: true },
    );
    Tag = db.define("Tag", { id: { ...uuid(), primaryKey: true }, tenantId: uuid() }, { tableName: "tags", underscored: true, timestamps: false });
    const DeviceTag = db.define("DeviceTag", { tenantId: uuid() }, { tableName: "device_tags", underscored: true, timestamps: false });
    Device.belongsTo(Vendor, { foreignKey: "vendorId", as: "vendor" });
    Device.belongsTo(Facility, { foreignKey: "clientFacilityId", as: "clientFacility" });
    Device.hasMany(Reading, { foreignKey: "deviceId", as: "readings" });
    Reading.belongsTo(Vendor, { foreignKey: "deviceId", as: "vendor", constraints: false });
    Device.belongsToMany(Tag, { through: DeviceTag, as: "tags", foreignKey: "deviceId", otherKey: "tagId" });
    // A global target through a global join table: neither gets a facility predicate.
    const DeviceRole = db.define("DeviceRole", { note: DataTypes.STRING }, { tableName: "device_roles", underscored: true, timestamps: false });
    Device.belongsToMany(Role, { through: DeviceRole, as: "roles", foreignKey: "deviceId", otherKey: "roleId" });
  });

  beforeEach(() => {
    sql = [];
    jest.spyOn(db, "query").mockImplementation(((statement: unknown, options?: { plain?: boolean }) => {
      const text = typeof statement === "object" && statement !== null ? String((statement as { query?: unknown }).query) : String(statement);
      sql.push(text);
      if (/^(UPDATE|DELETE|TRUNCATE)/.test(text)) {return Promise.resolve([[], 0]);}
      return Promise.resolve(options?.plain ? { count: 0, sum: 0 } : []);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("resolveFacilityScope — every line of § 7.3", () => {
    it("skips on skipFacilityScope, no context, a system task, the super admin and an unbound principal", () => {
      const model = Device as unknown as ScopedModel;
      expect(bound(() => resolveFacilityScope(model, true))).toEqual({ mode: "skip" });
      expect(resolveFacilityScope(model)).toEqual({ mode: "skip" });
      expect(bound(() => resolveFacilityScope(model), { isSystemTask: true })).toEqual({ mode: "skip" });
      expect(bound(() => resolveFacilityScope(model), { isSuperAdmin: true })).toEqual({ mode: "skip" });
      expect(unbound(() => resolveFacilityScope(model))).toEqual({ mode: "skip" });
      // A context written before P21-09 (no facility fields) is unbound.
      expect(tenantStorage.run({ tenantId: T, isSuperAdmin: false, isSystemTask: false }, () => resolveFacilityScope(model))).toEqual({ mode: "skip" });
    });

    it("filters a facility model to the bound facility — NO_FACILITY_ID when the context names none", () => {
      expect(bound(() => resolveFacilityScope(Device as unknown as ScopedModel))).toEqual({ mode: "filter", key: "clientFacilityId", value: F1 });
      expect(bound(() => resolveFacilityScope(Device as unknown as ScopedModel), { clientFacilityId: null })).toEqual({
        mode: "filter",
        key: "clientFacilityId",
        value: NO_FACILITY_ID,
      });
    });

    it("skips a global model (no tenant key, no facility key)", () => {
      expect(bound(() => resolveFacilityScope(Role as unknown as ScopedModel))).toEqual({ mode: "skip" });
    });

    it("reads FACILITY_READABLE: own facility (ClientFacility.id), own user (Session.user_id — snake case)", () => {
      expect(bound(() => resolveFacilityScope(Facility as unknown as ScopedModel))).toEqual({ mode: "rule", key: "id", value: F1 });
      expect(bound(() => resolveFacilityScope(Session as unknown as ScopedModel))).toEqual({ mode: "rule", key: "user_id", value: U1 });
      expect(bound(() => resolveFacilityScope(Session as unknown as ScopedModel), { userId: null })).toEqual({ mode: "rule", key: "user_id", value: NO_TENANT_ID });
      expect(bound(() => resolveFacilityScope(Facility as unknown as ScopedModel), { clientFacilityId: null })).toEqual({ mode: "rule", key: "id", value: NO_FACILITY_ID });
    });

    it("denies any other tenant model (provider-internal) on its tenant column", () => {
      expect(bound(() => resolveFacilityScope(Vendor as unknown as ScopedModel))).toEqual({ mode: "deny", key: "tenantId", value: NO_TENANT_ID });
      expect(bound(() => resolveFacilityScope(Tag as unknown as ScopedModel))).toEqual({ mode: "deny", key: "tenantId", value: NO_TENANT_ID });
    });

    it("facilityKeyOf reads both spellings and none", () => {
      expect(facilityKeyOf(Device as unknown as ScopedModel)).toBe("clientFacilityId");
      expect(facilityKeyOf({ rawAttributes: { client_facility_id: {} } } as unknown as ScopedModel)).toBe("client_facility_id");
      expect(facilityKeyOf(Vendor as unknown as ScopedModel)).toBeNull();
      expect(facilityKeyOf(null)).toBeNull();
      const empty: ScopedModel = Object.create(null) as ScopedModel;
      expect(facilityKeyOf(empty)).toBeNull();
    });
  });

  describe("reads (G-01)", () => {
    it("a bound principal's find is confined to its facility, beside the tenant predicate", async () => {
      await bound(() => Device.findAll({ where: { name: "x" } }));
      expect(sql[0]).toContain(`"CalibrationDevice"."tenant_id" = '${T}'`);
      expect(sql[0]).toContain(`"CalibrationDevice"."client_facility_id" = '${F1}'`);
    });

    it("the predicate is FORCED: a caller's own facility filter (another facility, an Op.or) cannot widen it", async () => {
      await bound(() => Device.findAll({ where: { clientFacilityId: F2 } }));
      expect(sql[0]).toContain(`"client_facility_id" = '${F1}'`);
      expect(sql[0]).not.toContain(F2);
      await bound(() => Device.findAll({ where: { [Op.or]: [{ clientFacilityId: F2 }, { name: "y" }] } }));
      expect(sql[1]).toContain(`"CalibrationDevice"."client_facility_id" = '${F1}'`);
    });

    it("skipTenantScope does not skip the facility dimension (FT-30)", async () => {
      await bound(() => Device.findAll({ skipTenantScope: true }));
      expect(sql[0]).not.toContain(`"tenant_id" = '${T}'`);
      expect(sql[0]).toContain(`"client_facility_id" = '${F1}'`);
    });

    it("a provider-internal model is denied with NO_TENANT_ID — even with skipTenantScope", async () => {
      await bound(() => Vendor.findAll());
      expect(sql[0]).toContain(`"Vendor"."tenant_id" = '${NO_TENANT_ID}'`);
      await bound(() => Vendor.findAll({ skipTenantScope: true }));
      expect(sql[1]).toContain(`"Vendor"."tenant_id" = '${NO_TENANT_ID}'`);
    });

    it("a readable model gets its rule", async () => {
      await bound(() => Session.findAll());
      expect(sql[0]).toContain(`"Session"."user_id" = '${U1}'`);
      await bound(() => Facility.findAll());
      expect(sql[1]).toContain(`"ClientFacility"."id" = '${F1}'`);
    });

    it("skipFacilityScope (reviewed) leaves only the tenant predicate", async () => {
      await bound(() => Vendor.findAll({ skipFacilityScope: true }));
      expect(sql[0]).toContain(`"Vendor"."tenant_id" = '${T}'`);
      expect(sql[0]).not.toContain(NO_TENANT_ID);
    });

    it("an unbound principal and the super admin are untouched", async () => {
      await unbound(() => Device.findAll());
      await bound(() => Device.findAll(), { isSuperAdmin: true });
      expect(sql[0]).not.toContain('"client_facility_id" =');
      expect(sql[1]).not.toContain('"client_facility_id" =');
    });

    it("count, sum (aggregate) and increment carry the facility predicate (FT-11, FT-17, FT-18)", async () => {
      await bound(() => Device.count());
      expect(sql[0]).toContain(`"client_facility_id" = '${F1}'`);
      await bound(() => Device.sum("count"));
      expect(sql[1]).toContain(`"client_facility_id" = '${F1}'`);
      await bound(() => Device.increment("count", { where: { name: "x" } }));
      expect(sql[2]).toContain(`"client_facility_id" = '${F1}'`);
      expect(sql[2]).toContain(`"tenant_id" = '${T}'`);
      // skipTenantScope on increment still gets the facility predicate.
      // IncrementDecrementOptions does not declare skipTenantScope; the hooks read it all the same.
      const skipped: Record<string, unknown> = { where: { name: "x" }, skipTenantScope: true };
      await bound(() => Device.increment("count", skipped));
      expect(sql[3]).toContain(`"client_facility_id" = '${F1}'`);
      expect(sql[3]).not.toContain(`"tenant_id" = '${T}'`);
      // Unbound: increment is the tenant one only.
      await unbound(() => Device.increment("count", { where: { name: "x" } }));
      expect(sql[4]).not.toContain("client_facility_id");
      // Super admin: no predicate at all.
      await bound(() => Device.increment("count", { where: { name: "x" } }), { isSuperAdmin: true });
      expect(sql[5]).not.toContain("tenant_id");
    });
  });

  describe("includes (G-03, AM-5)", () => {
    it("a provider-internal include is denied in its ON clause and stays a LEFT join", async () => {
      await bound(() => Device.findAll({ include: [{ model: Vendor, as: "vendor" }] }));
      expect(sql[0]).toMatch(/LEFT OUTER JOIN "vendors" AS "vendor" ON [^]*"vendor"\."tenant_id" = '00000000-0000-0000-0000-000000000000'/);
    });

    it("an INNER include stays INNER, with the deny in its ON clause (the row drops)", async () => {
      await bound(() => Device.findAll({ include: [{ model: Vendor, as: "vendor", required: true }] }));
      expect(sql[0]).toMatch(/INNER JOIN "vendors" AS "vendor" ON [^]*"vendor"\."tenant_id" = '00000000-0000-0000-0000-000000000000'/);
    });

    it("a readable include gets its rule; a through model is resolved on its own", async () => {
      await bound(() => Device.findAll({ include: [{ model: Facility, as: "clientFacility" }, { model: Tag, as: "tags" }] }));
      expect(sql[0]).toMatch(/LEFT OUTER JOIN "client_facilities" AS "clientFacility" ON [^]*"clientFacility"\."id" = '/);
      expect(sql[0]).toContain(`"tags->DeviceTag"."tenant_id" = '${NO_TENANT_ID}'`);
    });

    it("a facility include gets the facility predicate; a separate include re-enters beforeFind", async () => {
      await bound(() => Device.findAll({ include: [{ model: Reading, as: "readings", separate: true }] }));
      // The separate query never ran (no parent rows came back); the root carries the predicate.
      expect(sql[0]).toContain(`"CalibrationDevice"."client_facility_id" = '${F1}'`);
      await bound(() => Device.findAll({ include: [{ model: Reading, as: "readings" }] }));
      expect(sql[1]).toContain(`"readings"."client_facility_id" = '${F1}'`);
    });

    it("include-level and root skipFacilityScope are honoured; skipTenantScope at the root still scopes includes", async () => {
      const include: Record<string, unknown> = { model: Vendor, as: "vendor", skipFacilityScope: true };
      await bound(() => Device.findAll({ include: [include] }));
      expect(sql[0]).not.toContain(`"vendor"."tenant_id" = '${NO_TENANT_ID}'`);
      await bound(() => Device.findAll({ skipFacilityScope: true, include: [{ model: Vendor, as: "vendor" }] }));
      expect(sql[1]).not.toContain(NO_TENANT_ID);
      await bound(() => Device.findAll({ skipTenantScope: true, include: [{ model: Vendor, as: "vendor" }] }));
      expect(sql[2]).toMatch(/LEFT OUTER JOIN "vendors" AS "vendor" ON [^]*"vendor"\."tenant_id" = '00000000-0000-0000-0000-000000000000'/);
    });

    it("a global include through a global table gets nothing; a given `through` keeps its options", async () => {
      await bound(() => Device.findAll({ include: [{ model: Role, as: "roles" }] }));
      expect(sql[0]).not.toContain("\"roles->DeviceRole\".\"tenant_id\"");
      await bound(() => Device.findAll({ include: [{ model: Tag, as: "tags", through: { attributes: [] } }] }));
      expect(sql[1]).toContain(`"tags->DeviceTag"."tenant_id" = '${NO_TENANT_ID}'`);
    });

    it("an empty include list under skipTenantScope is conformed away (count runs its hook before any conform)", async () => {
      await bound(() => Device.count({ skipTenantScope: true, include: [] }));
      expect(sql[0]).toContain(`"client_facility_id" = '${F1}'`);
    });

    it("under skipTenantScope a belongsToMany include gets its `through` predicate from the facility walk alone", async () => {
      await bound(() => Device.findAll({ skipTenantScope: true, include: [{ model: Tag, as: "tags" }] }));
      expect(sql[0]).toContain(`"tags->DeviceTag"."tenant_id" = '${NO_TENANT_ID}'`);
    });

    it("columnOf: the field, else the attribute (no attributes, no such attribute, an empty field)", () => {
      expect(columnOf(Device as unknown as ScopedModel, "clientFacilityId")).toBe("client_facility_id");
      const bare: ScopedModel = Object.create(null) as ScopedModel;
      expect(columnOf(bare, "x")).toBe("x");
      const odd: ScopedModel = Object.assign(Object.create(null) as ScopedModel, { rawAttributes: { y: { field: "" } } });
      expect(columnOf(odd, "y")).toBe("y");
      expect(columnOf(odd, "z")).toBe("z");
    });

    it("a nested include list is walked too", async () => {
      await bound(() => Device.findAll({ include: [{ model: Reading, as: "readings", include: [{ model: Vendor, as: "vendor" }] }] }));
      expect(sql[0]).toContain(`"readings"."client_facility_id" = '${F1}'`);
      expect(sql[0]).toContain(`"readings->vendor"."tenant_id" = '${NO_TENANT_ID}'`);
    });

    it("an unbound principal's includes are untouched; a find without includes is unaffected", async () => {
      await unbound(() => Device.findAll({ include: [{ model: Vendor, as: "vendor" }] }));
      expect(sql[0]).not.toContain(NO_TENANT_ID);
      await bound(() => Device.findAll({ include: [] }));
      expect(sql[1]).toContain(`"client_facility_id" = '${F1}'`);
    });
  });

  describe("bulk writes (G-05, G-06)", () => {
    it("a bulk destroy names the COLUMN (W-33)", async () => {
      await bound(() => Device.destroy({ where: { name: "x" } }));
      expect(sql[0]).toContain(`"client_facility_id" = '${F1}'`);
      expect(sql[0]).not.toContain('"clientFacilityId"');
    });

    it("every hook runs through the model API: restore, instance destroy/restore, bulkCreate, upsert", async () => {
      await bound(() => Note.restore({ where: { title: "x" } }));
      // A restore is an UPDATE: bound values; the column name (W-33), not the attribute.
      expect(sql[0]).toBe('UPDATE "notes" SET "deleted_at"=$1 WHERE "title" = $2 AND "tenant_id" = $3 AND "client_facility_id" = $4');
      const mine = Note.build({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenantId: T, clientFacilityId: F1, title: "x" }, { isNewRecord: false, raw: true });
      const theirs = Note.build({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", tenantId: T, clientFacilityId: F2, title: "x" }, { isNewRecord: false, raw: true });
      await expect(bound(() => theirs.destroy())).rejects.toThrow("outside the principal's client facility");
      await expect(bound(() => theirs.restore())).rejects.toThrow("outside the principal's client facility");
      await bound(() => mine.destroy().catch((e: unknown) => { if (String(e).includes("Security Violation")) {throw e;} }));
      await bound(() => mine.restore().catch((e: unknown) => { if (String(e).includes("Security Violation")) {throw e;} }));
      await expect(bound(() => Note.bulkCreate([{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "y", clientFacilityId: F2 }]))).rejects.toThrow(
        "another client facility",
      );
      await expect(bound(() => Note.upsert({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", tenantId: T, title: "y" }))).rejects.toThrow(
        "outside the principal's client facility",
      );
    });

    it("a bulk update is scoped to the facility", async () => {
      await bound(() => Device.update({ name: "y" }, { where: { name: "x" } }));
      // An UPDATE binds its values: the facility is the last parameter.
      expect(sql[0]).toBe('UPDATE "calibration_devices" SET "name"=$1 WHERE "name" = $2 AND "tenant_id" = $3 AND "client_facility_id" = $4');
    });

    it("AM-6: a bulk update of the facility column is refused in EVERY context without the typed option", async () => {
      for (const run of [
        (fn: () => Promise<unknown>) => bound(fn),
        (fn: () => Promise<unknown>) => unbound(fn),
        (fn: () => Promise<unknown>) => bound(fn, { isSuperAdmin: true }),
        (fn: () => Promise<unknown>) => bound(fn, { isSystemTask: true }),
      ]) {
        await expect(run(() => Device.update({ clientFacilityId: F2 }, { where: { name: "x" } }))).rejects.toThrow(
          "Security Violation: A row's client facility changes only through a device move or a user binding",
        );
      }
      expect(sql).toEqual([]);
    });

    it("AM-6: the move and the binding may change it; outside any context the triggers hold, not the hooks", async () => {
      await unbound(() => Device.update({ clientFacilityId: F2 }, { where: { name: "x" }, facilityMove: "move-1" }));
      await unbound(() => Device.update({ clientFacilityId: F2 }, { where: { name: "x" }, facilityBinding: true }));
      await Device.update({ clientFacilityId: F2 }, { where: { name: "x" } });
      expect(sql).toHaveLength(3);
    });

    it("TRUNCATE is refused for a bound principal even with skipTenantScope (FT-19)", () => {
      expect(() => { bound(() => { refuseScopedTruncate({ truncate: true, skipTenantScope: true }, Device as unknown as ScopedModel); }); }).toThrow(
        "Security Violation: Attempted to truncate",
      );
      expect(() => { unbound(() => { refuseScopedTruncate({ truncate: true, skipTenantScope: true }, Device as unknown as ScopedModel); }); }).not.toThrow();
    });
  });

  describe("row-level guards (create, bulkCreate, upsert, update, destroy)", () => {
    const device = Device as unknown as () => ScopedModel;
    const D = (): ScopedModel => device as unknown as ScopedModel;

    it("create: stamps the bound facility, refuses another, refuses provider-internal unless skipFacilityScope", () => {
      const row: Record<string, unknown> = { name: "x" };
      bound(() => { applyFacilityAssignment(row, Device as unknown as ScopedModel, {}); });
      expect(row["clientFacilityId"]).toBe(F1);
      const same = { clientFacilityId: F1 };
      bound(() => { applyFacilityAssignment(same, Device as unknown as ScopedModel, {}); });
      expect(() => { bound(() => { applyFacilityAssignment({ clientFacilityId: F2 }, Device as unknown as ScopedModel, {}); }); }).toThrow(
        "Security Violation: Attempted to create a row of another client facility",
      );
      expect(() => { bound(() => { applyFacilityAssignment({}, Vendor as unknown as ScopedModel, {}); }); }).toThrow(
        "Security Violation: A facility-bound principal cannot create provider-internal data",
      );
      expect(() => { bound(() => { applyFacilityAssignment({}, Vendor as unknown as ScopedModel, { skipFacilityScope: true }); }); }).not.toThrow();
      expect(() => {
        bound(() => {
          applyFacilityAssignment({ name: "new" }, Facility as unknown as ScopedModel, {});
        });
      }).toThrow("Security Violation: A facility-bound principal cannot create a client facility");
      const session: Record<string, unknown> = {};
      bound(() => { applyFacilityAssignment(session, Session as unknown as ScopedModel, {}); });
      expect(session["user_id"]).toBe(U1);
      // Nothing outside a bound context, and nothing for a missing row.
      const plain: Record<string, unknown> = {};
      unbound(() => { applyFacilityAssignment(plain, Device as unknown as ScopedModel, {}); });
      expect(plain).toEqual({});
      expect(() => { bound(() => { applyFacilityAssignment(null, Device as unknown as ScopedModel, null); }); }).not.toThrow();
      expect(D).toBeDefined();
    });

    it("create through the model: the hook stamps before the INSERT", async () => {
      await bound(() => Device.create({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "x" }).catch(() => undefined));
      expect(sql[0]).toMatch(/^INSERT INTO "calibration_devices"/);
    });

    it("bulkCreate: stamps every row, refuses a mismatch, keeps the column in `fields`; deny refuses", () => {
      const rows: Record<string, unknown>[] = [{ name: "a" }, { name: "b", clientFacilityId: F1 }];
      const options = { fields: ["name"] as unknown[] };
      bound(() => { applyFacilityAssignmentBulk(rows, Device as unknown as ScopedModel, options); });
      expect(rows.map((r) => r["clientFacilityId"])).toEqual([F1, F1]);
      expect(options.fields).toContain("clientFacilityId");
      const already = { fields: ["clientFacilityId"] as unknown[] };
      bound(() => { applyFacilityAssignmentBulk([{}], Device as unknown as ScopedModel, already); });
      expect(already.fields).toEqual(["clientFacilityId"]);
      bound(() => { applyFacilityAssignmentBulk(null, Device as unknown as ScopedModel); });
      expect(() => { bound(() => { applyFacilityAssignmentBulk([{ clientFacilityId: F2 }], Device as unknown as ScopedModel); }); }).toThrow(
        "Security Violation: Attempted to bulkCreate a row of another client facility",
      );
      expect(() => { bound(() => { applyFacilityAssignmentBulk([{}], Vendor as unknown as ScopedModel); }); }).toThrow(
        "Security Violation: A facility-bound principal cannot bulkCreate provider-internal data",
      );
      expect(() => { unbound(() => { applyFacilityAssignmentBulk([{ clientFacilityId: F2 }], Device as unknown as ScopedModel); }); }).not.toThrow();
    });

    it("upsert: refuses a missing, mismatched or provider-internal row; passes its own", () => {
      expect(() => { bound(() => { assertUpsertFacility({}, Device as unknown as ScopedModel); }); }).toThrow("outside the principal's client facility");
      expect(() => { bound(() => { assertUpsertFacility(null, Device as unknown as ScopedModel); }); }).toThrow("outside the principal's client facility");
      expect(() => { bound(() => { assertUpsertFacility({ clientFacilityId: F2 }, Device as unknown as ScopedModel); }); }).toThrow("outside");
      expect(() => { bound(() => { assertUpsertFacility({}, Vendor as unknown as ScopedModel); }); }).toThrow("cannot upsert provider-internal data");
      expect(() => { bound(() => { assertUpsertFacility({ clientFacilityId: F1 }, Device as unknown as ScopedModel); }); }).not.toThrow();
      expect(() => { unbound(() => { assertUpsertFacility({}, Device as unknown as ScopedModel); }); }).not.toThrow();
    });

    it("destroy / restore (instance): only the bound facility's own rows", () => {
      expect(() => { bound(() => { assertSameFacility({ clientFacilityId: F1 }, Device as unknown as ScopedModel); }); }).not.toThrow();
      expect(() => { bound(() => { assertSameFacility({ clientFacilityId: F2 }, Device as unknown as ScopedModel); }); }).toThrow("outside the principal's client facility");
      expect(() => { bound(() => { assertSameFacility(null, Device as unknown as ScopedModel); }); }).toThrow("outside");
      expect(() => { bound(() => { assertSameFacility({ tenantId: T }, Vendor as unknown as ScopedModel); }); }).toThrow("outside");
      expect(() => { unbound(() => { assertSameFacility({ clientFacilityId: F2 }, Device as unknown as ScopedModel); }); }).not.toThrow();
    });

    it("AM-6 instance update: a changed facility is refused without the typed option, in any context", async () => {
      const instance = Device.build({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", tenantId: T, clientFacilityId: F1, name: "x" }, { isNewRecord: false, raw: true });
      instance.set("clientFacilityId", F2);
      await expect(unbound(() => instance.save())).rejects.toThrow("changes only through a device move or a user binding");
      expect(() => { unbound(() => { refuseFacilityChange(instance as unknown as Record<string, unknown>, Device as unknown as ScopedModel, { facilityMove: "m" }); }); }).not.toThrow();
      expect(() => { unbound(() => { refuseFacilityChange(instance as unknown as Record<string, unknown>, Device as unknown as ScopedModel, { facilityBinding: true }); }); }).not.toThrow();
      // Outside a context, on a model without the column, on a plain object: nothing to refuse.
      expect(() => { refuseFacilityChange(instance as unknown as Record<string, unknown>, Device as unknown as ScopedModel); }).not.toThrow();
      expect(() => { unbound(() => { refuseFacilityChange({}, Vendor as unknown as ScopedModel); }); }).not.toThrow();
      expect(() => { unbound(() => { refuseFacilityChange({ clientFacilityId: F2 }, Device as unknown as ScopedModel); }); }).not.toThrow();
      expect(() => { unbound(() => { refuseFacilityChange(null, Device as unknown as ScopedModel); }); }).not.toThrow();
      // An unchanged facility saves.
      const other = Device.build({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", tenantId: T, clientFacilityId: F1, name: "x" }, { isNewRecord: false, raw: true });
      other.set("name", "y");
      await bound(() => other.save().catch((e: unknown) => {
        // The stubbed wire returns no row; only a security refusal would fail the test.
        if (String(e).includes("Security Violation")) {throw e;}
      }));
    });
  });
});
