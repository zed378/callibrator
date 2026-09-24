/**
 * The data stores' error contract (see src/tests/support/storeContract.ts).
 * F-64: roleStore.updateRole / deleteRole swallowed failures — they are
 * writes and now rethrow like every other write.
 */
const calibrationService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), correct: jest.fn(), void: jest.fn(),
  getAllCertificates: jest.fn(), getCertificateById: jest.fn(), createCertificate: jest.fn(),
  updateCertificate: jest.fn(), deleteCertificate: jest.fn(), approveCertificate: jest.fn(),
  signCertificate: jest.fn(), revokeCertificate: jest.fn(), getCertificateStats: jest.fn(),
};
const deviceService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
};
const warehouseService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  getLocations: jest.fn(), createLocation: jest.fn(), updateLocation: jest.fn(), deleteLocation: jest.fn(),
};
const roleService = {
  getAll: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
};
const tenantBackupService = {
  create: jest.fn(), getAll: jest.fn(), getById: jest.fn(), downloadToDisk: jest.fn(),
  restore: jest.fn(), delete: jest.fn(), getStats: jest.fn(),
};
jest.mock("@/api/services/calibration.service", () => ({ calibrationService }));
jest.mock("@/api/services/device.service", () => ({ deviceService }));
jest.mock("@/api/services/warehouse.service", () => ({ warehouseService }));
jest.mock("@/api/services/role.service", () => ({ roleService }));
jest.mock("@/api/services/tenantBackup.service", () => ({ tenantBackupService }));

import type { StoreApi, UseBoundStore } from "zustand";
import { describeStoreContract } from "@/tests/support/storeContract";
import { useCalibrationStore } from "../calibrationStore";
import { useDeviceStore } from "../deviceStore";
import { useWarehouseStore } from "../warehouseStore";
import { useRoleStore } from "../roleStore";
import { useTenantBackupStore } from "../tenantBackupStore";

type AnyStore = UseBoundStore<StoreApi<Record<string, unknown>>>;
const page = { data: [{ id: "x" }], meta: { page: 2, limit: 5, totalPages: 1, total: 1 } };
const signing = { authMethod: "password", authPayload: { password: "p" }, meaning: "approve" };

describeStoreContract(
  "calibrationStore",
  useCalibrationStore as unknown as AnyStore,
  calibrationService,
  { calibrations: null, certificates: null, certificateStats: null, currentCalibration: null, currentCertificate: null, isLoading: false, error: null },
  [
    { action: "fetchCalibrations", args: [2, 5, "d1", true, "2026-01-01", "2026-02-01"], method: "getAll", resolved: page, stateKey: "calibrations", rethrows: false, fallback: "Failed to fetch calibration records" },
    { action: "fetchCalibrationById", args: ["c1"], method: "getById", resolved: { id: "c1" }, stateKey: "currentCalibration", rethrows: false, fallback: "Failed to fetch calibration record" },
    { action: "createCalibration", args: [{ deviceId: "d1" }], method: "create", resolved: { id: "c2" }, rethrows: true, fallback: "Failed to create calibration record" },
    { action: "correctCalibration", args: [{ id: "c1" }], method: "correct", resolved: { id: "c3" }, stateKey: "currentCalibration", rethrows: true, fallback: "Failed to correct calibration record" },
    { action: "voidCalibration", args: ["c1", "entered in error"], method: "void", rethrows: true, fallback: "Failed to void calibration record" },
    { action: "fetchCertificates", args: [1, 10, "d1", "draft", "calibration", "CERT-1", "a", "b"], method: "getAllCertificates", resolved: page, stateKey: "certificates", rethrows: false, fallback: "Failed to fetch certificates" },
    { action: "fetchCertificateById", args: ["k1"], method: "getCertificateById", resolved: { id: "k1" }, stateKey: "currentCertificate", rethrows: false, fallback: "Failed to fetch certificate" },
    { action: "createCertificate", args: [{ deviceId: "d1" }], method: "createCertificate", resolved: { id: "k2" }, rethrows: true, fallback: "Failed to create certificate" },
    { action: "updateCertificate", args: [{ id: "k1" }], method: "updateCertificate", resolved: { id: "k1" }, stateKey: "currentCertificate", rethrows: true, fallback: "Failed to update certificate" },
    { action: "deleteCertificate", args: ["k1"], method: "deleteCertificate", rethrows: true, fallback: "Failed to delete certificate" },
    { action: "approveCertificate", args: ["k1", signing], method: "approveCertificate", resolved: { id: "k1", status: "approved" }, stateKey: "currentCertificate", rethrows: true, fallback: "Failed to approve certificate" },
    { action: "signCertificate", args: ["k1", signing], method: "signCertificate", resolved: { id: "k1", status: "signed" }, stateKey: "currentCertificate", rethrows: true, fallback: "Failed to sign certificate" },
    { action: "revokeCertificate", args: ["k1", signing], method: "revokeCertificate", resolved: { id: "k1", status: "revoked" }, stateKey: "currentCertificate", rethrows: true, fallback: "Failed to revoke certificate" },
    { action: "fetchCertificateStats", args: [], method: "getCertificateStats", resolved: { totalCertificates: 3 }, stateKey: "certificateStats", rethrows: false, fallback: "Failed to fetch certificate statistics" },
  ],
);

