/**
 * M-18 (found by P26-01, `docs/UPSTREAM/12-UAT-PLAN-ID.md` § 9 C-1) — the four tenant settings of the
 * upstream adoption that had no screen, as plain data: read from `POST /tenants/settings`, checked
 * by the rules `PATCH /tenants/settings` applies (`backend/src/constants/tenantAdminSettings.ts`,
 * `services/tenant.service.ts#assertTenantAdminSettings`), and written as the changed keys only.
 *
 *  - `public_device_page` — `off` (unset) / `minimal` / `minimal_with_report` (ADR-138 § 5; the
 *    contract's `PUBLIC_DEVICE_PAGE_MODES`);
 *  - `ipm_countersign_enabled` — the IPSRS's electronic countersignature (UD-17), unset = off;
 *  - `ipm_interval_months` — a whole number 1 … 60 (`IPM_INTERVAL_MONTHS_MAX`), blank = not scheduled;
 *  - `tenant_time_zone` — an IANA zone the runtime knows (`isTimeZone`), blank = Asia/Jakarta.
 *
 * A cleared value is sent as "" (the server clears the key). The server re-checks every value; its
 * 400 is shown as written.
 */
import { PUBLIC_DEVICE_PAGE_MODES } from "@callibrator/contracts/publicDevices";
import { IPM_INTERVAL_MONTHS_MAX } from "@callibrator/contracts/deviceValues";
import { DEFAULT_TIME_ZONE, isTimeZone } from "@callibrator/contracts/inspectionValues";

export const IPM_SETTING_KEYS = Object.freeze({
  publicPage: "public_device_page",
  countersign: "ipm_countersign_enabled",
  interval: "ipm_interval_months",
  timeZone: "tenant_time_zone",
} as const);

export type PublicPageMode = (typeof PUBLIC_DEVICE_PAGE_MODES)[number];
export { PUBLIC_DEVICE_PAGE_MODES, DEFAULT_TIME_ZONE };

/** The tenant setting's lower bound (`TENANT_ADMIN_INTEGER_SETTINGS.ipm_interval_months`). */
export const IPM_INTERVAL_MIN = 1;
export const IPM_INTERVAL_MAX = IPM_INTERVAL_MONTHS_MAX;

/** Indonesia's three zones, offered first (any IANA zone is accepted). */
export const SUGGESTED_TIME_ZONES = Object.freeze(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const);

/** The form's values: the interval and the zone as typed. */
export interface IpmSettingsForm {
  publicPage: PublicPageMode;
  countersign: boolean;
  interval: string;
  timeZone: string;
}

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** The form from the stored settings (an unknown or unset mode reads as `off`). */
export const formOf = (settings: Record<string, unknown>): IpmSettingsForm => {
  const mode = text(settings[IPM_SETTING_KEYS.publicPage]);
  return {
    publicPage: (PUBLIC_DEVICE_PAGE_MODES as readonly string[]).includes(mode) ? (mode as PublicPageMode) : "off",
    countersign: text(settings[IPM_SETTING_KEYS.countersign]).toLowerCase() === "true",
    interval: text(settings[IPM_SETTING_KEYS.interval]),
    timeZone: text(settings[IPM_SETTING_KEYS.timeZone]),
  };
};

export type IpmSettingsProblem = "interval" | "timeZone";

/** The fields that break the server's rules (checked before any request). */
export const problemsOf = (form: IpmSettingsForm): IpmSettingsProblem[] => {
  const out: IpmSettingsProblem[] = [];
  const interval = form.interval.trim();
  if (interval !== "") {
    const n = Number(interval);
    if (!/^\d+$/.test(interval) || !Number.isInteger(n) || n < IPM_INTERVAL_MIN || n > IPM_INTERVAL_MAX) out.push("interval");
  }
  const zone = form.timeZone.trim();
  if (zone !== "" && !isTimeZone(zone)) out.push("timeZone");
  return out;
};

/** The body's `settings`: only the keys whose value changed; a cleared one as "". */
export const changesOf = (before: IpmSettingsForm, after: IpmSettingsForm): Record<string, string> => {
  const out: Record<string, string> = {};
  if (after.publicPage !== before.publicPage) out[IPM_SETTING_KEYS.publicPage] = after.publicPage === "off" ? "" : after.publicPage;
  if (after.countersign !== before.countersign) out[IPM_SETTING_KEYS.countersign] = after.countersign ? "true" : "false";
  if (after.interval.trim() !== before.interval.trim()) out[IPM_SETTING_KEYS.interval] = after.interval.trim();
  if (after.timeZone.trim() !== before.timeZone.trim()) out[IPM_SETTING_KEYS.timeZone] = after.timeZone.trim();
  return out;
};
