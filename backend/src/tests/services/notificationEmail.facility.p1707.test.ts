/** PT-18: real recipient, notification, channel and HTML services; only transport is captured.
 * RabbitMQ delivery is intentionally replaced, so this is not a live SMTP/worker proof.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as EmailModule from "../../services/email.service";
import type * as JobModule from "../../utils/jobContext.util";
import type * as RecipientsModule from "../../services/notificationRecipients";
import type * as NotificationModule from "../../services/notification.service";
import type * as SchedulerModule from "../../services/calibrationScheduler.service";
import { seedRealMatrix } from "../fixtures/seededMatrix";
import { ROLE_IDS } from "../../constants/roleConstants";

interface Mail { to: string; subject: string; html: string }
const mockMail: Mail[] = [];
jest.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: (mail: Mail) => { mockMail.push(mail); return Promise.resolve({ messageId: "captured" }); } }),
}));
jest.mock("../../services/emailQueue.service", () => ({
  queueNotificationEmail: async (data: Parameters<typeof EmailModule.sendNotificationEmail>[0]) => {
    const email = jest.requireActual<typeof EmailModule>("../../services/email.service");
    await email.sendNotificationEmail(data);
    return true;
  },
}));
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../config/socket", () => ({ getIo: () => ({ to: () => ({ emit: jest.fn() }) }) }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)), set: jest.fn(() => Promise.resolve(undefined)),
  del: jest.fn(() => Promise.resolve(undefined)), delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_target, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));
jest.mock("../../services/maintenance.service", () => ({
  createAutoScheduledWorkOrders: (_tenant: string, items: { deviceId: string }[]) => Promise.resolve({
    created: items.map((item) => ({ id: item.deviceId, deviceId: item.deviceId })), conflicted: [], missing: [],
  }),
}));
jest.mock("../../services/webhook.service", () => ({ emitEvent: jest.fn(() => Promise.resolve({ matched: 0 })) }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(() => Promise.resolve({})) }));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const { runForTenant } = jest.requireActual<typeof JobModule>("../../utils/jobContext.util");
const { recipientsFor } = jest.requireActual<typeof RecipientsModule>("../../services/notificationRecipients");
const notificationService = jest.requireActual<typeof NotificationModule>("../../services/notification.service");
const scheduler = jest.requireActual<typeof SchedulerModule>("../../services/calibrationScheduler.service");
const T = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "bbbbbbbb-0000-4000-8000-000000000002";
const F1 = "f1111111-0000-4000-8000-000000000001";
const F2 = "f2222222-0000-4000-8000-000000000002";
const uid = (n: number): string => `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
const devices = [F1, F2].map((facility, i) => ({
  id: `dddddddd-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, tenantId: T, clientFacilityId: facility,
  name: `ONLY_F${String(i + 1)}_<img src=x onerror=alert(1)>`, serialNumber: `SERIAL_F${String(i + 1)}`,
  nextCalibrationDate: new Date("2020-01-01"), isDeleted: false,
}));

beforeEach(async () => {
  mdb.reset();
  mockMail.length = 0;
  await seedRealMatrix(mdb);
  mdb.seed("User", [F1, F2, F1].map((facility, i) => ({
    id: uid(i + 1), tenantId: i === 2 ? T2 : T, clientFacilityId: facility,
    username: `tech${String(i)}`, email: `f${String(i + 1)}@example.test`, firstName: `Tech ${String(i + 1)}`,
    roleId: ROLE_IDS.HEALTHCARE_TECHNICIAN, isActive: true, status: "ACTIVE", password: "not-a-hash",
  })));
  mdb.seed("CalibrationDevice", devices);
});

describe("PT-18 notification email boundary", () => {
  it("the real reminder scan remains realtime-only, with no outbound email", async () => {
    const summary = await scheduler.runCalibrationScan({ tenantId: T });
    expect(summary.notificationsCreated).toBe(2);
    expect(mockMail).toEqual([]);
  });

  it("opt-in addressed mail renders each facility's content only, with HTML escaped", async () => {
    await runForTenant(T, async () => {
      for (const device of devices) {
        const audience = await recipientsFor(device, "calibration");
        expect(audience.boundUserIds).toEqual([uid(device.clientFacilityId === F1 ? 1 : 2)]);
        await mdb.sequelize.transaction(async (transaction) => {
          for (const userId of audience.boundUserIds) {
            await notificationService.emitNotification({
              tenantId: T, userId, type: "CALIBRATION", title: "Device calibration overdue",
              message: `${device.name} (${device.serialNumber})`, channels: ["email"],
            }, { transaction });
          }
          expect(mockMail).toHaveLength(device.clientFacilityId === F1 ? 0 : 1);
        });
      }
    });
    expect(mockMail).toHaveLength(2);
    for (const [index, mail] of mockMail.entries()) {
      const own = index + 1;
      const other = own === 1 ? 2 : 1;
      expect(mail.to).toBe(`f${String(own)}@example.test`);
      expect(mail.html).toContain(`ONLY_F${String(own)}_&lt;img`);
      expect(mail.html).toContain(`SERIAL_F${String(own)}`);
      expect(mail.html).not.toContain(`ONLY_F${String(other)}`);
      expect(mail.html).not.toContain(`SERIAL_F${String(other)}`);
      expect(mail.html).not.toContain("<img src=x");
    }
  });

  it("a rolled-back addressed notification never reaches the mail transport", async () => {
    await expect(runForTenant(T, () => mdb.sequelize.transaction(async (transaction) => {
      await notificationService.emitNotification({
        tenantId: T, userId: uid(1), title: "Do not deliver", message: "ONLY_F1", channels: ["email"],
      }, { transaction });
      throw new Error("rollback proof");
    }))).rejects.toThrow("rollback proof");
    expect(mockMail).toEqual([]);
  });
});
