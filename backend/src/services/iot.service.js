const mqtt = require("mqtt");
const { CalibrationDevice, IotReading, Notification } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");

class IotService {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect(port, host) {
    if (this.connected) return;

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
      clientId: `callibrator-backend-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    };

    try {
      this.client = mqtt.connect(url, clientOpts);

      this.client.on("connect", () => {
        this.connected = true;
        logger.info(`IoT MQTT Client connected to broker at ${url}`);
        this.client.subscribe("device/#", (err) => {
          if (err) {
            logger.error("IoT MQTT Subscribe Error", { error: err.message });
          } else {
            logger.info(`IoT MQTT Client subscribed to device/#`);
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

      this.client.on("message", (topic, payload) => {
        try {
          const payloadStr = payload.toString();
          const payloadJson = JSON.parse(payloadStr);
          const parts = topic.split("/");
          const deviceId = parts[1] || null;
          const tenantId = parts[2] || null;

          if (deviceId && tenantId) {
            this.ingestReading(tenantId, deviceId, payloadJson);
          }
        } catch (error) {
          logger.error("MQTT Message Parse Error", { error: error.message, topic });
        }
      });

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

  async ingestReading(tenantId, deviceId, payload) {
    const device = await CalibrationDevice.unscoped().findOne({
      where: { id: deviceId, tenantId, iotEnabled: true },
      attributes: ["id", "name", "readingTolerance"]
    });

    if (!device) {
      throw new Error("Device not found or IoT disabled");
    }

    let isAnomaly = false;
    let anomalyDetails = [];

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

    await IotReading.create({
      tenantId,
      deviceId,
      metrics: payload,
      isAnomaly
    });

    if (isAnomaly) {
      logger.warn(`IoT Anomaly detected for device ${deviceId}`, { payload, anomalyDetails });

      await Notification.create({
        tenantId,
        title: `IoT Anomaly Alert: ${device.name}`,
        message: `Anomalous readings detected: ${anomalyDetails.join(', ')}`,
        type: "system"
      });
    }

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
