jest.mock("mqtt");

jest.mock("../../models", () => ({
  CalibrationDevice: {
    unscoped: jest.fn(() => ({
      findOne: jest.fn(),
    })),
  },
  IotReading: {
    create: jest.fn(),
  },
  Notification: {
    create: jest.fn(),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mqtt = require("mqtt");
const { CalibrationDevice, IotReading, Notification } = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");

describe("iot.service", () => {
  const iot = require("../../services/iot.service");
  const origHost = process.env.MQTT_HOST;
  const origPort = process.env.MQTT_PORT;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearMocks only clears calls, not implementations — reset so a throwing
    // or one-off implementation cannot leak into a later test.
    mqtt.connect.mockReset();
    delete process.env.MQTT_HOST;
    delete process.env.MQTT_PORT;
    iot.connected = false;
    iot.client = null;
  });

  afterAll(() => {
    if (origHost !== undefined) process.env.MQTT_HOST = origHost;
    else delete process.env.MQTT_HOST;
    if (origPort !== undefined) process.env.MQTT_PORT = origPort;
    else delete process.env.MQTT_PORT;
  });

  describe("connect", () => {
    it("should log info and return early when MQTT_HOST not set", async () => {
      await iot.connect(1883, "broker.local");
      expect(logger.info).toHaveBeenCalledWith(
        "MQTT broker not configured (set MQTT_HOST and MQTT_PORT to enable)"
      );
      expect(mqtt.connect).not.toHaveBeenCalled();
    });

    it("should log info and return early when MQTT_PORT not set", async () => {
      process.env.MQTT_HOST = "broker.local";
      await iot.connect(1883, "broker.local");
      expect(logger.info).toHaveBeenCalledWith(
        "MQTT broker not configured (set MQTT_HOST and MQTT_PORT to enable)"
      );
    });

    it("should connect when both HOST and PORT are configured", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockReturnThis(),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") cb();
          if (event === "error") cb(new Error("fail"));
        }),
        subscribe: jest.fn(),
      };
      mqtt.connect.mockReturnValue(mockClient);

      const result = await iot.connect(1883, "broker.local");
      expect(result).toBe(mockClient);
      expect(mqtt.connect).toHaveBeenCalledWith("mqtt://broker.local:1883", expect.objectContaining({ clean: true }));
    });

    it("should use host/port env vars when not passed as args", async () => {
      process.env.MQTT_HOST = "env-broker";
      process.env.MQTT_PORT = "9999";

      const mockClient = {
        on: jest.fn().mockReturnThis(),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") cb();
        }),
        subscribe: jest.fn(),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect();
      expect(mqtt.connect).toHaveBeenCalledWith("mqtt://env-broker:9999", expect.any(Object));
    });

    it("should use passed host/port over env vars when both present", async () => {
      process.env.MQTT_HOST = "env-broker";
      process.env.MQTT_PORT = "9999";

      const mockClient = {
        on: jest.fn().mockReturnThis(),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") cb();
        }),
        subscribe: jest.fn(),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect(8888, "arg-broker");
      expect(mqtt.connect).toHaveBeenCalledWith("mqtt://arg-broker:8888", expect.any(Object));
    });

    it("should emit connect event handler that subscribes to device/#", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
        subscribe: jest.fn((topic, cb) => {
          if (typeof cb === "function") cb(null);
        }),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect(1883, "broker.local");
      expect(mockClient.subscribe).toHaveBeenCalledWith("device/#", expect.any(Function));
      expect(logger.info).toHaveBeenCalledWith("IoT MQTT Client subscribed to device/#");
    });

    it("should handle subscribe error", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
        subscribe: jest.fn((topic, cb) => {
          if (typeof cb === "function") cb(new Error("subscribe failed"));
        }),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect(1883, "broker.local");
      expect(logger.error).toHaveBeenCalledWith("IoT MQTT Subscribe Error", expect.objectContaining({ error: "subscribe failed" }));
    });

    it("should handle error event", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "error") setImmediate(() => cb(new Error("conn err")));
        }),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "error") setImmediate(() => cb(new Error("conn err")));
        }),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await expect(iot.connect(1883, "broker.local")).rejects.toThrow("conn err");
      expect(logger.error).toHaveBeenCalledWith("IoT MQTT Client Error", expect.objectContaining({ error: "conn err" }));
    });

    it("should handle close event", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "close") setImmediate(cb);
        }),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect(1883, "broker.local");
      expect(logger.warn).toHaveBeenCalledWith("IoT MQTT Client connection closed");
      expect(iot.connected).toBe(false);
    });

    it("should handle reconnect event", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn().mockImplementation((event, cb) => {
          if (event === "reconnect") setImmediate(cb);
        }),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === "connect") setImmediate(cb);
        }),
      };
      mqtt.connect.mockReturnValue(mockClient);

      await iot.connect(1883, "broker.local");
      expect(logger.warn).toHaveBeenCalledWith("IoT MQTT Client reconnecting...");
    });

    it("should return immediately when already connected", async () => {
      iot.connected = true;
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      await iot.connect(1883, "broker.local");

      expect(mqtt.connect).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it("should log and rethrow when mqtt.connect throws synchronously", async () => {
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";
      mqtt.connect.mockImplementation(() => {
        throw new Error("bad url");
      });

      await expect(iot.connect(1883, "broker.local")).rejects.toThrow("bad url");
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to connect to MQTT broker",
        { error: "bad url" }
      );
    });

    it("should reject when the broker never sends connect within the timeout", async () => {
      jest.useFakeTimers();
      process.env.MQTT_HOST = "broker.local";
      process.env.MQTT_PORT = "1883";

      const mockClient = {
        on: jest.fn(),
        once: jest.fn(), // never fires connect or error
        subscribe: jest.fn(),
      };
      mqtt.connect.mockReturnValue(mockClient);

      const promise = iot.connect(1883, "broker.local");
      const assertion = expect(promise).rejects.toThrow("MQTT connection timeout");
      jest.advanceTimersByTime(10000);
      await assertion;

      jest.useRealTimers();
    });

    describe("message handler", () => {
      // Captures the "message" listener the service registers on the client.
      const connectWithMessageHandler = async () => {
        process.env.MQTT_HOST = "broker.local";
        process.env.MQTT_PORT = "1883";
        let messageHandler;
        const mockClient = {
          on: jest.fn((event, cb) => {
            if (event === "message") messageHandler = cb;
          }),
          once: jest.fn((event, cb) => {
            if (event === "connect") setImmediate(cb);
          }),
          subscribe: jest.fn(),
        };
        mqtt.connect.mockReturnValue(mockClient);
        await iot.connect(1883, "broker.local");
        return messageHandler;
      };

      it("should ingest a reading parsed from a device/<deviceId>/<tenantId> topic", async () => {
        const handler = await connectWithMessageHandler();
        const findOne = jest.fn().mockResolvedValue({ id: "dev1", name: "S", readingTolerance: null });
        CalibrationDevice.unscoped.mockReturnValue({ findOne });

        handler("device/dev1/t1", Buffer.from(JSON.stringify({ temperature: 22 })));
        await new Promise(setImmediate);

        expect(findOne).toHaveBeenCalledWith({
          where: { id: "dev1", tenantId: "t1", iotEnabled: true },
          attributes: ["id", "name", "readingTolerance"],
        });
        expect(IotReading.create).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "t1", deviceId: "dev1", metrics: { temperature: 22 } })
        );
      });

      it("should ignore a topic whose device segment is empty", async () => {
        const handler = await connectWithMessageHandler();
        const findOne = jest.fn();
        CalibrationDevice.unscoped.mockReturnValue({ findOne });

        handler("device//t1", Buffer.from(JSON.stringify({ temperature: 22 })));
        await new Promise(setImmediate);

        expect(findOne).not.toHaveBeenCalled();
        expect(IotReading.create).not.toHaveBeenCalled();
      });

      it("should ignore a topic missing the tenant segment", async () => {
        const handler = await connectWithMessageHandler();
        const findOne = jest.fn();
        CalibrationDevice.unscoped.mockReturnValue({ findOne });

        handler("device/dev1", Buffer.from(JSON.stringify({ temperature: 22 })));
        await new Promise(setImmediate);

        expect(findOne).not.toHaveBeenCalled();
      });

      it("should log a parse error for a non-JSON payload", async () => {
        const handler = await connectWithMessageHandler();

        handler("device/dev1/t1", Buffer.from("not-json"));
        await new Promise(setImmediate);

        expect(logger.error).toHaveBeenCalledWith(
          "MQTT Message Parse Error",
          expect.objectContaining({ topic: "device/dev1/t1" })
        );
        expect(IotReading.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("publish", () => {
    it("should return false when not connected", async () => {
      iot.connected = false;
      const result = await iot.publish("dev1", "t1", "commands", { cmd: "reset" });
      expect(result).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith("MQTT client not connected, unable to publish");
    });

    it("should publish message and resolve true", async () => {
      const mockClient = {
        publish: jest.fn((topic, payload, opts, cb) => cb(null)),
      };
      iot.client = mockClient;
      iot.connected = true;

      const result = await iot.publish("dev1", "t1", "commands", { cmd: "reset" });
      expect(result).toBe(true);
      expect(mockClient.publish).toHaveBeenCalledWith(
        "commands/dev1/t1",
        JSON.stringify({ cmd: "reset" }),
        { qos: 1 },
        expect.any(Function)
      );
    });

    it("should reject on publish error", async () => {
      const mockClient = {
        publish: jest.fn((topic, payload, opts, cb) => cb(new Error("publish fail"))),
      };
      iot.client = mockClient;
      iot.connected = true;

      await expect(iot.publish("dev1", "t1", "commands", {})).rejects.toThrow("publish fail");
    });
  });

  describe("ingestReading", () => {
    const mockDevice = {
      id: "dev1",
      name: "Sensor Alpha",
      readingTolerance: {
        temperature: { min: 10, max: 50 },
        humidity: { min: 20, max: 80 },
      },
    };

    beforeEach(() => {
      CalibrationDevice.unscoped.mockReturnValue({ findOne: jest.fn() });
    });

    it("should create reading when device found with no anomaly", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      const result = await iot.ingestReading("t1", "dev1", { temperature: 25, humidity: 50 });
      expect(result).toEqual({ success: true, isAnomaly: false });
      expect(IotReading.create).toHaveBeenCalledWith({
        tenantId: "t1",
        deviceId: "dev1",
        metrics: { temperature: 25, humidity: 50 },
        isAnomaly: false,
      });
      expect(Notification.create).not.toHaveBeenCalled();
    });

    it("should detect anomaly when value below min", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      const result = await iot.ingestReading("t1", "dev1", { temperature: 5, humidity: 50 });
      expect(result.isAnomaly).toBe(true);
      expect(Notification.create).toHaveBeenCalledWith({
        tenantId: "t1",
        title: "IoT Anomaly Alert: Sensor Alpha",
        message: expect.stringContaining("temperature"),
        type: "system",
      });
      expect(logger.warn).toHaveBeenCalledWith("IoT Anomaly detected for device dev1", expect.any(Object));
    });

    it("should detect anomaly when value above max", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      const result = await iot.ingestReading("t1", "dev1", { temperature: 60 });
      expect(result.isAnomaly).toBe(true);
      expect(Notification.create).toHaveBeenCalledWith({
        tenantId: "t1",
        title: "IoT Anomaly Alert: Sensor Alpha",
        message: expect.stringContaining("above max"),
        type: "system",
      });
    });

    it("should detect multiple anomalies", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      const result = await iot.ingestReading("t1", "dev1", { temperature: 5, humidity: 90 });
      expect(result.isAnomaly).toBe(true);
      expect(Notification.create).toHaveBeenCalled();
    });

    it("should throw when device not found", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(null);

      await expect(iot.ingestReading("t1", "dev1", {})).rejects.toThrow("Device not found or IoT disabled");
    });

    it("should create reading even with no tolerance config", async () => {
      const deviceNoTolerance = { id: "dev1", name: "Basic Sensor", readingTolerance: null };
      CalibrationDevice.unscoped().findOne.mockResolvedValue(deviceNoTolerance);

      const result = await iot.ingestReading("t1", "dev1", { temperature: 25 });
      expect(result).toEqual({ success: true, isAnomaly: false });
      expect(IotReading.create).toHaveBeenCalled();
      expect(Notification.create).not.toHaveBeenCalled();
    });

    it("should ignore metrics that have no tolerance entry", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      const result = await iot.ingestReading("t1", "dev1", { pressure: 9999 });

      expect(result.isAnomaly).toBe(false);
      expect(Notification.create).not.toHaveBeenCalled();
    });

    it("should only check max when the tolerance has no min", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue({
        id: "dev1",
        name: "Max Only",
        readingTolerance: { temperature: { max: 50 } },
      });

      expect((await iot.ingestReading("t1", "dev1", { temperature: -100 })).isAnomaly).toBe(false);
      expect((await iot.ingestReading("t1", "dev1", { temperature: 60 })).isAnomaly).toBe(true);
      expect(Notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Anomalous readings detected: temperature (60) is above max (50)" })
      );
    });

    it("should only check min when the tolerance has no max", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue({
        id: "dev1",
        name: "Min Only",
        readingTolerance: { temperature: { min: 10 } },
      });

      expect((await iot.ingestReading("t1", "dev1", { temperature: 9999 })).isAnomaly).toBe(false);
      expect((await iot.ingestReading("t1", "dev1", { temperature: 5 })).isAnomaly).toBe(true);
      expect(Notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Anomalous readings detected: temperature (5) is below min (10)" })
      );
    });

    it("should join every anomaly detail into one notification message", async () => {
      CalibrationDevice.unscoped().findOne.mockResolvedValue(mockDevice);

      await iot.ingestReading("t1", "dev1", { temperature: 5, humidity: 90 });

      expect(Notification.create).toHaveBeenCalledWith({
        tenantId: "t1",
        title: "IoT Anomaly Alert: Sensor Alpha",
        message:
          "Anomalous readings detected: temperature (5) is below min (10), humidity (90) is above max (80)",
        type: "system",
      });
    });
  });

  describe("disconnect", () => {
    it("should end the mqtt client and nullify state", async () => {
      const mockEnd = jest.fn();
      iot.client = { end: mockEnd };
      iot.connected = true;

      iot.disconnect();
      expect(mockEnd).toHaveBeenCalledWith(false, expect.any(Function));
      expect(iot.connected).toBe(false);
      expect(iot.client).toBeNull();
    });

    it("should log once the client end callback fires", async () => {
      iot.client = { end: jest.fn((force, cb) => cb()) };
      iot.connected = true;

      iot.disconnect();

      expect(logger.info).toHaveBeenCalledWith("IoT MQTT Client disconnected");
    });

    it("should be safe when client is null", async () => {
      iot.client = null;
      iot.connected = false;
      iot.disconnect(); // should not throw
      expect(iot.client).toBeNull();
    });
  });
});
