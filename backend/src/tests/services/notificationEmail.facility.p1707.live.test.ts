/** PT-18 opt-in email path: real PostgreSQL, RabbitMQ consumer, SMTP and Mailpit.
 * The reminder scan remains realtime-only; this does not add an email policy to it.
 * Requires a dedicated broker/Mailpit, MAIL_HOST/PORT and E2E_MAILPIT_URL.
 */
import type { Sequelize } from "sequelize";
import { randomUUID } from "crypto";
import type * as Boot from "../fixtures/liveBoot";
import type * as Notification from "../../services/notification.service";
import type * as Queue from "../../services/emailQueue.service";
import type * as Rabbit from "../../services/rabbitmq.service";
import type * as Redis from "../../services/redis.service";
import type * as Recipients from "../../services/notificationRecipients";
import type * as Jobs from "../../utils/jobContext.util";
import type * as Scheduler from "../../services/calibrationScheduler.service";
import { environment } from "../../config/env";
import { seedSql } from "../fixtures/ipmLive";
import { LIVE_BOOT_TIMEOUT_MS } from "../fixtures/disposableDatabase";

const id = (n: number): string => `c1707180-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1);
const facilities = [id(2), id(3)];
const users = [id(4), id(5)];
const mailpit = environment()["E2E_MAILPIT_URL"] ?? "";
const runId = randomUUID();
interface Mail { ID: string; To: { Address: string }[]; Subject: string }
interface Message { HTML: string; To: { Address: string }[]; Cc?: { Address: string }[] | null; Bcc?: { Address: string }[] | null }
const messages = async (): Promise<Mail[]> => {
  const reply = await fetch(`${mailpit}/api/v1/messages`);
  if (!reply.ok) { throw new Error(`Mailpit list: ${String(reply.status)}`); }
  return ((await reply.json()) as { messages: Mail[] }).messages.filter((mail) => mail.Subject.includes(runId));
};

describe("PT-18 facility email through real broker and SMTP", () => {
  let db: Sequelize;
  let notification: typeof Notification;
  let queue: typeof Queue;
  let rabbit: typeof Rabbit;
  let redis: typeof Redis;
  let recipients: typeof Recipients;
  let jobs: typeof Jobs;
  let scheduler: typeof Scheduler;

  beforeAll(async () => {
    if (!mailpit || !environment()["MAIL_HOST"] || !environment()["MAIL_PORT"]) {
      throw new Error("PT18 needs dedicated Mailpit E2E_MAILPIT_URL and MAIL_HOST/MAIL_PORT");
    }
    /* eslint-disable @typescript-eslint/no-require-imports -- load after runner selects scratch DB */
    db = (require("../../config") as { db: Sequelize }).db;
    const boot = require("../fixtures/liveBoot") as typeof Boot;
    const { migrator } = require("../../config/migrator") as { migrator: Parameters<typeof Boot.bootSchema>[1] };
    notification = require("../../services/notification.service") as typeof Notification;
    queue = require("../../services/emailQueue.service") as typeof Queue;
    rabbit = require("../../services/rabbitmq.service") as typeof Rabbit;
    redis = require("../../services/redis.service") as typeof Redis;
    recipients = require("../../services/notificationRecipients") as typeof Recipients;
    jobs = require("../../utils/jobContext.util") as typeof Jobs;
    scheduler = require("../../services/calibrationScheduler.service") as typeof Scheduler;
    /* eslint-enable @typescript-eslint/no-require-imports */
    await boot.bootSchema(db as Parameters<typeof Boot.bootSchema>[0], migrator);
    for (const statement of seedSql({ tenant, role: id(6), users,
      facilities: [[facilities[0] ?? "", "PT18F1"], [facilities[1] ?? "", "PT18F2"]], devices: [], tag: "pt18mail" })) {
      await db.query(statement);
    }
    await db.query("UPDATE roles SET name = 'HEALTHCARE TECHNICIAN' WHERE id = $1", { bind: [id(6)] });
    await db.query("INSERT INTO menu_groups (id, name, slug, created_at, updated_at) VALUES ($1, 'Calibration', 'calibration', now(), now()) ON CONFLICT (slug) DO NOTHING", { bind: [id(7)] });
    for (const [i, user] of users.entries()) {
      await db.transaction(async (transaction) => {
        // The real database guard requires the binding operation's transaction-local user id.
        await db.query("SELECT set_config('callibrator.facility_binding', $1, true)", { bind: [user], transaction });
        await db.query("UPDATE users SET client_facility_id = $1, is_active = true, status = 'ACTIVE' WHERE tenant_id = $2 AND id = $3", { bind: [facilities[i], tenant, user], transaction });
      });
      await db.query("INSERT INTO user_menu_permissions (id, user_id, menu_group_id, permission_type, created_at, updated_at) SELECT $1, $2, id, 'read', now(), now() FROM menu_groups WHERE slug = 'calibration'", { bind: [id(10 + i), user] });
    }
    await boot.enterAppRole(db);
    expect(await messages()).toEqual([]);
    // Dedicated broker only: remove jobs left by an interrupted test before the producer runs.
    await (await rabbit.assertQueue("email_queue", "email_dlq")).purgeQueue("email_queue");
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await rabbit.closeRabbitMQ();
    await redis.closeRedis();
    await db.close();
  });

  it("queues after commit, then the real worker delivers F1/F2-only escaped bodies", async () => {
    await jobs.runForTenant(tenant, async () => {
      for (const [i, facility] of facilities.entries()) {
        const audience = await recipients.recipientsFor({ tenantId: tenant, clientFacilityId: facility }, "calibration");
        expect(audience.boundUserIds).toEqual([users[i]]);
        await db.transaction(async (transaction) => {
          await notification.emitNotification({ tenantId: tenant, userId: audience.boundUserIds[0], type: "CALIBRATION",
            title: `PT18 ${runId} F${String(i + 1)} overdue`, message: `ONLY_F${String(i + 1)}_<img src=x onerror=alert(1)> SERIAL_F${String(i + 1)}`,
            channels: ["email"],
          }, { transaction });
        });
      }
    });
    // No consumer yet: this distinguishes broker delivery from the direct-SMTP fallback.
    const channel = await rabbit.getChannel();
    const publishedBy = Date.now() + 5_000;
    while ((await channel.checkQueue("email_queue")).messageCount < 2 && Date.now() < publishedBy) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await channel.checkQueue("email_queue")).messageCount).toBe(2);
    expect(await messages()).toEqual([]);
    expect(await queue.processEmailQueue()).toBe(true);
    const until = Date.now() + 30_000;
    while ((await messages()).length < 2 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const delivered = await messages();
    expect(delivered).toHaveLength(2);
    for (const i of [0, 1]) {
      const own = i + 1;
      const other = own === 1 ? 2 : 1;
      const mail = delivered.find((item) => item.To.some((to) => to.Address === `pt18mailu${String(i)}@example.test`));
      expect(mail).toBeDefined();
      const response = await fetch(`${mailpit}/api/v1/message/${mail?.ID ?? ""}`);
      expect(response.ok).toBe(true);
      const body = (await response.json()) as Message;
      expect(body.To.map((to) => to.Address)).toEqual([`pt18mailu${String(i)}@example.test`]);
      expect(body.Cc ?? []).toEqual([]);
      expect(body.Bcc ?? []).toEqual([]);
      expect(body.HTML).toContain(`ONLY_F${String(own)}_&lt;img`);
      expect(body.HTML).toContain(`SERIAL_F${String(own)}`);
      expect(body.HTML).not.toContain(`ONLY_F${String(other)}`);
      expect(body.HTML).not.toContain(`SERIAL_F${String(other)}`);
      expect(body.HTML).not.toContain("<img src=x");
    }
  }, 45_000);

  it("a rollback publishes no email job and delivers no SMTP message", async () => {
    await rabbit.stopConsumers();
    await expect(jobs.runForTenant(tenant, () => db.transaction(async (transaction) => {
      await notification.emitNotification({ tenantId: tenant, userId: users[0], title: `PT18 ${runId} rollback`,
        message: "ROLLBACK_CANARY", channels: ["email"] }, { transaction });
      throw new Error("PT18 deliberate rollback");
    }))).rejects.toThrow("PT18 deliberate rollback");
    expect((await (await rabbit.getChannel()).checkQueue("email_queue")).messageCount).toBe(0);
    expect((await messages()).map((mail) => mail.Subject)).not.toContain(`PT18 ${runId} rollback`);
    expect(await messages()).toHaveLength(2);
  });

  it("the real overdue reminder scan creates both facility notifications without queuing email", async () => {
    for (const [i, facility] of facilities.entries()) {
      await db.query("INSERT INTO calibration_devices (id, tenant_id, client_facility_id, name, serial_number, next_calibration_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, '2020-01-01', now(), now())",
        { bind: [id(20 + i), tenant, facility, `PT18 overdue F${String(i + 1)}`, `PT18-SERIAL-F${String(i + 1)}`] });
    }
    const result = await scheduler.runCalibrationScan({ tenantId: tenant });
    expect(result.errors).toBe(0);
    expect(result.notificationsCreated).toBe(2);
    expect(result.workOrdersCreated).toBe(2);
    // Consumer remains stopped after the rollback case: accidental mail jobs cannot disappear.
    expect((await (await rabbit.getChannel()).checkQueue("email_queue")).messageCount).toBe(0);
    expect(await messages()).toHaveLength(2);
  }, 30_000);
});
