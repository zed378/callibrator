/**
 * P21-02b (ADR-132 Am. 3; docs/UPSTREAM/08-FILE-POLICY.md § 4.1, § 7): where a device photo's
 * derivatives live — beside the original, the extension replaced:
 *
 *   t/<tenant>/f/<facility>/attachments/<uuid>.jpg            the original
 *   t/<tenant>/f/<facility>/attachments/<uuid>.display.jpg    longest side 1,600 px, no metadata
 *   t/<tenant>/f/<facility>/attachments/<uuid>.thumb.jpg      320 px, no metadata
 *
 * Derived from the row's key, never stored, so every path that moves or removes the original
 * (the delete, the deleted-file sweep, the device move's re-key) moves or removes the derivatives
 * with it, and the storage usage counts them (they are objects under the same prefix).
 *
 * Named exports only.
 */
import { DEVICE_PHOTO_PURPOSES } from "@callibrator/contracts/deviceValues";

/** The derivative variants, in the order they are written. */
export const DERIVATIVE_VARIANTS = Object.freeze(["display", "thumb"] as const);
export type DerivativeVariant = (typeof DERIVATIVE_VARIANTS)[number];

const PHOTO_PURPOSES: readonly string[] = DEVICE_PHOTO_PURPOSES;

/** Whether a row with this purpose has derivatives (a device photo; nothing else is derived). */
export const hasDerivatives = (purpose: string | null | undefined): boolean =>
  typeof purpose === "string" && PHOTO_PURPOSES.includes(purpose);

/** The key of one derivative of the original at `storageKey`. */
export const derivativeKeyOf = (storageKey: string, variant: DerivativeVariant): string =>
  `${storageKey.replace(/\.[A-Za-z0-9]+$/, "")}.${variant}.jpg`;

/** Both derivative keys of the original at `storageKey`. */
export const derivativeKeysOf = (storageKey: string): string[] =>
  DERIVATIVE_VARIANTS.map((variant) => derivativeKeyOf(storageKey, variant));
