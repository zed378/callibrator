const crypto = require("crypto");
const mqtt = require("mqtt");
const { CalibrationDevice, IotReading, Notification } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
const { db } = require("../config");
const auditService = require("./audit.service");
const { SYSTEM_ACTORS } = require("../constants/systemActors");
const { runForTenant } = require("../utils/jobContext.util");

/**
 * W-14 (ADR-079): the MQTT subscription replicas SHARE. With a plain
 * `device/#` every replica received every message, so N replicas stored N
 * readings and raised N tenant-wide alerts per publish. A shared subscription
 * (`$share/<group>/device/#`, MQTT 5 and the common 3.1.1 brokers) makes the
 * broker deliver each message to ONE subscriber of the group.
 *
 * MQTT_SHARED_GROUP names the group (default "callibrator"); `none` subscribes
 * to plain `device/#`, for a broker without shared subscriptions, and then
 * only one replica may run MQTT. A name holding `/`, `+` or `#` is invalid in
 * a topic filter and falls back to the default, loudly.
 */
const DEFAULT_SHARED_GROUP = "callibrator";
const INGEST_TOPIC = "device/#";

const ingestSubscription = () => {
  const configured = (process.env.MQTT_SHARED_GROUP ?? DEFAULT_SHARED_GROUP).trim();
  if (configured.toLowerCase() === "none") {
    return INGEST_TOPIC;
  }
  let group = configured;
  if (!group || /[/+#]/.test(group)) {
    logger.error(`MQTT_SHARED_GROUP "${configured}" is not a valid group name; using "${DEFAULT_SHARED_GROUP}"`);
    group = DEFAULT_SHARED_GROUP;
  }
  return `$share/${group}/${INGEST_TOPIC}`;
};

/**
 * W-14: at most this many ingests run at once per process. Past it, the next
 * message is not read from the connection until one finishes (the client's
 * `handleMessage` callback is withheld), so a burst, or a broker replaying a
 * backlog on reconnect, waits in the broker and in TCP, not in memory or in
 * the database pool.
 */
const DEFAULT_INGEST_CONCURRENCY = 8;
const ingestConcurrency = () => {
  const n = Number(process.env.MQTT_INGEST_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_INGEST_CONCURRENCY;
};

class IotService {
  constructor() {
    this.client = null;
    this.connected = false;
    // W-14: ingests in flight, and the withheld callback that lets the client
    // read the next message once one of them finishes.
    this.inFlight = 0;
    this.resumeReading = null;
  }

  async connect(port, host) {
    if (this.connected) {return;}

    // Only attempt connection if explicitly configured
    const mqttHost = process.env.MQTT_HOST;
    const mqttPort = process.env.MQTT_PORT;

    if (!mqttHost || !mqttPort) {
      logger.info("MQTT broker not configured (set MQTT_HOST and MQTT_PORT to enable)");
      return;
    }

    const url = `mqtt://${host || mqttHost}:${port || mqttPort}`;
    logger.info(`Connecting to MQTT broker at ${url}`);

    const clientOpts = {
      // Random suffix: two replicas starting in the same millisecond had the
      // same client id, and the broker disconnects the first of a duplicate.
      clientId: `callibrator-backend-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      clean: true,
      reconnectPeriod: 5000,
    };

    try {
      this.client = mqtt.connect(url, clientOpts);

      this.client.on("connect", () => {
        this.connected = true;
        logger.info(`IoT MQTT Client connected to broker at ${url}`);
        const subscription = ingestSubscription();
        this.client.subscribe(subscription, (err) => {
          if (err) {
            logger.error("IoT MQTT Subscribe Error", { error: err.message });
          } else {
            logger.info(`IoT MQTT Client subscribed to ${subscription}`);
          }
        });
      });

      this.client.on("error", (err) => {
        logger.error("IoT MQTT Client Error", { error: err.message });
        this.connected = false;
      });

      this.client.on("close", () => {
        logger.warn("IoT MQTT Client connection closed");
        this.connected = false;
      });

      this.client.on("reconnect", () => {
        logger.warn("IoT MQTT Client reconnecting...");
      });

      // W-14: ingest runs from `handleMessage`, not a "message" listener. The
      // client reads the next packet only after `done` is called, which is
      // what bounds the ingests in flight (handleIncoming).
      this.client.handleMessage = (packet, done) =>
        this.handleIncoming(packet.topic, packet.payload, done);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("MQTT connection timeout"));
        }, 10000);

        this.client.once("connect", () => {
          clearTimeout(timeout);
          resolve(this.client);
        });

        this.client.once("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (error) {
      logger.error("Failed to connect to MQTT broker", { error: error.message });
      throw error;
    }
  }

  /**
   * One message from the broker: parse it, start its ingest, and let the
   * client read the next message now, or, at the concurrency cap, when an
   * ingest finishes (W-14).
   *
   * A failed ingest is logged, never thrown: unawaited and uncaught, its
   * rejection used to reach the process-level `unhandledRejection` handler in
   * index.js, which calls shutdown(), so one stale retained message for an
   * unknown or disabled device shut the server down.
   *
   * @param {string} topic - `device/<deviceId>/<tenantId>`
   * @param {Buffer|string} payload - JSON: metric name -> value
   * @param {Function} done - lets the client read the next packet
   */
  handleIncoming(topic, payload, done) {
    let payloadJson;
    try {
      payloadJson = JSON.parse(payload.toString());
    } catch (error) {
      logger.error("MQTT Message Parse Error", { error: error.message, topic });
      done();
      return;
    }
    const parts = topic.split("/");
    const deviceId = parts[1] || null;
    const tenantId = parts[2] || null;
    if (!deviceId || !tenantId) {
      done();
      return;
    }

    this.inFlight += 1;
    this.ingestReading(tenantId, deviceId, payloadJson)
      .catch((error) => {
        logger.error("MQTT ingest failed", {
          error: error.message,
          topic,
          deviceId,
          tenantId,
        });
      })
      .finally(() => {
        this.inFlight -= 1;
        const resume = this.resumeReading;
        this.resumeReading = null;
        if (resume) {
          resume();
        }
      });

    if (this.inFlight < ingestConcurrency()) {
      done();
    } else {
      this.resumeReading = done;
    }
  }

  async publish(deviceId, tenantId, topic, data) {
    if (!this.client || !this.connected) {
      logger.warn("MQTT client not connected, unable to publish");
      return false;
    }

    return new Promise((resolve, reject) => {
      const fullTopic = `${topic}/${deviceId}/${tenantId}`;
      const payload = JSON.stringify(data);

      this.client.publish(fullTopic, payload, { qos: 1 }, (err) => {
        if (err) {
          logger.error("MQTT Publish Error", { error: err.message, topic: fullTopic });
          reject(err);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Store one reading for a device of `tenantId`; an out-of-tolerance reading
   * also raises a tenant-wide alert.
   *
   * W-12: the whole ingest runs inside runForTenant(tenantId) — the tenant the
   * MQTT topic names, or the authenticated device's on the HTTP path — so the
   * isolation hooks confine the device lookup and stamp every row it writes.
   * A topic naming another tenant's device finds nothing.
   *
   * W-04: an anomaly's reading, its tenant-wide alert and one audit row naming
   * `system:iot-ingest` are ONE transaction. An ordinary reading writes no
   * audit row: individual readings are out of the trail by ADR-051 Q-13, and
   * the reading row is itself the record.
   *
   * @param {string} tenantId
   * @param {string} deviceId
   * @param {object} payload - metric name -> value
   * @returns {Promise<{success: true, isAnomaly: boolean}>}
   */
  async ingestReading(tenantId, deviceId, payload) {
    return runForTenant(tenantId, () => this.ingestInTenant(tenantId, deviceId, payload));
  }

  async ingestInTenant(tenantId, deviceId, payload) {
    // See iot.controller.js: `.unscoped()` drops the soft-delete predicate, so
    // it is carried explicitly. A decommissioned device must not ingest.
    const device = await CalibrationDevice.unscoped().findOne({
      where: { id: deviceId, tenantId, iotEnabled: true, isDeleted: false },
      attributes: ["id", "name", "readingTolerance"],
    });

    if (!device) {
      throw new Error("Device not found or IoT disabled");
    }

    let isAnomaly = false;
    const anomalyDetails = [];

    if (device.readingTolerance) {
      for (const [key, value] of Object.entries(payload)) {
        const tolerance = device.readingTolerance[key];
        if (tolerance) {
          if (tolerance.min !== undefined && value < tolerance.min) {
            isAnomaly = true;
            anomalyDetails.push(`${key} (${value}) is below min (${tolerance.min})`);
          }
          if (tolerance.max !== undefined && value > tolerance.max) {
            isAnomaly = true;
            anomalyDetails.push(`${key} (${value}) is above max (${tolerance.max})`);
          }
        }
      }
    }

    const reading = { tenantId, deviceId, metrics: payload, isAnomaly };

    if (!isAnomaly) {
      await IotReading.create(reading);
      return { success: true, isAnomaly };
    }

    // The metric names and the out-of-range findings, not the whole payload
    // ("no full bodies" in logs — A-46).
    logger.warn(`IoT Anomaly detected for device ${deviceId}`, {
      metrics: Object.keys(payload),
      anomalyDetails,
    });

    await db.transaction(async (transaction) => {
      const stored = await IotReading.create(reading, { transaction });
      const alert = await Notification.create(
        {
          tenantId,
          title: `IoT Anomaly Alert: ${device.name}`,
          message: `Anomalous readings detected: ${anomalyDetails.join(", ")}`,
          // W-32: the ENUM is upper case (SYSTEM, CALIBRATION, INVENTORY,
          // MAINTENANCE). "system" was refused by PostgreSQL, so no anomaly
          // alert had ever been stored.
          type: "SYSTEM",
        },
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          systemActor: SYSTEM_ACTORS.IOT_INGEST,
          action: "CREATE",
          resourceType: "Notification",
          resourceId: alert.id,
          changes: {
            operation: "IOT_ANOMALY_ALERT",
            audience: "tenant",
            deviceId,
            readingId: stored.id,
            anomalies: anomalyDetails,
          },
        },
        { transaction },
      );
    });

    return { success: true, isAnomaly };
  }

  disconnect() {
    if (this.client) {
      this.client.end(false, () => {
        logger.info("IoT MQTT Client disconnected");
      });
      this.connected = false;
      this.client = null;
    }
  }
}

module.exports = new IotService();
