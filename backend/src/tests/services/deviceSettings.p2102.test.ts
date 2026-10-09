/**
 * P21-02a / P21-05 — the tenant settings of the device register (ADR-132 Am. 2, ADR-133 Am. 2;
 * specs P19-03 § 4.2, P19-05 § 6, P19-08 § 7.2): written through `PATCH /tenants/settings` (a QR
 * prefix of 1 – 8 upper-case letters, 4 – 12 digits, a working set of 1 – 5,000 devices, a "due
 * soon" window of 1 – 365 days, or cleared); anything else is a 400 naming the key and nothing is
 * written. Read by `deviceSettingsOf`, defaults filled in: no prefix, 6 digits, 2,000, 30 days,
 * Asia/Jakarta.
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as TenantService from "../../services/tenant.service";
import type * as DeviceSettings from "../../services/deviceSettings.service";
import type { TenantId } from "../../types/ids";

jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
  del: jest.fn(() => Promise.resolve(true)),
  delPattern: jest.fn(() => Promise.resolve(undefined)),
  cacheKeys: new Proxy({}, { get: (_t, name) => (...args: unknown[]) => `${String(name)}:${args.map(String).join(":")}` }),
}));

const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
const tenantService = jest.requireActual<typeof TenantService>("../../services/tenant.service");
const { deviceSettingsOf } = jest.requireActual<typeof DeviceSettings>("../../services/deviceSettings.service");
const T = "aaaaaaaa-0000-4000-8000-000000000001" as TenantId;
const ADMIN = "cccccccc-0000-4000-8000-000000000001";

beforeEach(() => {
  mdb.reset();
  mdb.seed("Tenant", { id: T, name: "Tenant", code: "TA", status: "active" });
});

describe("PATCH /tenants/settings — the device keys", () => {
  it.each([
    ["device_qr_code_prefix", "TST"],
    ["device_qr_code_prefix", ""],
    ["device_qr_code_prefix", null],
    ["device_qr_code_digits", 4],
    ["device_qr_code_digits", "12"],
    ["field_working_set_max_devices", 5000],
    ["calibration_due_soon_days", "365"],
  ])("%s = %p is stored", async (key, value) => {
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).resolves.toBeDefined();
  });

  it.each([
    ["device_qr_code_prefix", "tst"],
    ["device_qr_code_prefix", "TOOLONGPREFIX"],
    ["device_qr_code_prefix", 7],
    ["device_qr_code_digits", 3],
    ["device_qr_code_digits", 13],
    ["field_working_set_max_devices", 5001],
    ["calibration_due_soon_days", 0],
  ])("%s = %p → 400 naming the key; nothing written", async (key, value) => {
    const before = mdb.committed().length;
    await expect(tenantService.updateTenantSettings(T, { [key]: value }, ADMIN, { userId: ADMIN })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining(key) as unknown,
    });
    expect(mdb.committed().slice(before)).toEqual([]);
  });
});

describe("deviceSettingsOf", () => {
  const seed = (values: Record<string, string | null>): void => {
    for (const [key, value] of Object.entries(values)) {
      mdb.seed("TenantSettings", { tenantId: T, key, value });
    }
  };

  it("unset: no prefix, 6 digits, 2,000 devices, 30 days, Asia/Jakarta", async () => {
    await expect(deviceSettingsOf(T)).resolves.toEqual({ qr: { prefix: null, digits: 6 }, workingSetMax: 2000, dueSoonDays: 30, timeZone: "Asia/Jakarta" });
  });

  it("set: the values; out of range or malformed: the defaults", async () => {
    seed({ device_qr_code_prefix: "TST", device_qr_code_digits: "8", field_working_set_max_devices: "10", calibration_due_soon_days: "14", tenant_time_zone: "UTC" });
    await expect(deviceSettingsOf(T)).resolves.toEqual({ qr: { prefix: "TST", digits: 8 }, workingSetMax: 10, dueSoonDays: 14, timeZone: "UTC" });
    mdb.reset();
    seed({ device_qr_code_prefix: "tst", device_qr_code_digits: "99", field_working_set_max_devices: "", calibration_due_soon_days: null, tenant_time_zone: "Mars/Olympus" });
    await expect(deviceSettingsOf(T)).resolves.toEqual({ qr: { prefix: null, digits: 6 }, workingSetMax: 2000, dueSoonDays: 30, timeZone: "Asia/Jakarta" });
  });
});
