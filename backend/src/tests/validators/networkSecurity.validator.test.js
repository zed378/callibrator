/**
 * Network Security validator tests
 */
const {
  ipAllowlistSchema,
  geofenceSchema,
  evaluateLoginSchema,
  validate,
} = require("../../validators/networkSecurity.validator");

describe("Network Security Validators", () => {
  describe("ipAllowlistSchema", () => {
    it("should validate correct CIDR list", () => {
      const value = validate(
        { cidrs: ["192.168.1.0/24", "10.0.0.0/8"] },
        ipAllowlistSchema,
      );

      expect(value.cidrs.length).toBe(2);
    });

    it("should validate single CIDR", () => {
      expect(() =>
        validate({ cidrs: ["192.168.1.0/24"] }, ipAllowlistSchema),
      ).not.toThrow();
    });

    it("should validate CIDR without prefix", () => {
      expect(() =>
        validate({ cidrs: ["192.168.1.1"] }, ipAllowlistSchema),
      ).not.toThrow();
    });

    it("should reject invalid CIDR format", () => {
      expect(() =>
        validate({ cidrs: ["not-a-valid-cidr"] }, ipAllowlistSchema),
      ).toThrow();
    });

    it("should reject missing CIDRs", () => {
      expect(() =>
        validate({}, ipAllowlistSchema),
      ).toThrow();
    });
  });

  describe("geofenceSchema", () => {
    it("should validate correct geofence", () => {
      const value = validate(
        { latitude: 40.7128, longitude: -74.006 },
        geofenceSchema,
      );

      expect(value.latitude).toBe(40.7128);
    });

    it("should validate with radius", () => {
      expect(() =>
        validate({ latitude: 40.7128, longitude: -74.006, radiusKm: 5 }, geofenceSchema),
      ).not.toThrow();
    });

    it("should validate zero radius", () => {
      expect(() =>
        validate({ latitude: 40.7128, longitude: -74.006, radiusKm: 0.1 }, geofenceSchema),
      ).not.toThrow();
    });

    it("should validate negative coordinates", () => {
      expect(() =>
        validate({ latitude: -33.8688, longitude: 151.2093 }, geofenceSchema),
      ).not.toThrow();
    });

    it("should validate boundary latitude", () => {
      expect(() =>
        validate({ latitude: -90, longitude: 0 }, geofenceSchema),
      ).not.toThrow();
    });

    it("should validate max latitude", () => {
      expect(() =>
        validate({ latitude: 90, longitude: 180 }, geofenceSchema),
      ).not.toThrow();
    });

    it("should reject latitude above 90", () => {
      expect(() =>
        validate({ latitude: 91, longitude: 0 }, geofenceSchema),
      ).toThrow();
    });

    it("should reject latitude below -90", () => {
      expect(() =>
        validate({ latitude: -91, longitude: 0 }, geofenceSchema),
      ).toThrow();
    });

    it("should reject longitude above 180", () => {
      expect(() =>
        validate({ latitude: 0, longitude: 181 }, geofenceSchema),
      ).toThrow();
    });

    it("should reject missing latitude", () => {
      expect(() =>
        validate({ longitude: 0 }, geofenceSchema),
      ).toThrow();
    });

    it("should reject missing longitude", () => {
      expect(() =>
        validate({ latitude: 0 }, geofenceSchema),
      ).toThrow();
    });
  });

  describe("evaluateLoginSchema", () => {
    it("should validate correct login evaluation", () => {
      expect(() =>
        validate({ ip: "192.168.1.1" }, evaluateLoginSchema),
      ).not.toThrow();
    });

    it("should validate with IPv6", () => {
      expect(() =>
        validate({ ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }, evaluateLoginSchema),
      ).not.toThrow();
    });

    it("should validate with geolocation", () => {
      expect(() =>
        validate({ ip: "192.168.1.1", latitude: 40.7128, longitude: -74.006 }, evaluateLoginSchema),
      ).not.toThrow();
    });

    it("should validate with only longitude", () => {
      expect(() =>
        validate({ ip: "192.168.1.1", longitude: -74.006 }, evaluateLoginSchema),
      ).not.toThrow();
    });

    it("should reject missing IP", () => {
      expect(() =>
        validate({ latitude: 40.7128 }, evaluateLoginSchema),
      ).toThrow();
    });

    it("should reject invalid IP", () => {
      expect(() =>
        validate({ ip: "not-an-ip" }, evaluateLoginSchema),
      ).toThrow();
    });

    it("should reject invalid latitude", () => {
      expect(() =>
        validate({ ip: "192.168.1.1", latitude: 100 }, evaluateLoginSchema),
      ).toThrow();
    });

    it("should reject invalid longitude", () => {
      expect(() =>
        validate({ ip: "192.168.1.1", longitude: -200 }, evaluateLoginSchema),
      ).toThrow();
    });
  });
});
