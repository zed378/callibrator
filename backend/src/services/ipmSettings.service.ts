/**
 * P21-04 — the tenant settings the IPM aggregate reads (P19-02 spec § 4.3, § 11; P19-06 spec § 7.3;
 * ADR-126 Amendment 5): written by a tenant administrator through `PATCH /tenants/settings`
 * (constants/tenantAdminSettings), read here for every caller.
 *
 *  - `tenant_time_zone` — the IANA zone of report numbers' day and "due"'s month; unset or unknown =
 *    `Asia/Jakarta`;
 *  - `ipm_interval_months` — the tenant's IPM interval (1 – 60); unset = not scheduled;
 *  - `ipm_countersign_enabled` — the electronic IPSRS countersignature (UD-17); unset = off;
 *  - `ipm_recommendation_side_effects` — the recommendation's side effects of UD-17 (Repair work
 *    order, device status, calibration request); unset = ON. The switch is how the working
 *    decision is reversed per tenant without a deploy.
 *
 * `tenant_settings` has no facility column, so a facility-bound principal's read is DENIED by the
 * hooks (provider-internal, ADR-124): the one read here is a reviewed `skipFacilityScope`
 * (FACILITY_SCOPE_SKIPS — P18-03 § 10.2's settings read, G-13). The tenant predicate stays, and
 * only these four keys are read; nothing is returned to the caller but the parsed values.
 *
 * Named exports only.
 */
import type { Transaction } from "sequelize";
import models from "../models";
import { TENANT_ADMIN_INTEGER_SETTINGS } from "../constants/tenantAdminSettings";
import { DEFAULT_TIME_ZONE, isTimeZone } from "@callibrator/contracts/inspectionValues";

/** The keys, as stored. */
export const IPM_SETTING_KEYS = Object.freeze({
  timeZone: "tenant_time_zone",
  intervalMonths: "ipm_interval_months",
  countersignEnabled: "ipm_countersign_enabled",
  sideEffects: "ipm_recommendation_side_effects",
} as const);

/** A tenant's IPM settings, parsed. */
export interface IpmSettings {
  readonly timeZone: string;
  readonly intervalMonths: number | null;
  readonly countersignEnabled: boolean;
  readonly sideEffectsEnabled: boolean;
}

const flag = (raw: string | null | undefined, unset: boolean): boolean => (raw === "true" ? true : raw === "false" ? false : unset);

/**
 * The tenant's IPM settings (one read).
 *
 * @param tenantId - the tenant
 * @param options - `{ transaction }`
 * @returns the parsed settings, defaults filled in
 */
export const ipmSettingsOf = async (tenantId: string, { transaction }: { transaction?: Transaction } = {}): Promise<IpmSettings> => {
  const rows = await models.TenantSettings.findAll({
    where: { tenantId, key: Object.values(IPM_SETTING_KEYS) },
    attributes: ["key", "value"],
    // skipFacilityScope: tenant policy for a bound technician's submit, report and signature (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
    ...(transaction ? { transaction } : {}),
  });
  const value = new Map(rows.map((r) => [r.key, r.value]));
  const zone = value.get(IPM_SETTING_KEYS.timeZone);
  const interval = Number(value.get(IPM_SETTING_KEYS.intervalMonths) ?? "");
  const range = TENANT_ADMIN_INTEGER_SETTINGS.ipm_interval_months;
  return {
    timeZone: zone && isTimeZone(zone) ? zone : DEFAULT_TIME_ZONE,
    intervalMonths: Number.isInteger(interval) && interval >= range.min && interval <= range.max ? interval : null,
    countersignEnabled: flag(value.get(IPM_SETTING_KEYS.countersignEnabled), false),
    sideEffectsEnabled: flag(value.get(IPM_SETTING_KEYS.sideEffects), true),
  };
};
