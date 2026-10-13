/**
 * The public device page's read (P21-08; ADR-138 § 2 – § 6, Am. 1 § 3 – § 5; spec
 * MEMORY/specs/P19-07-public-device-page.md § 7 – § 9).
 *
 * The order of work — every failure is the SAME 404 (`PUBLIC_DEVICE_NOT_FOUND`, one message):
 *  1. the token's shape (22 base64url characters);
 *  2. the link row by the token's SHA-256 — the ONE cross-tenant step (`resolveToken`: the reviewed
 *     `skipTenantScope` and `skipFacilityScope`), then the hashes compared in constant time; a
 *     revoked row is a miss;
 *  3. the tenant: present (its defaultScope hides a deleted one) and active (a suspended one: 404);
 *  4. inside `runForTenant(row.tenantId)` — the hooks confine every read to that tenant: the
 *     setting (`off`, unset or unknown: 404), the device (deleted: 404), its facility (`ended`:
 *     404; `inactive` still shows), its type, its last IPM and its calibration due.
 *
 * The answer is built field by field (an allow-list, § 8): never a serial, a QR number, a room, a
 * photo, a document, a person's name or any id. A retired device is shown as retired. An unknown
 * token costs one indexed lookup; a known token whose page is hidden costs more — Am. 1 § 3 (only a
 * sticker holder can observe it, and learns only what the 404 says). No audit row per view.
 *
 * Named exports only.
 */
import { timingSafeEqual } from "node:crypto";
import models from "../models";
import type { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { runForTenant } from "../utils/jobContext.util";
import { isActiveTenantStatus } from "../constants/tenantStatus";
import { deviceSettingsOf } from "./deviceSettings.service";
import { ipmVerifyUrl } from "./ipmReport.service";
import { hashPublicDeviceToken, pageModeOf } from "./publicDeviceToken.service";
import { computeCalibrationDue, zonedDayNumber } from "@callibrator/contracts/deviceValues";
import {
  PUBLIC_DEVICE_CODES,
  PUBLIC_DEVICE_NOT_FOUND_MESSAGE,
  PUBLIC_DEVICE_TOKEN,
  publicCalibrationStatus,
  type PublicDeviceView,
} from "@callibrator/contracts/publicDevices";
import type { ModelInstance } from "../types/models";

type LinkRow = ModelInstance<"PublicDeviceToken">;

/** The one answer for every failure (§ 7). */
export const publicDeviceNotFound = (): AppError => new CodedError(404, PUBLIC_DEVICE_CODES.notFound, PUBLIC_DEVICE_NOT_FOUND_MESSAGE);

/**
 * The active link row of a token hash, across tenants (the reviewed skips), or null.
 *
 * @param tokenHash - the SHA-256 of the presented token
 * @returns the active row, or null
 */
export const resolveToken = async (tokenHash: string): Promise<LinkRow | null> => {
  const row = await models.PublicDeviceToken.findOne({
    where: { tokenHash },
    // skipTenantScope: the public page has no principal; the 128-bit token is the capability and its
    // hash is globally unique (ADR-138 § 2, reviewed).
    skipTenantScope: true,
    // skipFacilityScope: the same read, with no principal (FACILITY_SCOPE_SKIPS, ADR-138 § 2).
    skipFacilityScope: true,
  });
  if (row?.revokedAt !== null) {
    return null;
  }
  const stored = Buffer.from(row.tokenHash, "utf8");
  const presented = Buffer.from(tokenHash, "utf8");
  return stored.length === presented.length && timingSafeEqual(stored, presented) ? row : null;
};

/** A date as the tenant's calendar day (`YYYY-MM-DD`), or null. */
const dayOf = (at: Date | null | undefined, timeZone: string): string | null => (at ? zonedDayNumber(new Date(at), timeZone).text : null);

/** The page's data, read in the link's own tenant (step 4). */
const readInTenant = async (row: LinkRow): Promise<PublicDeviceView> => {
  const mode = await pageModeOf(row.tenantId);
  if (mode === "off") {
    throw publicDeviceNotFound();
  }
  const device = await models.CalibrationDevice.findOne({ where: { id: row.deviceId } });
  if (!device) {
    throw publicDeviceNotFound();
  }
  const facility = await models.ClientFacility.findOne({ where: { id: device.clientFacilityId }, attributes: ["id", "name", "status"] });
  if (!facility || facility.status === "ended") {
    throw publicDeviceNotFound();
  }
  const type = device.deviceTypeId ? await models.DeviceType.findOne({ where: { id: device.deviceTypeId }, attributes: ["id", "name"] }) : null;
  const settings = await deviceSettingsOf(row.tenantId);
  const lastIpm = await models.InspectionSession.findOne({
    where: { deviceId: device.id, status: "submitted", supersededById: null },
    attributes: ["id", "performedAt", "reportNumber", "verificationToken"],
    order: [
      ["performedAt", "DESC"],
      ["id", "DESC"],
    ],
  });
  const due = computeCalibrationDue({
    status: device.status ?? null,
    nextCalibrationDate: device.nextCalibrationDate ? new Date(device.nextCalibrationDate) : null,
    source: device.nextCalibrationDateSource ?? null,
    requestedAt: device.calibrationRequestedAt ?? null,
    requestedBySessionId: device.calibrationRequestedBySessionId ?? null,
    today: new Date(),
    timeZone: settings.timeZone,
    dueSoonDays: settings.dueSoonDays,
  });
  const status = publicCalibrationStatus(device.status ?? null, due.state);
  const withReport = mode === "minimal_with_report" && lastIpm?.reportNumber && lastIpm.verificationToken;
  return {
    device: {
      name: device.name,
      type: type?.name ?? null,
      manufacturer: device.manufacturer ?? null,
      model: device.model ?? null,
    },
    facility: { name: facility.name },
    calibration: { status, nextDueDate: status === "retired" ? null : due.nextCalibrationDate },
    lastIpmDate: dayOf(lastIpm?.performedAt, settings.timeZone),
    report: withReport ? { verifyUrl: ipmVerifyUrl(lastIpm.reportNumber as string, lastIpm.verificationToken as string) } : null,
  };
};

/**
 * GET /public/devices/:token.
 *
 * @param token - the presented token (any string)
 * @returns the page's data
 * @throws CodedError 404 `PUBLIC_DEVICE_NOT_FOUND` — identical for every failure
 */
export const readPublicDevice = async (token: string): Promise<PublicDeviceView> => {
  if (!PUBLIC_DEVICE_TOKEN.test(token)) {
    throw publicDeviceNotFound();
  }
  const row = await resolveToken(hashPublicDeviceToken(token));
  if (!row) {
    throw publicDeviceNotFound();
  }
  const tenant = await models.Tenant.findOne({ where: { id: row.tenantId }, attributes: ["id", "status"] });
  if (!tenant || !isActiveTenantStatus(tenant.status)) {
    throw publicDeviceNotFound();
  }
  return runForTenant(row.tenantId, () => readInTenant(row));
};
