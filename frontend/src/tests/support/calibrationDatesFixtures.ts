/**
 * P22-05 — synthetic devices, records and laboratories for the calibration-dates suites, shaped as
 * the P21-05 / P21-06 API answers them (`schema.d.ts`). No upstream value: every name is invented.
 */
import type { CalibrationRecord, Device, ExternalCalibrationRecord, Laboratory } from "@/api/services/calibrationDates.service";

export const CD_IDS = {
  device: "7a1c0d00-0000-4000-8000-000000000001",
  location: "7a1c0d00-0000-4000-8000-000000000002",
  vendor: "7a1c0d00-0000-4000-8000-000000000003",
  otherVendor: "7a1c0d00-0000-4000-8000-000000000004",
  facility: "7a1c0d00-0000-4000-8000-000000000005",
  tenant: "7a1c0d00-0000-4000-8000-000000000006",
  record: "7a1c0d00-0000-4000-8000-000000000007",
} as const;

export const ok = <T>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
export const meta = (total: number, page = 1, limit = 50) => ({ total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });

export const device = (over: Partial<Device> = {}): Device => ({
  id: CD_IDS.device,
  tenantId: CD_IDS.tenant,
  name: "Synthetic infusion pump",
  serialNumber: "SYN-001",
  manufacturer: "Synthetic Co",
  model: "P-1",
  category: null,
  status: "active",
  locationId: CD_IDS.location,
  installationDate: null,
  nextCalibrationDate: "2027-01-10",
  calibrationIntervalDays: 365,
  remarks: null,
  iotEnabled: false,
  isDeleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  warehouse: { id: CD_IDS.location, name: "Room 101", code: "R101", floor: "1", kind: "room" },
  qrCode: "QR-000123",
  deviceType: { id: "7a1c0d00-0000-4000-8000-0000000000aa", name: "Infusion pump" },
  clientFacilityId: CD_IDS.facility,
  clientFacility: { id: CD_IDS.facility, name: "Synthetic clinic", code: "SC" },
  calibrationVendorId: CD_IDS.vendor,
  calibrationVendorDisplay: { name: "Synthetic Lab" },
  calibrationRequestedAt: null,
  calibrationDue: { state: "ok", nextCalibrationDate: "2027-01-10", source: "record", requestedBySessionId: null },
  lastCalibration: { recordId: CD_IDS.record, date: "2026-01-10", entryKind: "external_date", externalLabName: "Synthetic Lab", performerDisplay: null },
  ...over,
});

export const record = (over: Partial<CalibrationRecord> = {}): CalibrationRecord => ({
  id: CD_IDS.record,
  tenantId: CD_IDS.tenant,
  deviceId: CD_IDS.device,
  performedBy: null,
  performerDisplay: { name: "Synthetic Technician", role: null, organisation: null, redacted: false },
  apiKeyId: null,
  calibrationDate: "2026-01-10",
  dueDate: "2027-01-10",
  standard: null,
  results: null,
  measurementUncertainty: null,
  isCompliant: true,
  certificateNumber: "CERT-1",
  certificateFileUrl: null,
  notes: null,
  isDeleted: false,
  supersedesId: null,
  correctionReason: null,
  supersededById: null,
  supersededAt: null,
  voidReason: null,
  voidedBy: null,
  createdAt: "2026-01-10T03:00:00.000Z",
  updatedAt: "2026-01-10T03:00:00.000Z",
  device: { id: CD_IDS.device, name: "Synthetic infusion pump", serialNumber: "SYN-001", manufacturer: null, model: null, qrCode: "QR-000123" },
  entryKind: "external_date",
  externalLabName: "Synthetic Lab",
  room: { name: "Room 101", floor: "1" },
  clientFacility: { id: CD_IDS.facility, name: "Synthetic clinic", code: "SC" },
  ...over,
});

export const savedRecord = (over: Partial<ExternalCalibrationRecord> = {}): ExternalCalibrationRecord => ({
  id: CD_IDS.record,
  deviceId: CD_IDS.device,
  entryKind: "external_date",
  calibrationDate: "2026-10-01",
  dueDate: null,
  externalLabName: "Synthetic Lab",
  device: { id: CD_IDS.device, nextCalibrationDate: "2027-10-01", nextCalibrationDateSource: "record", calibrationRequestedAt: null },
  notices: [],
  ...over,
});

export const lab = (id: string, name: string): Laboratory => ({
  id,
  tenantId: CD_IDS.tenant,
  name,
  type: "CalibrationLab",
  contactPerson: null,
  email: null,
  phone: null,
  address: null,
  notes: null,
  rating: null,
  approvalStatus: "APPROVED",
  scorecard: null,
  lastAuditDate: null,
  nextAuditDate: null,
  status: "Active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});
