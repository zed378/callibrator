/**
 * P21-02a / P21-05: the tenant settings the device register and its calibration dates read
 * (ADR-132 § 1, ADR-133 § 4; specs P19-03 § 4.2, P19-05 § 6, P19-08 § 7.2). Written by a tenant
 * administrator through `PATCH /tenants/settings` (constants/tenantAdminSettings), read here for
 * every caller:
 *
 *  - `device_qr_code_prefix`: the prefix a bare sticker number is given (1 to 8 letters); unset =
 *    a bare number is kept as typed;
 *  - `device_qr_code_digits`: the digits it is padded to (4 to 12); unset = 6;
 *  - `field_working_set_max_devices`: the PWA working set's cap (1 to 5,000); unset = 2,000;
 *  - `calibration_due_soon_days`: "due soon"'s window (1 to 365); unset = 30;
 *  - `tenant_time_zone` (P21-04): the zone of every day.
 *
 * `tenant_settings` has no facility column, so a facility-bound principal's read is DENIED by the
 * hooks (provider-internal, ADR-124): the one read here is a reviewed `skipFacilityScope`
 * (FACILITY_SCOPE_SKIPS; the settings read of P18-03 § 10.2). The tenant predicate stays, only
 * these keys are read, and only the parsed values leave this module.
 *
 * Named exports only.
 */
import type { Transaction } from "sequelize";
import models from "../models";
import { TENANT_ADMIN_INTEGER_SETTINGS } from "../constants/tenantAdminSettings";
import { DEFAULT_TIME_ZONE, isTimeZone } from "@callibrator/contracts/inspectionValues";
import {
  CALIBRATION_DUE_SOON_DAYS_DEFAULT,
  FIELD_WORKING_SET_DEFAULT_MAX,
  QR_CODE_DIGITS_DEFAULT,
  QR_CODE_PREFIX_PATTERN,
  type QrCodeSettings,
} from "@callibrator/contracts/deviceValues";

/** The keys, as stored. */
export const DEVICE_SETTING_KEYS = Object.freeze({
  qrPrefix: "device_qr_code_prefix",
  qrDigits: "device_qr_code_digits",
  workingSetMax: "field_working_set_max_devices",
  dueSoonDays: "calibration_due_soon_days",
  timeZone: "tenant_time_zone",
} as const);

/** A tenant's device settings, parsed, defaults filled in. */
export interface DeviceSettings {
  readonly qr: QrCodeSettings;
  readonly workingSetMax: number;
  readonly dueSoonDays: number;
  readonly timeZone: string;
}

const PREFIX = new RegExp(QR_CODE_PREFIX_PATTERN);

/** An integer setting in its allow-list range, else the default. */
const inRange = (raw: string | undefined, key: keyof typeof TENANT_ADMIN_INTEGER_SETTINGS, unset: number): number => {
  const n = Number(raw ?? "");
  const range = TENANT_ADMIN_INTEGER_SETTINGS[key];
  return raw !== undefined && raw !== "" && Number.isInteger(n) && n >= range.min && n <= range.max ? n : unset;
};

/**
 * The tenant's device settings (one read).
 *
 * @param tenantId - the tenant
 * @param options - `{ transaction }`
 * @returns the parsed settings
 */
export const deviceSettingsOf = async (tenantId: string, { transaction }: { transaction?: Transaction } = {}): Promise<DeviceSettings> => {
  const rows = await models.TenantSettings.findAll({
    where: { tenantId, key: Object.values(DEVICE_SETTING_KEYS) },
    attributes: ["key", "value"],
    // skipFacilityScope: tenant policy for a bound technician's register reads and writes (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
    ...(transaction ? { transaction } : {}),
  });
  const value = new Map(rows.map((r) => [r.key, r.value ?? undefined]));
  const prefix = value.get(DEVICE_SETTING_KEYS.qrPrefix);
  const zone = value.get(DEVICE_SETTING_KEYS.timeZone);
  return {
    qr: {
      prefix: prefix !== undefined && PREFIX.test(prefix) ? prefix : null,
      digits: inRange(value.get(DEVICE_SETTING_KEYS.qrDigits), DEVICE_SETTING_KEYS.qrDigits, QR_CODE_DIGITS_DEFAULT),
    },
    workingSetMax: inRange(value.get(DEVICE_SETTING_KEYS.workingSetMax), DEVICE_SETTING_KEYS.workingSetMax, FIELD_WORKING_SET_DEFAULT_MAX),
    dueSoonDays: inRange(value.get(DEVICE_SETTING_KEYS.dueSoonDays), DEVICE_SETTING_KEYS.dueSoonDays, CALIBRATION_DUE_SOON_DAYS_DEFAULT),
    timeZone: zone !== undefined && isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
  };
};
