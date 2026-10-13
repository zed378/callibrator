/**
 * The public device page (P21-08; ADR-138 and Am. 1; spec MEMORY/specs/P19-07-public-device-page.md).
 *
 *  - The capability token: 16 CSPRNG bytes, base64url — 22 characters (§ 4). Only its SHA-256 is
 *    stored; the backend never accepts one from a body.
 *  - The per-tenant setting `public_device_page` (§ 9): `off` (the default, and what any other stored
 *    value reads as), `minimal`, `minimal_with_report`.
 *  - The public calibration status (Am. 1 § 4), mapped from the house "calibration due" state.
 *  - The machine codes of the staff routes' refusals and the public route's one 404.
 *
 * Named exports only.
 */
import { z } from "zod";
import type { CalibrationDueState } from "./deviceValues";
import { personDisplay } from "./people";

/** The token's shape (§ 4): exactly 22 base64url characters. */
export const PUBLIC_DEVICE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The `tenant_settings` key of the page's switch. */
export const PUBLIC_DEVICE_PAGE_SETTING_KEY = "public_device_page";

/** The setting's values, the default first. */
export const PUBLIC_DEVICE_PAGE_MODES = Object.freeze(["off", "minimal", "minimal_with_report"] as const);
export type PublicDevicePageMode = (typeof PUBLIC_DEVICE_PAGE_MODES)[number];

/**
 * A stored setting value, read fail-closed: unset or anything not a mode is `off`.
 *
 * @param raw - the stored value
 * @returns the mode
 */
export const parsePublicDevicePageMode = (raw: string | null | undefined): PublicDevicePageMode =>
  PUBLIC_DEVICE_PAGE_MODES.find((mode) => mode === raw) ?? "off";

/** The status the public page shows (Am. 1 § 4). */
export const PUBLIC_CALIBRATION_STATUSES = Object.freeze(["current", "due_soon", "overdue", "retired", "not_scheduled"] as const);
export type PublicCalibrationStatus = (typeof PUBLIC_CALIBRATION_STATUSES)[number];

/**
 * The public status of a device: `retired` from the device's own status; otherwise the house
 * "calibration due" state, with an IPM's calibration request reading `due_soon`.
 *
 * @param deviceStatus - the device's `status`
 * @param due - its "calibration due" state
 * @returns the public status
 */
export const publicCalibrationStatus = (deviceStatus: string | null, due: CalibrationDueState): PublicCalibrationStatus => {
  if (deviceStatus === "retired") {
    return "retired";
  }
  switch (due) {
    case "ok":
      return "current";
    case "due_soon":
    case "requested":
      return "due_soon";
    case "overdue":
      return "overdue";
    case "not_scheduled":
      return "not_scheduled";
  }
};

/** Why a link stopped working (migration 0137's CHECK; spec § 5). */
export const PUBLIC_DEVICE_TOKEN_REVOKED_REASONS = Object.freeze(["rotated", "revoked", "device_deleted"] as const);
export type PublicDeviceTokenRevokedReason = (typeof PUBLIC_DEVICE_TOKEN_REVOKED_REASONS)[number];

/** The machine codes (top-level `code` of the error envelope). */
export const PUBLIC_DEVICE_CODES = Object.freeze({
  /** The public route's one answer for every failure (§ 7). */
  notFound: "PUBLIC_DEVICE_NOT_FOUND",
  /** Issue while a token is active. */
  tokenActive: "PUBLIC_TOKEN_ACTIVE",
  /** Rotate or revoke while none is. */
  tokenNone: "PUBLIC_TOKEN_NONE",
} as const);

/** The public route's one 404 message (§ 7). */
export const PUBLIC_DEVICE_NOT_FOUND_MESSAGE = "No device answers to this link.";

/**
 * `GET /public/devices/:token` — a plain string, bounded only by what a URL path carries: a malformed
 * token (any length, any character) answers the same 404 as an unknown one, never a 400.
 */
export const publicDeviceParams = z.strictObject({
  token: z.string().max(2048),
});
export type PublicDeviceParams = z.output<typeof publicDeviceParams>;

/** The staff routes' path: `/calibration-devices/:calibrationDeviceId/public-token`. */
export const publicDeviceTokenParams = z.strictObject({
  calibrationDeviceId: z.uuid(),
});
export type PublicDeviceTokenParams = z.output<typeof publicDeviceTokenParams>;

/** The public page's data (§ 8) — an allow-list: nothing else is ever sent. */
export const publicDeviceView = z.strictObject({
  device: z.strictObject({
    name: z.string(),
    type: z.string().nullable(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
  }),
  facility: z.strictObject({ name: z.string() }),
  calibration: z.strictObject({
    status: z.enum(PUBLIC_CALIBRATION_STATUSES),
    nextDueDate: z.string().nullable(),
  }),
  lastIpmDate: z.string().nullable(),
  report: z.strictObject({ verifyUrl: z.string() }).nullable(),
});
export type PublicDeviceView = z.output<typeof publicDeviceView>;

/** A freshly issued token (issue and rotate): the only time it is ever shown. */
export const publicDeviceTokenIssued = z.strictObject({
  token: z.string(),
  url: z.string(),
  issuedAt: z.string(),
});
export type PublicDeviceTokenIssued = z.output<typeof publicDeviceTokenIssued>;

/** The link's state for staff — never the token or its hash. */
export const publicDeviceTokenState = z.strictObject({
  active: z.boolean(),
  issuedAt: z.string().nullable(),
  issuedBy: personDisplay.nullable(),
  lastRevokedAt: z.string().nullable(),
  setting: z.enum(PUBLIC_DEVICE_PAGE_MODES),
});
export type PublicDeviceTokenState = z.output<typeof publicDeviceTokenState>;
