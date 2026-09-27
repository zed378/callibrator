/**
 * W-14 (ADR-079) — MQTT ingest: one replica per message, and bounded work.
 *
 *  - The subscription is SHARED (`$share/<group>/device/#`), so the broker
 *    gives each message to one subscriber of the group instead of every
 *    replica (the live proof with a real broker and two clients is
 *    iot.sharedSubscription.w14.live.test.js).
 *  - At most MQTT_INGEST_CONCURRENCY ingests run at once; past it the client's
 *    `handleMessage` callback is withheld, so the next packet is not read
 *    until one finishes.
 */
jest.mock("mqtt");
jest.mock("../../models", () => ({
  CalibrationDevice: { unscoped: jest.fn() },
  IotReading: { create: jest.fn() },
  Notification: { create: jest.fn() },
}));
jest.mock("../../config", () => ({ db: { transaction: jest.fn() } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mqtt = require("mqtt");
const { logger } = require("../../middlewares/activityLog.middleware");
const iot = require("../../services/iot.service");

const ENV = ["MQTT_HOST", "MQTT_PORT", "MQTT_SHARED_GROUP", "MQTT_INGEST_CONCURRENCY"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

/** Connect a fake client whose `connect` fires, and return it. */
const connect = async () => {
  process.env.MQTT_HOST = "broker.local";
  process.env.MQTT_PORT = "1883";
  let onConnect;
  const client = {
    on: jest.fn((event, cb) => {
      if (event === "connect") {onConnect = cb;}
    }),
    once: jest.fn((event, cb) => {
      if (event === "connect") {setImmediate(cb);}
    }),
    subscribe: jest.fn(),
  };
  mqtt.connect.mockReturnValue(client);
  await iot.connect();
  onConnect();
  return client;
};

describe("W-14 — MQTT ingest", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mqtt.connect.mockReset();
    iot.connected = false;
    iot.client = null;
    iot.inFlight = 0;
    iot.resumeReading = null;
    for (const k of ENV) {delete process.env[k];}
  });

  afterAll(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) {delete process.env[k];} else {process.env[k] = saved[k];}
    }
  });

  describe("the subscription replicas share", () => {
    it("defaults to $share/callibrator/device/#", async () => {
      const client = await connect();
      expect(client.subscribe).toHaveBeenCalledWith("$share/callibrator/device/#", expect.any(Function));
    });

    it("uses MQTT_SHARED_GROUP as the group", async () => {
      process.env.MQTT_SHARED_GROUP = " hospital-a ";
      const client = await connect();
      expect(client.subscribe).toHaveBeenCalledWith("$share/hospital-a/device/#", expect.any(Function));
    });

    it("MQTT_SHARED_GROUP=none subscribes to plain device/# (a broker without shared subscriptions)", async () => {
      process.env.MQTT_SHARED_GROUP = "NONE";
      const client = await connect();
      expect(client.subscribe).toHaveBeenCalledWith("device/#", expect.any(Function));
    });

    it.each(["a/b", "a+", "#", "  "])("an invalid group %p falls back to the default, loudly", async (group) => {
      process.env.MQTT_SHARED_GROUP = group;
      const client = await connect();
      expect(client.subscribe).toHaveBeenCalledWith("$share/callibrator/device/#", expect.any(Function));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("is not a valid group name"));
    });

    it("gives every process a distinct client id, even in the same millisecond", async () => {
      await connect();
      iot.connected = false;
      await connect();
      const [a, b] = mqtt.connect.mock.calls.map(([, opts]) => opts.clientId);
      expect(a).toMatch(/^callibrator-backend-\d+-[0-9a-f]{8}$/);
      expect(a).not.toBe(b);
    });
  });

  describe("bounded concurrency (backpressure)", () => {
    /** Ingests that stay pending until released, one per call. */
    const pendingIngests = () => {
      const releases = [];
      jest.spyOn(iot, "ingestReading").mockImplementation(
        () => new Promise((resolve) => releases.push(resolve)),
      );
      return releases;
    };
    const payload = Buffer.from(JSON.stringify({ temperature: 21 }));
    const flush = () => new Promise(setImmediate);

    afterEach(() => jest.restoreAllMocks());

    it("reads the next message at once while under the cap, and withholds it at the cap", async () => {
      process.env.MQTT_INGEST_CONCURRENCY = "2";
      const client = await connect();
      const releases = pendingIngests();
      const done = [jest.fn(), jest.fn()];

      client.handleMessage({ topic: "device/d1/t1", payload }, done[0]);
      client.handleMessage({ topic: "device/d2/t1", payload }, done[1]);

      expect(done[0]).toHaveBeenCalledTimes(1);
      expect(done[1]).not.toHaveBeenCalled(); // two in flight: the client stops reading
      expect(iot.inFlight).toBe(2);

      releases[0]();
      await flush();
      expect(done[1]).toHaveBeenCalledTimes(1); // one finished: the next packet may be read
      expect(iot.inFlight).toBe(1);

      releases[1]();
      await flush();
      expect(iot.inFlight).toBe(0);
    });

    it("a burst of M messages never has more than the cap in flight", async () => {
      process.env.MQTT_INGEST_CONCURRENCY = "3";
      const client = await connect();
      const releases = pendingIngests();
      let peak = 0;

      // Deliver as mqtt.js does: the next packet only after `done`.
      const queue = Array.from({ length: 20 }, (_, i) => ({ topic: `device/d${i}/t1`, payload }));
      const deliver = () => {
        const packet = queue.shift();
        if (packet) {
          client.handleMessage(packet, deliver);
          peak = Math.max(peak, iot.inFlight);
        }
      };
      deliver();
      while (releases.length) {
        releases.shift()();
        await flush();
      }

      expect(iot.ingestReading).toHaveBeenCalledTimes(20);
      expect(peak).toBe(3);
      expect(iot.inFlight).toBe(0);
    });

    it("a failed ingest frees its slot and is logged", async () => {
      process.env.MQTT_INGEST_CONCURRENCY = "1";
      const client = await connect();
      jest.spyOn(iot, "ingestReading").mockRejectedValue(new Error("Device not found or IoT disabled"));
      const done = jest.fn();

      client.handleMessage({ topic: "device/ghost/t1", payload }, done);
      expect(done).not.toHaveBeenCalled();
      await flush();

      expect(done).toHaveBeenCalledTimes(1);
      expect(iot.inFlight).toBe(0);
      expect(logger.error).toHaveBeenCalledWith(
        "MQTT ingest failed",
        expect.objectContaining({ deviceId: "ghost", tenantId: "t1" }),
      );
    });

    it("an invalid MQTT_INGEST_CONCURRENCY uses the default of 8", async () => {
      process.env.MQTT_INGEST_CONCURRENCY = "zero";
      const client = await connect();
      pendingIngests();
      const done = Array.from({ length: 8 }, () => jest.fn());
      done.forEach((d, i) => client.handleMessage({ topic: `device/d${i}/t1`, payload }, d));
      expect(done.slice(0, 7).every((d) => d.mock.calls.length === 1)).toBe(true);
      expect(done[7]).not.toHaveBeenCalled();
    });

    it("a message that is not ingested (bad JSON, short topic) lets the client read on at once", async () => {
      const client = await connect();
      const spy = jest.spyOn(iot, "ingestReading");
      const done = [jest.fn(), jest.fn()];
      client.handleMessage({ topic: "device/d1/t1", payload: Buffer.from("not-json") }, done[0]);
      client.handleMessage({ topic: "device/d1", payload }, done[1]);
      expect(done[0]).toHaveBeenCalledTimes(1);
      expect(done[1]).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
      expect(iot.inFlight).toBe(0);
    });
  });
});
