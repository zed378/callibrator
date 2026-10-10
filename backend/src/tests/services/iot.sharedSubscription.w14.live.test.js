/**
 * W-14 against a REAL MQTT broker (Mosquitto 2) and a REAL PostgreSQL 18 —
 * two replicas, one reading per publish.
 *
 * Two IotService instances stand in for two replicas: two MQTT connections
 * with their own client ids, sharing one database. Before W-14 each
 * subscribed to plain `device/#`, so the broker delivered every message to
 * both and one publish stored TWO readings (and, out of tolerance, raised two
 * tenant-wide alerts). With the shared subscription (`$share/<group>/...`)
 * the broker delivers each message to one of them.
 *
 * NEEDS — a broker and a database built by db.sync() + migrator.up():
 *
 *   MQTT_LIVE_HOST=127.0.0.1 MQTT_LIVE_PORT=1883 \
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/iot.sharedSubscription.w14.live
 *
 * ADR-095 O-2: the suite creates its OWN database (DB_USER needs CREATEDB;
 * DB_NAME is not used), builds it as the backend boots (db.sync() + every
 * migration, 0091's append-only audit_logs included) and runs as
 * `callibrator_app` through enterApplicationRole. Its audit rows cannot be
 * deleted, so it does not clean up: the database is dropped afterwards
 * (fixtures/disposableDatabase.ts, fixtures/liveBoot.ts).
 */
const { createDisposableDatabase, LIVE_BOOT_TIMEOUT_MS } = require("../fixtures/disposableDatabase");
const { bootSchemaAsApplicationRole } = require("../fixtures/liveBoot");
const { SELF_FACILITIES_SQL } = require("../fixtures/selfFacility");

const T = "14141414-0000-4000-8000-0000000000a1";
const DEVICE = "14141414-0000-4000-8000-0000000000d1";

describe("W-14 — MQTT ingest with two replicas (live broker + PostgreSQL)", () => {
  jest.setTimeout(60000);
  let db;
  let scratch;
  let replicas;
  let publisher;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const count = async (table) =>
    Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = :t`, { t: T }))[0].n);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Wait until `table` holds `n` rows of the tenant, then a settle period for any duplicate. */
  const settle = async (table, n) => {
    const until = Date.now() + 15000;
    while ((await count(table)) < n && Date.now() < until) {
      await sleep(100);
    }
    await sleep(1500);
  };
  const publish = (payload) =>
    new Promise((resolve, reject) =>
      publisher.publish(`device/${DEVICE}/${T}`, JSON.stringify(payload), { qos: 1 }, (err) => (err ? reject(err) : resolve())),
    );

  beforeAll(async () => {
    process.env.MQTT_HOST = process.env.MQTT_LIVE_HOST || "127.0.0.1";
    process.env.MQTT_PORT = process.env.MQTT_LIVE_PORT || "1883";
    scratch = await createDisposableDatabase("w14");
    ({ db } = require("../../config"));
    db.options.logging = false;
    require("../../models");
    await bootSchemaAsApplicationRole(db);
    await q(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'w14-live', 'w14-live', 'w14@example.test', now(), now())`,
      { t: T },
    );
    // P20-07: raw-SQL tenants need their self facility before a device (0118 refuses one without — fixtures/selfFacility).
    await q(SELF_FACILITIES_SQL);
    await q(
      `INSERT INTO calibration_devices (id, tenant_id, name, status, iot_enabled, reading_tolerance, created_at, updated_at)
       VALUES (:d, :t, 'Fridge probe', 'active', true, '{"temperature": {"max": 8}}', now(), now())`,
      { d: DEVICE, t: T },
    );

    const IotService = require("../../services/iot.service").constructor;
    replicas = [new IotService(), new IotService()];
    await Promise.all(replicas.map((r) => r.connect()));
    await sleep(500); // both SUBSCRIBEs acknowledged

    const mqtt = require("mqtt");
    publisher = mqtt.connect(`mqtt://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`, { clientId: `w14-publisher-${Date.now()}` });
    await new Promise((resolve) => publisher.once("connect", resolve));
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    publisher?.end(true);
    replicas?.forEach((r) => r.disconnect());
    if (db) {
      await db.close();
    }
    if (scratch) {
      await scratch.drop();
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  it("one publish produces exactly one reading row with two replicas running", async () => {
    await publish({ temperature: 4 });
    await settle("iot_readings", 1);
    expect(await count("iot_readings")).toBe(1);
  });

  it("one out-of-tolerance publish raises exactly one tenant-wide alert and one audit row", async () => {
    await publish({ temperature: 12 });
    await settle("notifications", 1);
    expect(await count("notifications")).toBe(1);
    expect(
      Number((await q(
        "SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = :t AND actor_name = 'system:iot-ingest'",
        { t: T },
      ))[0].n),
    ).toBe(1);
  });

  it("a burst of 40 messages is stored exactly once each: none duplicated, none lost", async () => {
    const before = await count("iot_readings");
    for (let i = 0; i < 40; i += 1) {
      await publish({ temperature: 3, seq: i });
    }
    await settle("iot_readings", before + 40);
    const seqs = await q(
      `SELECT (metrics->>'seq')::int AS seq, count(*)::int AS n FROM iot_readings
        WHERE tenant_id = :t AND metrics ? 'seq' GROUP BY 1 ORDER BY 1`,
      { t: T },
    );
    expect(seqs).toHaveLength(40);
    expect(seqs.every(({ n }) => n === 1)).toBe(true);
  });
});
