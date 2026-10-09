/**
 * P21-02a / P21-05: what a device READ adds to the row (spec P19-03 § 8.2, § 8.3; P19-05 § 6;
 * P19-02 § 11; P19-08 § 7.2): `ipmDue`, `lastIpm`, the caller's `openIpmDraftId`, `photosComplete`
 * with the two photo ids, `calibrationDue` and `lastCalibration`, the registrant's and the
 * laboratory's displays; and the PWA's narrow `fieldDeviceSummary` (`?view=field`).
 *
 * Every fact is read through the MODELS for one page of devices at a time (a batch per kind, keyed
 * by the page's ids): the tenant and facility hooks scope each read, so a bound reader's facts are
 * its facility's by construction and no raw statement needs a bound predicate (ADR-132 Am. 2 § 4 —
 * a deviation from the spec's batched `sql()`; bounded by the page, `limit` at most 200).
 *
 * The laboratory is provider-internal: a bound reader's vendor include is NULL (deny per include,
 * AM-5), so its NAME is read through the one reviewed `skipFacilityScope` here (`labNames`) and the
 * vendor's id is not returned to it; nor are the registrant's user id and raw snapshot: the
 * display is the snapshot's printed name, role and organisation.
 *
 * Named exports only.
 */
import models from "../models";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { ipmSettingsOf } from "./ipmSettings.service";
import { deviceSettingsOf } from "./deviceSettings.service";
import { displayPeople } from "./personDisplay.service";
import { computeIpmDue, type IpmDue } from "@callibrator/contracts/inspectionValues";
import {
  FIELD_DEVICE_SUMMARY_KEYS,
  SINGLE_DEVICE_PHOTO_PURPOSES,
  computeCalibrationDue,
  zonedDayNumber,
  type CalibrationDue,
} from "@callibrator/contracts/deviceValues";
import type { PersonDisplay } from "@callibrator/contracts/people";
import type { ModelInstance } from "../types/models";

type DeviceRow = ModelInstance<"CalibrationDevice">;

/** The device's last calibration (the latest EFFECTIVE record; P19-05 § 6). */
export interface LastCalibration {
  readonly recordId: string;
  readonly date: string;
  readonly entryKind: string;
  readonly externalLabName: string | null;
  readonly performerDisplay: PersonDisplay | null;
}

/** The facts one device read adds. */
export interface DeviceFacts {
  readonly ipmDue: IpmDue;
  readonly lastIpm: { readonly performedAt: string; readonly visitNumber: number | null } | null;
  readonly openIpmDraftId: string | null;
  readonly photosComplete: boolean;
  readonly frontPhotoAttachmentId: string | null;
  readonly serialPlatePhotoAttachmentId: string | null;
  readonly calibrationDue: CalibrationDue;
  readonly lastCalibration: LastCalibration | null;
}

/** Whether the request's principal is facility-bound (its context, never the body). */
export const viewerIsBound = (): boolean => {
  const ctx = tenantStorage.getStore();
  return Boolean(ctx && !ctx.isSuperAdmin && ctx.facilityBound === true);
};

const DEVICE_RESOURCE_TYPES = new Set(["device", "calibrationdevice"]);

/** What a facility-bound reader is not given: the vendor's id and row, the registrant's user id and raw snapshot. */
const PROVIDER_ONLY_KEYS: ReadonlySet<string> = new Set(["calibrationVendorId", "calibrationVendor", "createdBy", "registrantSnapshot"]);

/** The first row per device of rows already ordered newest first. */
const firstPerDevice = <R extends { deviceId: string }>(rows: readonly R[]): Map<string, R> => {
  const out = new Map<string, R>();
  for (const row of rows) {
    if (!out.has(row.deviceId)) {
      out.set(row.deviceId, row);
    }
  }
  return out;
};

/**
 * The facts of one page of devices.
 *
 * @param tenantId - the caller's tenant (its settings)
 * @param devices - the page, read in the caller's context
 * @param callerUserId - the person reading (its own open draft), or null
 * @returns id → facts
 */
