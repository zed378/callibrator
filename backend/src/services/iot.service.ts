// P9-14 (ADR-087, Stage C leaves): converted from iot.service.js with no
// behaviour change. `export =` keeps what `require()` returned: ONE instance of
// IotService, whose fields are created in the constructor in the same order
// (`declare`d, so no class-field initialiser runs first). `crypto` is the
// module object and `mqtt.connect` a named import read at call time (mqtt is
// an ES-module-shaped CommonJS build), so the tests' `jest.mock("mqtt")` and
// spies still apply. The three models, the logger, `db`, `SYSTEM_ACTORS` and
// `runForTenant` are captured once at load, as the `.js` destructured them;
// `auditService` is the module object. Environment reads go through
// src/config/env (P9-06), at call time.
import crypto from "crypto";
import { connect as mqttConnect, type IClientOptions, type IPublishPacket, type MqttClient } from "mqtt";
import type { CreationAttributes, Transaction } from "sequelize";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { runForTenant as loadedRunForTenant } from "../utils/jobContext.util";
import { env } from "../config/env";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { CalibrationDevice, IotReading, Notification } = models;
const logger = loadedLogger;
const db = loadedDb;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const runForTenant = loadedRunForTenant;

/** One reading's metrics, as the device sent them: metric name -> value. */
type ReadingPayload = Record<string, unknown>;

/** The bounds of one metric, as `readingTolerance` holds them. */
interface Bounds {
  min?: unknown;
  max?: unknown;
}

/** What an ingest answers. */
interface IngestResult {
  success: true;
  isAnomaly: boolean;
}

/** The fields a caught error is read for. */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

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