describeStoreContract(
  "deviceStore",
  useDeviceStore as unknown as AnyStore,
  deviceService,
  { devices: null, currentDevice: null, isLoading: false, error: null },
  [
    { action: "fetchDevices", args: [1, 10, "pump", "active", "infusion"], method: "getAll", resolved: page, stateKey: "devices", rethrows: false, fallback: "Failed to fetch devices" },
    { action: "fetchDeviceById", args: ["d1"], method: "getById", resolved: { id: "d1" }, stateKey: "currentDevice", rethrows: false, fallback: "Failed to fetch device" },
    { action: "createDevice", args: [{ name: "Pump" }], method: "create", resolved: { id: "d2" }, rethrows: true, fallback: "Failed to create device" },
    { action: "updateDevice", args: [{ id: "d1" }], method: "update", resolved: { id: "d1" }, stateKey: "currentDevice", rethrows: true, fallback: "Failed to update device" },
    { action: "deleteDevice", args: ["d1"], method: "delete", rethrows: true, fallback: "Failed to delete device" },
  ],
);

describeStoreContract(
  "warehouseStore",
  useWarehouseStore as unknown as AnyStore,
  warehouseService,
  { warehouses: null, currentWarehouse: null, locations: [{ id: "l1", name: "A" }, { id: "l2", name: "B" }], isLoading: false, error: null },
  [
    { action: "fetchWarehouses", args: [1, 25, "main"], method: "getAll", resolved: page, stateKey: "warehouses", rethrows: false, fallback: "Failed to fetch warehouses" },
    { action: "fetchWarehouseById", args: ["w1"], method: "getById", resolved: { id: "w1" }, stateKey: "currentWarehouse", rethrows: false, fallback: "Failed to fetch warehouse details" },
    { action: "createWarehouse", args: [{ name: "W" }], method: "create", resolved: { id: "w2" }, rethrows: true, fallback: "Failed to create warehouse" },
    { action: "updateWarehouse", args: ["w1", { name: "W" }], method: "update", resolved: { id: "w1" }, stateKey: "currentWarehouse", rethrows: true, fallback: "Failed to update warehouse" },
    { action: "deleteWarehouse", args: ["w1"], method: "delete", rethrows: true, fallback: "Failed to delete warehouse" },
    { action: "fetchLocations", args: ["w1"], method: "getLocations", resolved: [{ id: "l9" }], stateKey: "locations", rethrows: false, fallback: "Failed to fetch storage locations" },
    { action: "createLocation", args: [{ name: "C" }], method: "createLocation", resolved: { id: "l3", name: "C" }, stateKey: "locations", stateValue: [{ id: "l1", name: "A" }, { id: "l2", name: "B" }, { id: "l3", name: "C" }], rethrows: true, fallback: "Failed to create storage location" },
    { action: "updateLocation", args: ["l2", { name: "B2" }], method: "updateLocation", resolved: { id: "l2", name: "B2" }, stateKey: "locations", stateValue: [{ id: "l1", name: "A" }, { id: "l2", name: "B2" }], rethrows: true, fallback: "Failed to update storage location" },
    { action: "deleteLocation", args: ["l1", "w1"], method: "deleteLocation", expectedArgs: ["l1"], stateKey: "locations", stateValue: [{ id: "l2", name: "B" }], rethrows: true, fallback: "Failed to delete storage location" },
  ],
);