export const deviceFacts = async (tenantId: string, devices: readonly DeviceRow[], callerUserId: string | null): Promise<Map<string, DeviceFacts>> => {
  const out = new Map<string, DeviceFacts>();
  if (devices.length === 0) {
    return out;
  }
  const ids = devices.map((d) => d.id);
  const [ipm, settings] = [await ipmSettingsOf(tenantId), await deviceSettingsOf(tenantId)];
  const sessions = await models.InspectionSession.findAll({
    where: { deviceId: ids, status: "submitted", supersededById: null },
    attributes: ["id", "deviceId", "performedAt", "visitNumber"],
    order: [
      ["performedAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  const lastIpm = firstPerDevice(sessions);
  const drafts = callerUserId
    ? await models.InspectionSession.findAll({ where: { deviceId: ids, createdBy: callerUserId, status: "draft" }, attributes: ["id", "deviceId"] })
    : [];
  const draftOf = firstPerDevice(drafts);
  const photos = await models.Attachment.findAll({
    where: { resourceId: ids, purpose: [...SINGLE_DEVICE_PHOTO_PURPOSES] },
    attributes: ["id", "resourceId", "resourceType", "purpose"],
  });
  const photoOf = (deviceId: string, purpose: string): string | null =>
    photos.find((p) => p.resourceId === deviceId && p.purpose === purpose && DEVICE_RESOURCE_TYPES.has(String(p.resourceType).toLowerCase()))?.id ?? null;
  const records = await models.CalibrationRecord.findAll({
    where: { deviceId: ids, supersededById: null },
    attributes: ["id", "deviceId", "calibrationDate", "createdAt", "entryKind", "externalLabName", "performedBy", "performerSnapshot"],
    order: [
      ["calibrationDate", "DESC"],
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  const lastRecord = firstPerDevice(records);
  const people = await displayPeople([...lastRecord.values()].filter((r) => !r.performerSnapshot).map((r) => r.performedBy));
  const today = new Date();
  for (const d of devices) {
    const session = lastIpm.get(d.id);
    const record = lastRecord.get(d.id);
    const front = photoOf(d.id, "device_front");
    const plate = photoOf(d.id, "device_serial_plate");
    out.set(d.id, {
      ipmDue: computeIpmDue({
        status: d.status ?? null,
        intervalOverride: d.ipmIntervalMonths ?? null,
        tenantInterval: ipm.intervalMonths,
        lastEffectivePerformedAt: session ? new Date(session.performedAt) : null,
        today,
        timeZone: ipm.timeZone,
      }),
      lastIpm: session ? { performedAt: new Date(session.performedAt).toISOString(), visitNumber: session.visitNumber ?? null } : null,
      openIpmDraftId: draftOf.get(d.id)?.id ?? null,
      photosComplete: front !== null && plate !== null,
      frontPhotoAttachmentId: front,
      serialPlatePhotoAttachmentId: plate,
      calibrationDue: computeCalibrationDue({
        status: d.status ?? null,
        nextCalibrationDate: d.nextCalibrationDate ? new Date(d.nextCalibrationDate) : null,
        source: d.nextCalibrationDateSource ?? null,
        requestedAt: d.calibrationRequestedAt ?? null,
        requestedBySessionId: d.calibrationRequestedBySessionId ?? null,
        today,
        timeZone: settings.timeZone,
        dueSoonDays: settings.dueSoonDays,
      }),
      lastCalibration: record
        ? {
          recordId: record.id,
          date: zonedDayNumber(new Date(record.calibrationDate), settings.timeZone).text,
          entryKind: record.entryKind,
          externalLabName: record.externalLabName ?? null,
          performerDisplay: record.performerSnapshot
            ? { name: record.performerSnapshot.name, role: record.performerSnapshot.role, organisation: record.performerSnapshot.organisation, redacted: false }
            : (people.get(record.performedBy ?? "") ?? null),
        }
        : null,
    });
  }
  return out;
};

/**
 * The laboratories' names of a page (spec § 4.1): a bound reader's vendor include is NULL, so the
 * name is read here; the vendor row itself is never returned.
 *
 * @param vendorIds - the page's `calibration_vendor_id`s
 * @returns id → name
 */
export const labNames = async (vendorIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> => {
  const ids = [...new Set(vendorIds.filter((id): id is string => typeof id === "string"))];
  if (ids.length === 0) {
    return new Map();
  }
  const vendors = await models.Vendor.findAll({
    where: { id: ids },
    attributes: ["id", "name"],
    // skipFacilityScope: a device's calibration laboratory, by NAME only, for a facility reader (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
  });
  return new Map(vendors.map((v) => [v.id, v.name]));
};

/**
 * One device as a full read answers it: the row, its facts and its displays.
 *
 * @param device - the row (with its includes)
 * @param facts - its facts
 * @param labs - the laboratories' names
 * @param bound - whether the reader is facility-bound
 * @returns the JSON object
 */
export const presentDevice = (device: DeviceRow, facts: DeviceFacts | undefined, labs: ReadonlyMap<string, string>, bound: boolean): Record<string, unknown> => {
  const row = device.toJSON() as unknown as Record<string, unknown>;
  const vendorId = device.calibrationVendorId ?? null;
  const out: Record<string, unknown> = {
    ...row,
    ...facts,
    registrantDisplay: device.registrantSnapshot ?? null,
    calibrationVendorDisplay: vendorId && labs.has(vendorId) ? { name: labs.get(vendorId) } : null,
  };
  if (!bound) {
    return out;
  }
  return Object.fromEntries(Object.entries(out).filter(([key]) => !PROVIDER_ONLY_KEYS.has(key)));
};

/**
 * One device as `?view=field` answers it (P19-08 § 7.2): exactly `FIELD_DEVICE_SUMMARY_KEYS`.
 *
 * @param device - the row
 * @param facts - its facts
 * @returns the summary
 */
export const fieldSummary = (device: DeviceRow, facts: DeviceFacts | undefined): Record<string, unknown> => {
  const all: Record<string, unknown> = { ...(device.toJSON() as unknown as Record<string, unknown>), ...facts };
  return Object.fromEntries(FIELD_DEVICE_SUMMARY_KEYS.map((key) => [key, all[key] ?? null]));
};
