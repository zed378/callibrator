/**
 * P21-09d — G-21 (spec P19-04 § 9.6; AM-21, EP-15): reminders reach only the row's facility.
 *
 * 1. `recipientsFor` over memoryDb with the REAL seeded role matrix: the users bound to the row's
 *    facility who hold `calibration` read (role ⊕ override, capped by the bound ceiling) — never a
 *    user of another facility or tenant, an inactive one, or one whose override removes the menu;
 *    a row with no facility (or an unbound tenant) is the broadcast alone.
 * 2. The calibration scan (`calibrationScheduler.service`) sends the tenant broadcast as before
 *    and one addressed notification, with its own audit row, to each bound recipient — in the
 *    same transaction.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import { seedRealMatrix } from "../fixtures/seededMatrix";
import { ROLE_IDS } from "../../constants/roleConstants";
import type * as RecipientsModule from "../../services/notificationRecipients";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- after the mocks above
const { recipientsFor } = require("../../services/notificationRecipients") as typeof RecipientsModule;

const T = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const F3 = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const u = (n: number): string => `cccccccc-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const user = (id: string, tenantId: string, roleKey: keyof typeof ROLE_IDS, clientFacilityId: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  tenantId,
  username: id.slice(-4),
  email: `${id.slice(-4)}@example.test`,
  password: "not-a-hash",
  roleId: ROLE_IDS[roleKey],
  clientFacilityId,
  status: "ACTIVE",
  isActive: true,
  ...extra,
});

beforeEach(async () => {
  mdb.reset();
  await seedRealMatrix(mdb, { [u(5)]: { calibration: "none" } });
  mdb.seed("ClientFacility", [
    { id: F1, tenantId: T, name: "Facility One", code: "F-0001", status: "active" },
    { id: F2, tenantId: T, name: "Facility Two", code: "F-0002", status: "active" },
    { id: F3, tenantId: T2, name: "Facility Three", code: "F-0003", status: "active" },
  ]);
  mdb.seed("User", [
    user(u(1), T, "HEALTHCARE_TECHNICIAN", F1),
    user(u(2), T, "ROOM_USER", F1),
    user(u(3), T, "HEALTHCARE_TECHNICIAN", F2),
    user(u(4), T, "HEALTHCARE_TECHNICIAN", F1, { isActive: false, status: "INACTIVE" }),
    user(u(5), T, "HEALTCARE_ADMIN", F1),
    user(u(6), T, "TECHNICIAN", null),
    user(u(7), T2, "HEALTHCARE_TECHNICIAN", F3),
  ]);
});

describe("G-21 recipientsFor — only the row's facility", () => {
  it("a device in F1: F1's active bound users holding calibration read — not F2's, not T2's, not the inactive one, not the override-removed one", async () => {
    const out = await recipientsFor({ tenantId: T, clientFacilityId: F1 }, "calibration");
    expect(out).toEqual({ broadcast: true, boundUserIds: [u(1), u(2)] });
  });

  it("a device in F2 reaches F2's user only", async () => {
    expect((await recipientsFor({ tenantId: T, clientFacilityId: F2 }, "calibration")).boundUserIds).toEqual([u(3)]);
  });

  it("the facility of the ROW decides, not a matching id in another tenant", async () => {
    expect((await recipientsFor({ tenantId: T, clientFacilityId: F3 }, "calibration")).boundUserIds).toEqual([]);
  });

  it("a menu outside the bound ceiling reaches nobody bound", async () => {
    expect((await recipientsFor({ tenantId: T, clientFacilityId: F1 }, "users")).boundUserIds).toEqual([]);
  });

  it("inside a transaction; a user whose role is gone holds nothing", async () => {
    mdb.seed("User", user(u(8), T, "HEALTHCARE_TECHNICIAN", F1, { roleId: "99999999-0000-4000-8000-000000000099" }));
    const out = await mdb.sequelize.transaction((transaction) => recipientsFor({ tenantId: T, clientFacilityId: F1 }, "calibration", { transaction }));
    expect(out.boundUserIds).toEqual([u(1), u(2)]);
  });

  it("a row with no facility: the broadcast alone, nothing read", async () => {
    expect(await recipientsFor({ tenantId: T, clientFacilityId: null }, "calibration")).toEqual({ broadcast: true, boundUserIds: [] });
    expect(await recipientsFor({ tenantId: T }, "calibration")).toEqual({ broadcast: true, boundUserIds: [] });
  });
});

describe("G-21 the calibration scan — broadcast plus each bound recipient, audited in one transaction", () => {
  it("one broadcast and one addressed notification per bound user of the device's facility", async () => {
    const emitted: Record<string, unknown>[] = [];
    const audited: Record<string, unknown>[] = [];
    const transactions: unknown[] = [];
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../../models", () => ({
        CalibrationDevice: {
          findAll: jest.fn(() =>
            Promise.resolve([{ id: "d1", tenantId: T, clientFacilityId: F1, name: "Dev", serialNumber: "s", nextCalibrationDate: new Date("2020-01-01") }]),
          ),
        },
        MaintenanceWorkOrder: { findAll: jest.fn(() => Promise.resolve([])) },
      }));
      jest.doMock("../../services/notificationRecipients", () => ({
        recipientsFor: jest.fn((row: { clientFacilityId: string }) =>
          Promise.resolve({ broadcast: true, boundUserIds: row.clientFacilityId === F1 ? [u(1), u(2)] : [] }),
        ),
      }));
      jest.doMock("../../services/maintenance.service", () => ({
        createAutoScheduledWorkOrders: jest.fn((_t: string, items: { deviceId: string }[]) =>
          Promise.resolve({ created: items.map((i) => ({ id: "wo1", deviceId: i.deviceId })), conflicted: [], missing: [] }),
        ),
      }));
      jest.doMock("../../services/notification.service", () => ({
        emitNotification: jest.fn((data: Record<string, unknown>, opts: { transaction?: unknown }) => {
          emitted.push(data);
          transactions.push(opts.transaction);
          return Promise.resolve({ id: `n${String(emitted.length)}` });
        }),
      }));
      jest.doMock("../../services/webhook.service", () => ({ emitEvent: jest.fn(() => Promise.resolve({ matched: 0 })) }));
      jest.doMock("../../services/audit.service", () => ({
        logAction: jest.fn((entry: Record<string, unknown>, opts: { transaction?: unknown }) => {
          audited.push(entry);
          transactions.push(opts.transaction);
          return Promise.resolve({});
        }),
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under the doMocks above
      const scheduler = require("../../services/calibrationScheduler.service") as { runCalibrationScan: (o: { tenantId: string }) => Promise<{ notificationsCreated: number }> };
      const summary = await scheduler.runCalibrationScan({ tenantId: T });
      expect(summary.notificationsCreated).toBe(1);
    });
    expect(emitted.map((n) => n["userId"])).toEqual([null, u(1), u(2)]);
    expect(audited.map((a) => (a["changes"] as { audience: string }).audience)).toEqual(["tenant", "facility-user", "facility-user"]);
    expect(transactions).toHaveLength(6);
    expect(new Set(transactions).size).toBe(1);
  });
});
