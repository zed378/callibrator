/**
 * P9-11 (ADR-093) — the iot tolerance schema reads any non-array object's own
 * keys, as it always did (it is also the D-27 shape of
 * `calibration_devices.reading_tolerance`); z.record alone reads plain objects.
 */
import { readingToleranceSchema, updateIotConfigSchema } from "../../validators/iot.validator";

class Bounds {
  cpu = { min: 1, max: 5 };
}

describe("P9-11 iot.validator — readingToleranceSchema", () => {
  it("accepts a plain object, null, and a non-plain object by its own keys", () => {
    expect(readingToleranceSchema.parse({ cpu: { min: 1 } })).toEqual({ cpu: { min: 1 } });
    expect(readingToleranceSchema.parse(null)).toBeNull();
    expect(readingToleranceSchema.parse(new Bounds())).toEqual({ cpu: { min: 1, max: 5 } });
    expect(readingToleranceSchema.parse(new Date(0))).toEqual({});
  });

  it("refuses a bad metric name, an empty bound, a misspelt bound, min > max, an unsafe number and 51 metrics", () => {
    const refused = [
      { "bad key!": { min: 1 } },
      { cpu: {} },
      { cpu: { min: 1, mx: 2 } },
      { cpu: { min: 3, max: 1 } },
      { cpu: { min: 2 ** 60 } },
      Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`m${String(i)}`, { min: i }])),
      [],
    ];
    for (const value of refused) {
      expect({ value, ok: readingToleranceSchema.safeParse(value).success }).toEqual({ value, ok: false });
    }
  });

  it("updateIotConfigSchema needs at least one field", () => {
    expect(updateIotConfigSchema.safeParse({}).error?.issues.map((i) => i.message)).toEqual([
      "Provide iotEnabled and/or readingTolerance",
    ]);
    expect(updateIotConfigSchema.parse({ iotEnabled: "true" })).toEqual({ iotEnabled: true });
  });
});
