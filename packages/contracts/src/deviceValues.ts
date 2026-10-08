/**
 * P20-02 / P20-08 (ADR-132, ADR-133; specs MEMORY/specs/P19-03-device-extensions.md § 4, § 6,
 * § 7.1 and MEMORY/specs/P19-05-calibration-dates.md § 4) — the device register's and the
 * calibration dates' vocabularies. Built 2026-10-09 with the columns they type (migrations 0128,
 * 0129).
 *
 * Each vocabulary is a frozen tuple in its database ENUM's (or CHECK's) order — the order `sync`
 * and the migrations create each type in, so it is part of the schema — and the union derived
 * from it (the `inspectionValues.ts` pattern). enumMirrors.d26 holds the models' ENUMs to these.
 */

/** A device's physical condition (spec § 4.4; upstream Baik / Laik → good, Tidak Baik → not_good, Rusak → broken). */
export const DEVICE_CONDITIONS = Object.freeze(["good", "not_good", "broken"] as const);
export type DeviceCondition = (typeof DEVICE_CONDITIONS)[number];

/** Who set the condition (spec § 4.1): at registration, by a later edit, or by the import. */
export const DEVICE_CONDITION_SOURCES = Object.freeze(["registration", "manual", "import"] as const);
export type DeviceConditionSource = (typeof DEVICE_CONDITION_SOURCES)[number];

/** A warehouse row is a provider's store or a facility's room (UD-10; spec § 6.1). `store` is the default. */
export const WAREHOUSE_KINDS = Object.freeze(["store", "room"] as const);
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];

/** How a calibration was recorded (P19-05 § 4.1): the full form, or an outside lab's date and key data. */
export const CALIBRATION_ENTRY_KINDS = Object.freeze(["full_record", "external_date"] as const);
export type CalibrationEntryKind = (typeof CALIBRATION_ENTRY_KINDS)[number];

/** Where a device's next calibration date came from (P19-05 § 4.2): set by hand, or derived from a record. */
export const NEXT_CALIBRATION_DATE_SOURCES = Object.freeze(["manual", "record"] as const);
export type NextCalibrationDateSource = (typeof NEXT_CALIBRATION_DATE_SOURCES)[number];

/** What a photo of a device or an IPM session shows (spec § 7.1; the CHECK of migration 0129). */
export const ATTACHMENT_PURPOSES = Object.freeze(["device_front", "device_serial_plate", "device_other", "ipm_evidence"] as const);
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

/** The purposes a device holds at most ONE live photo of (the partial unique index of migration 0129). */
export const SINGLE_DEVICE_PHOTO_PURPOSES = Object.freeze(["device_front", "device_serial_plate"] as const);

/**
 * A normalised QR code (spec § 4.2 step 3): 3 – 32 upper-case letters, digits or hyphens, not
 * starting with a hyphen. The source of a RegExp and of migration 0128's CHECK, so the database
 * refuses what `normaliseQrCode` (P21-02) would never produce.
 */
export const QR_CODE_PATTERN = "^[A-Z0-9][A-Z0-9-]{2,31}$";

/** The IPM interval in months (ADR-126 § 6; P19-02 § 11): 0 = not under IPM, NULL = the tenant setting. */
export const IPM_INTERVAL_MONTHS_MAX = 60;

/** The earliest inventory date accepted (spec § 4.1: the CHECK `inventoried_on >= '1990-01-01'`). */
export const INVENTORIED_ON_MIN = "1990-01-01";
