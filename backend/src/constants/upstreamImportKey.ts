/**
 * P24-04 (ADR-133 § 6, Am. 4; spec MEMORY/specs/P19-05-calibration-dates.md § 9.2) — the per-tenant
 * upstream import key's fixed terms.
 *
 * Kept apart from the service so that `apiKey.service` can refuse the reserved name without
 * loading the import's module (which itself uses `apiKey.service` to revoke the key).
 */

/** The import key's name: reserved — the key route refuses it, only the import provisions it. */
export const IMPORT_KEY_NAME = "upstream-import";

/** Its only scope: it records calibration dates and nothing else (§ 9.2). */
export const IMPORT_KEY_SCOPES = Object.freeze(["calibration:write"] as const);

/** It expires this many days after the planned sign-off (UD-18 (a)'s window). */
export const IMPORT_KEY_GRACE_DAYS = 90;

/**
 * Whether a key name is the reserved one (compared trimmed and lower-cased).
 *
 * @param name - a key name as given
 * @returns true for `upstream-import` in any case or padding
 */
export const isReservedImportKeyName = (name: string): boolean => name.trim().toLowerCase() === IMPORT_KEY_NAME;
