/**
 * Network Security validator tests
 *
 * P9-11 (ADR-093): the module's own validate() is gone; the schemas are
 * exercised through the shared validateInput, which returns the parsed value
 * or throws { status: 400, message: "Validation failed", errors: [{ field, message }] }.
 */
const {
  ipAllowlistSchema,
  geofenceSchema,
  evaluateLoginSchema,
} = require("../../validators/networkSecurity.validator");
const { validateInput } = require("../../validators/input");

const validate = validateInput;

/**
 * @param {unknown} data - the input
 * @param {import("zod").ZodType} schema - the schema
 * @returns {Array<{field: string, message: string}>} the field errors validateInput threw
 */
const errorsOf = (data, schema) => {
  try {
    validate(data, schema);
  } catch (error) {
    expect(error.status).toBe(400);
    expect(error.message).toBe("Validation failed");
    return error.errors;
  }
  throw new Error("expected a validation failure");
};

describe("Network Security Validators", () => {
  describe("ipAllowlistSchema", () => {
    it("should validate correct CIDR list", () => {
      const value = validate({ cidrs: ["192.168.1.0/24", "10.0.0.0/8"] }, ipAllowlistSchema);

      expect(value.cidrs).toEqual(["192.168.1.0/24", "10.0.0.0/8"]);
    });

    it("should validate single CIDR", () => {
      expect(() => validate({ cidrs: ["192.168.1.0/24"] }, ipAllowlistSchema)).not.toThrow();
    });

    it("should validate CIDR without prefix", () => {
      expect(() => validate({ cidrs: ["192.168.1.1"] }, ipAllowlistSchema)).not.toThrow();
    });

    it("should accept an empty list", () => {
      expect(validate({ cidrs: [] }, ipAllowlistSchema)).toEqual({ cidrs: [] });
    });

    it("should reject invalid CIDR format", () => {
      expect(errorsOf({ cidrs: ["not-a-valid-cidr"] }, ipAllowlistSchema)).toEqual([
        { field: "cidrs.0", message: "Expected an IPv4 or IPv6 address or CIDR" },
      ]);
    });

    it("should reject missing CIDRs", () => {
      expect(errorsOf({}, ipAllowlistSchema)).toEqual([
        { field: "cidrs", message: "Invalid input: expected array, received undefined" },
      ]);
    });
  });

  describe("geofenceSchema", () => {
    it("should validate correct geofence", () => {
      const value = validate({ latitude: 40.7128, longitude: -74.006 }, geofenceSchema);

      expect(value.latitude).toBe(40.7128);
    });

    it("should validate with radius", () => {
      expect(validate({ latitude: 40.7128, longitude: -74.006, radiusKm: 5 }, geofenceSchema).radiusKm).toBe(5);
    });

    it("should validate a small radius", () => {
      expect(() => validate({ latitude: 40.7128, longitude: -74.006, radiusKm: 0.1 }, geofenceSchema)).not.toThrow();
    });

    it("should reject a zero radius", () => {
      expect(errorsOf({ latitude: 0, longitude: 0, radiusKm: 0 }, geofenceSchema)).toEqual([
        { field: "radiusKm", message: "Too small: expected number to be >0" },
      ]);
    });

    it("should convert numeric strings", () => {
      expect(validate({ latitude: "-90", longitude: "180", radiusKm: "5" }, geofenceSchema)).toEqual({
        latitude: -90,
        longitude: 180,
        radiusKm: 5,
      });
    });

    it("should validate negative coordinates", () => {
      expect(() => validate({ latitude: -33.8688, longitude: 151.2093 }, geofenceSchema)).not.toThrow();
    });

    it("should validate boundary latitude", () => {
      expect(() => validate({ latitude: -90, longitude: 0 }, geofenceSchema)).not.toThrow();
    });

    it("should validate max latitude", () => {
      expect(() => validate({ latitude: 90, longitude: 180 }, geofenceSchema)).not.toThrow();
    });

    it("should reject latitude above 90", () => {
      expect(errorsOf({ latitude: 91, longitude: 0 }, geofenceSchema)).toEqual([
        { field: "latitude", message: "Too big: expected number to be <=90" },
      ]);
    });

    it("should reject latitude below -90", () => {
      expect(errorsOf({ latitude: -91, longitude: 0 }, geofenceSchema)).toEqual([
        { field: "latitude", message: "Too small: expected number to be >=-90" },
      ]);
    });

    it("should reject longitude above 180", () => {
      expect(errorsOf({ latitude: 0, longitude: 181 }, geofenceSchema)).toEqual([
        { field: "longitude", message: "Too big: expected number to be <=180" },
      ]);
    });

    it("should reject missing latitude", () => {
      expect(errorsOf({ longitude: 0 }, geofenceSchema)).toEqual([
        { field: "latitude", message: "Invalid input: expected number, received undefined" },
      ]);
    });

    it("should reject missing longitude", () => {
      expect(errorsOf({ latitude: 0 }, geofenceSchema)).toEqual([
        { field: "longitude", message: "Invalid input: expected number, received undefined" },
      ]);
    });
  });

  describe("evaluateLoginSchema", () => {
    it("should validate correct login evaluation", () => {
      expect(validate({ ip: "192.168.1.1" }, evaluateLoginSchema)).toEqual({ ip: "192.168.1.1" });
    });

    it("should validate with IPv6", () => {
      expect(() => validate({ ip: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" }, evaluateLoginSchema)).not.toThrow();
    });

    it.each(["10.0.0.0/8", "2001:db8::/32", "::1"])("should accept %s (IPv4/IPv6, CIDR optional)", (ip) => {
      expect(() => validate({ ip }, evaluateLoginSchema)).not.toThrow();
    });

    it("should validate with geolocation", () => {
      expect(() =>
        validate({ ip: "192.168.1.1", latitude: 40.7128, longitude: -74.006 }, evaluateLoginSchema),
      ).not.toThrow();
    });

    it("should validate with only longitude", () => {
      expect(() => validate({ ip: "192.168.1.1", longitude: -74.006 }, evaluateLoginSchema)).not.toThrow();
    });

    it("should reject missing IP", () => {
      expect(errorsOf({ latitude: 40.7128 }, evaluateLoginSchema)).toEqual([
        { field: "ip", message: "Invalid IP address" },
      ]);
    });

    it("should reject invalid IP", () => {
      expect(errorsOf({ ip: "not-an-ip" }, evaluateLoginSchema)).toEqual([
        { field: "ip", message: "Invalid IP address" },
      ]);
    });

    it("should reject invalid latitude", () => {
      expect(errorsOf({ ip: "192.168.1.1", latitude: 100 }, evaluateLoginSchema)).toEqual([
        { field: "latitude", message: "Too big: expected number to be <=90" },
      ]);
    });

    it("should reject invalid longitude", () => {
      expect(errorsOf({ ip: "192.168.1.1", longitude: -200 }, evaluateLoginSchema)).toEqual([
        { field: "longitude", message: "Too small: expected number to be >=-180" },
      ]);
    });
  });
});
