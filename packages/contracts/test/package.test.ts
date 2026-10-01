/**
 * P9-22 (ADR-097) — @callibrator/contracts as its consumers load it.
 *
 * 1. The barrel and the per-domain entry points hand out the SAME schema
 *    objects the backend validators re-export: validate(), enumMirrors.d26 and
 *    the contract suites rely on that identity.
 * 2. One zod: the package, the backend and the frontend all resolve `zod` to
 *    the same file. Two copies would give two `z.ZodType` classes, and a
 *    schema from one failing an `instanceof` in the other.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as barrel from "@callibrator/contracts";
import * as devices from "@callibrator/contracts/calibrationDevices";
import * as fields from "@callibrator/contracts/fields";
import * as vendor from "@callibrator/contracts/vendor";
import * as backendDevices from "../../../backend/src/validators/calibrationDevices.validator";
import * as backendFields from "../../../backend/src/validators/fields";
import * as backendVendor from "../../../backend/src/validators/vendor.validator";

const REPO = path.resolve(__dirname, "..", "..", "..");

describe("@callibrator/contracts", () => {
  it("the barrel re-exports every domain module's schemas, by identity", () => {
    expect(barrel.createVendor).toBe(vendor.createVendor);
    expect(barrel.createCalibrationDeviceSchema).toBe(devices.createCalibrationDeviceSchema);
    expect(barrel.numeric).toBe(fields.numeric);
    expect(barrel.VENDOR_TYPES).toEqual(["CalibrationLab", "PartsSupplier", "Other"]);
    expect(barrel.DEVICE_STATUSES).toEqual(["active", "inactive", "maintenance", "retired"]);
  });

  it("the backend validators hand out the package's own objects", () => {
    expect(backendVendor.createVendor).toBe(vendor.createVendor);
    expect(backendVendor.updateVendor).toBe(vendor.updateVendor);
    expect(backendVendor.qualifyVendor).toBe(vendor.qualifyVendor);
    expect(backendDevices.getCalibrationDevicesQuery).toBe(devices.getCalibrationDevicesQuery);
    expect(backendDevices.calibrationDeviceIdSchema).toBe(devices.calibrationDeviceIdSchema);
    expect(backendDevices.createCalibrationDeviceSchema).toBe(devices.createCalibrationDeviceSchema);
    expect(backendDevices.updateCalibrationDeviceSchema).toBe(devices.updateCalibrationDeviceSchema);
    expect(backendFields.numeric).toBe(fields.numeric);
    expect(Object.keys(backendFields).sort()).toEqual(Object.keys(fields).sort());
  });

  it("the package, the backend and the frontend resolve one zod", () => {
    const from = (workspace: string): string =>
      fs.realpathSync(require.resolve("zod/package.json", { paths: [path.join(REPO, workspace)] }));
    const resolved = ["packages/contracts", "backend", "frontend"].map(from);
    expect(new Set(resolved).size).toBe(1);
    const manifest: unknown = JSON.parse(fs.readFileSync(resolved[0] ?? "", "utf8"));
    expect(manifest).toMatchObject({ version: expect.stringMatching(/^4\./) as unknown });
  });
});