describeStoreContract(
  "roleStore",
  useRoleStore as unknown as AnyStore,
  roleService,
  { roles: null, currentRole: null, isLoading: false, error: null },
  [
    { action: "fetchRoles", args: [1, 50, "tech"], method: "getAll", resolved: page, stateKey: "roles", rethrows: false, fallback: "Failed to fetch roles" },
    { action: "fetchRoleById", args: ["r1"], method: "getById", resolved: { id: "r1" }, stateKey: "currentRole", rethrows: false, fallback: "Failed to fetch role" },
    { action: "createRole", args: [{ name: "X" }], method: "create", rethrows: true, fallback: "Failed to create role" },
    { action: "updateRole", args: [{ id: "r1" }], method: "update", resolved: { id: "r1" }, rethrows: true, fallback: "Failed to update role" },
    { action: "deleteRole", args: ["r1"], method: "delete", rethrows: true, fallback: "Failed to delete role" },
  ],
);

describe("roleStore refetches the list after a write, at the current page", () => {
  beforeEach(() => Object.values(roleService).forEach((m) => m.mockReset()));

  it("createRole / updateRole / deleteRole / refetchRoles reload the roles", async () => {
    roleService.getAll.mockResolvedValue(page);
    roleService.create.mockResolvedValue({});
    roleService.update.mockResolvedValue({ id: "r1" });
    roleService.delete.mockResolvedValue(undefined);
    useRoleStore.setState({ roles: page as never });

    await useRoleStore.getState().createRole({ name: "X" } as never);
    expect(roleService.getAll).toHaveBeenLastCalledWith(1, 50);
    await useRoleStore.getState().updateRole({ id: "r1" } as never);
    expect(roleService.getAll).toHaveBeenLastCalledWith(2, 5);
    await useRoleStore.getState().deleteRole("r1");
    expect(roleService.getAll).toHaveBeenLastCalledWith(2, 5);
    await useRoleStore.getState().refetchRoles();
    expect(useRoleStore.getState().roles).toEqual(page);

    roleService.getAll.mockRejectedValue("x");
    useRoleStore.setState({ roles: null });
    await useRoleStore.getState().refetchRoles();
    expect(roleService.getAll).toHaveBeenLastCalledWith(1, 50);
    expect(useRoleStore.getState().error).toBe("Failed to refetch roles");
    useRoleStore.getState().setError(null);
    expect(useRoleStore.getState().error).toBeNull();
  });
});

describeStoreContract(
  "tenantBackupStore",
  useTenantBackupStore as unknown as AnyStore,
  tenantBackupService,
  { backups: [], meta: null, currentBackup: null, stats: null, isLoading: false, error: null },
  [
    { action: "createBackup", args: ["t1", { name: "b" }], method: "create", resolved: { id: "b1" }, stateKey: "currentBackup", rethrows: true, fallback: "Failed to create backup" },
    { action: "fetchBackupById", args: ["t1", "b1"], method: "getById", resolved: { id: "b1" }, stateKey: "currentBackup", rethrows: false, fallback: "Failed to fetch backup" },
    { action: "downloadBackup", args: ["t1", "b1"], method: "downloadToDisk", rethrows: false, fallback: "Failed to download backup" },
    { action: "restoreBackup", args: ["t1", "b1", { overwrite: true }], method: "restore", resolved: { restored: 3 }, rethrows: true, fallback: "Failed to restore backup" },
    { action: "fetchStats", args: ["t1"], method: "getStats", resolved: { total: 2 }, stateKey: "stats", rethrows: false, fallback: "Failed to fetch backup stats" },
  ],
);