const ingestSubscription = (): string => {
  const configured = (env("MQTT_SHARED_GROUP") ?? DEFAULT_SHARED_GROUP).trim();
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
const ingestConcurrency = (): number => {
  const n = Number(env("MQTT_INGEST_CONCURRENCY"));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_INGEST_CONCURRENCY;
};

class IotService {
  declare client: MqttClient | null;
  declare connected: boolean;
  declare inFlight: number;
  declare resumeReading: (() => void) | null;

  constructor() {
    this.client = null;
    this.connected = false;
    // W-14: ingests in flight, and the withheld callback that lets the client
    // read the next message once one of them finishes.
    this.inFlight = 0;
    this.resumeReading = null;
  }

  async connect(port?: number | string | null, host?: string | null): Promise<MqttClient | undefined> {
    if (this.connected) {return;}

    // Only attempt connection if explicitly configured
    const mqttHost = env("MQTT_HOST");
    const mqttPort = env("MQTT_PORT");

    if (!mqttHost || !mqttPort) {
      logger.info("MQTT broker not configured (set MQTT_HOST and MQTT_PORT to enable)");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty host or port falls back, and the port is interpolated as given
    const url = `mqtt://${host || mqttHost}:${port || mqttPort}`;
    logger.info(`Connecting to MQTT broker at ${url}`);

    const clientOpts: IClientOptions = {
      // Random suffix: two replicas starting in the same millisecond had the
      // same client id, and the broker disconnects the first of a duplicate.
      clientId: `callibrator-backend-${String(Date.now())}-${crypto.randomBytes(4).toString("hex")}`,
      clean: true,
      reconnectPeriod: 5000,
    };

    try {
      const client = mqttConnect(url, clientOpts);
      this.client = client;

      client.on("connect", () => {
        this.connected = true;
        logger.info(`IoT MQTT Client connected to broker at ${url}`);
        const subscription = ingestSubscription();
        // As built: the client is read from the instance when the event fires.
        (this.client as MqttClient).subscribe(subscription, (err) => {
          if (err) {
            logger.error("IoT MQTT Subscribe Error", { error: err.message });
          } else {
            logger.info(`IoT MQTT Client subscribed to ${subscription}`);
          }
        });
      });

      client.on("error", (err) => {
        logger.error("IoT MQTT Client Error", { error: err.message });
        this.connected = false;
      });

      client.on("close", () => {
        logger.warn("IoT MQTT Client connection closed");
        this.connected = false;
      });

      client.on("reconnect", () => {
        logger.warn("IoT MQTT Client reconnecting...");
      });

      // W-14: ingest runs from `handleMessage`, not a "message" listener. The
      // client reads the next packet only after `done` is called, which is
      // what bounds the ingests in flight (handleIncoming).
      client.handleMessage = (packet: IPublishPacket, done: () => void): void => {
        this.handleIncoming(packet.topic, packet.payload, done);
      };

      // eslint-disable-next-line @typescript-eslint/return-await -- as built: the timeout's rejection goes to the caller, not through this catch (no extra log line)
      return new Promise<MqttClient>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("MQTT connection timeout"));
        }, 10000);

        client.once("connect", () => {
          clearTimeout(timeout);
          // As built: resolves with the client the instance holds at that moment.
          resolve(this.client as MqttClient);
        });

        client.once("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (error) {
      logger.error("Failed to connect to MQTT broker", { error: messageOf(error) });
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
   * @param topic - `device/<deviceId>/<tenantId>`
   * @param payload - JSON: metric name -> value
   * @param done - lets the client read the next packet
   */
  handleIncoming(topic: string, payload: Buffer | string, done: () => void): void {
    let payloadJson: ReadingPayload;
    try {
      payloadJson = JSON.parse(payload.toString()) as ReadingPayload;
    } catch (error) {
      logger.error("MQTT Message Parse Error", { error: messageOf(error), topic });
      done();
      return;
    }
    const parts = topic.split("/");
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty segment reads as absent
    const deviceId = parts[1] || null;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty segment reads as absent
    const tenantId = parts[2] || null;
    if (!deviceId || !tenantId) {
      done();
      return;
    }

    this.inFlight += 1;
    // The topic's tenant segment is the tenant the ingest runs for (W-12).
    this.ingestReading(tenantId as TenantId, deviceId, payloadJson)
      .catch((error: unknown) => {
        logger.error("MQTT ingest failed", {
          error: messageOf(error),
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

  async publish(deviceId: string, tenantId: string, topic: string, data: unknown): Promise<boolean> {
    if (!this.client || !this.connected) {
      logger.warn("MQTT client not connected, unable to publish");
      return false;
    }

    const client = this.client;
    return new Promise<boolean>((resolve, reject) => {
      const fullTopic = `${topic}/${deviceId}/${tenantId}`;
      const payload = JSON.stringify(data);

      client.publish(fullTopic, payload, { qos: 1 }, (err) => {
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
   * @param tenantId - the tenant the reading belongs to
   * @param deviceId - the device
   * @param payload - metric name -> value
   */
  async ingestReading(tenantId: TenantId, deviceId: string, payload: ReadingPayload): Promise<IngestResult> {
    return runForTenant(tenantId, () => this.ingestInTenant(tenantId, deviceId, payload));
  }

  async ingestInTenant(tenantId: TenantId, deviceId: string, payload: ReadingPayload): Promise<IngestResult> {
    // See iot.controller.ts: `.unscoped()` drops the soft-delete predicate, so
    // it is carried explicitly. A decommissioned device must not ingest.
    const device = await CalibrationDevice.unscoped().findOne({
      where: { id: deviceId, tenantId, iotEnabled: true, isDeleted: false },
      attributes: ["id", "name", "readingTolerance"],
    });

    if (!device) {
      throw new Error("Device not found or IoT disabled");
    }

    let isAnomaly = false;
    const anomalyDetails: string[] = [];

    if (device.readingTolerance) {
      // As built: the stored tolerance is read by the payload's own keys.
      const tolerances = device.readingTolerance as Record<string, Bounds | undefined>;
      /* eslint-disable @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built: the device's values and bounds are interpolated as given */
      for (const [key, value] of Object.entries(payload)) {
        const tolerance = tolerances[key];
        if (tolerance) {
          // As built: JavaScript's relational comparison on whatever the device sent.
          if (tolerance.min !== undefined && (value as number) < (tolerance.min as number)) {
            isAnomaly = true;
            anomalyDetails.push(`${key} (${value}) is below min (${tolerance.min})`);
          }
          if (tolerance.max !== undefined && (value as number) > (tolerance.max as number)) {
            isAnomaly = true;
            anomalyDetails.push(`${key} (${value}) is above max (${tolerance.max})`);
          }
        }
      }
      /* eslint-enable @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string */
    }

    const readingValues = { tenantId, deviceId, metrics: payload, isAnomaly };
    // As built: the device's metrics are stored as it sent them.
    const reading = readingValues as CreationAttributes<ModelInstance<"IotReading">>;

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

    await db.transaction(async (transaction: Transaction) => {
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

  disconnect(): void {
    if (this.client) {
      this.client.end(false, () => {
        logger.info("IoT MQTT Client disconnected");
      });
      this.connected = false;
      this.client = null;
    }
  }
}

export = new IotService();
