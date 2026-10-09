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

// ------------------------------------------------------------------
// P21-02a: the QR code's normalisation (ADR-132 § 1; spec P19-03 § 4.2), the field working set
// (P19-08 § 7.2) and the register's conflict codes. P21-05: the next due date and "calibration
// due" (ADR-133 § 1, § 4; spec P19-05 § 5, § 6). Pure: shared by the backend, the PWA and the ETL.
// ------------------------------------------------------------------

/** A tenant's QR prefix (`device_qr_code_prefix`): 1 to 8 upper-case letters; unset = no padding. */
export const QR_CODE_PREFIX_PATTERN = "^[A-Z]{1,8}$";
/** A bare number is zero-padded to this many digits (`device_qr_code_digits`, 4 to 12). */
export const QR_CODE_DIGITS_DEFAULT = 6;
export const QR_CODE_DIGITS_MIN = 4;
export const QR_CODE_DIGITS_MAX = 12;

/** A tenant's QR settings, as `normaliseQrCode` reads them. */
export interface QrCodeSettings {
  /** The prefix a bare number is given; null = a bare number is kept as typed. */
  readonly prefix: string | null;
  /** The digits a bare number is padded to. */
  readonly digits: number;
}

/** What `normaliseQrCode` answers: the normalised value, or the 400's message. */
export type QrCodeNormalised = { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

const QR_RE = new RegExp(QR_CODE_PATTERN);

/**
 * The ONE spelling of a sticker (spec § 4.2): inner and outer whitespace removed, upper case; a
 * bare number given the tenant's prefix and zero-padded to its digits. Idempotent:
 * `normalise(normalise(x)) = normalise(x)` (a padded value is no longer only digits).
 *
 * @param input - what was scanned, typed or imported
 * @param settings - the tenant's prefix and digits
 * @returns the value, or the message of the 400
 */
export const normaliseQrCode = (input: string, settings: QrCodeSettings): QrCodeNormalised => {
  let value = input.replace(/\s+/g, "").toUpperCase();
  if (settings.prefix !== null && /^[0-9]+$/.test(value)) {
    if (value.length > settings.digits) {
      return { ok: false, message: `This QR number is longer than ${String(settings.digits)} digits.` };
    }
    value = settings.prefix + value.padStart(settings.digits, "0");
  }
  return QR_RE.test(value) ? { ok: true, value } : { ok: false, message: "A QR code holds 3 to 32 letters, digits or hyphens." };
};

/** The register's and the quick entry's conflict codes (the answer's top-level `code`). */
export const DEVICE_CONFLICT_CODES = Object.freeze({
  qrTaken: "DEVICE_QR_TAKEN",
  facilityEnded: "DEVICE_FACILITY_ENDED",
  retired: "CALIBRATION_DEVICE_RETIRED",
  calibrationFacilityEnded: "CALIBRATION_FACILITY_ENDED",
  workingSetTooLarge: "FIELD_WORKING_SET_TOO_LARGE",
} as const);

/** The field working set's cap (P19-08 § 7.2; tenant setting `field_working_set_max_devices`, 1 to 5,000). */
export const FIELD_WORKING_SET_DEFAULT_MAX = 2000;
export const FIELD_WORKING_SET_LIMIT_MAX = 5000;

/** `GET /calibration-devices?view=field`: the keys of one `fieldDeviceSummary` row, in order (P19-08 § 7.2, G-O7). */
export const FIELD_DEVICE_SUMMARY_KEYS = Object.freeze([
  "id",
  "clientFacilityId",
  "name",
  "manufacturer",
  "model",
  "serialNumber",
  "qrCode",
  "deviceTypeId",
  "status",
  "condition",
  "locationId",
  "ipmIntervalMonths",
  "ipmDue",
  "lastIpm",
  "calibrationDue",
  "photosComplete",
  "openIpmDraftId",
  "updatedAt",
] as const);
export type FieldDeviceSummaryKey = (typeof FIELD_DEVICE_SUMMARY_KEYS)[number];

const DAY_MS = 86_400_000;

/** The device's next date, as `deriveNextCalibrationDate` reads and answers it. */
export interface NextCalibrationDate {
  readonly date: Date | null;
  readonly source: NextCalibrationDateSource | null;
}

/** What the derivation reads (spec P19-05 § 5). */
export interface NextCalibrationDateInput {
  /** The device's date and its source now. */
  readonly current: NextCalibrationDate;
  /** `calibration_interval_days`, or null. */
  readonly intervalDays: number | null;
  /** The device's latest EFFECTIVE record (not voided, not superseded; by date, then creation, then id), or null. */
  readonly latest: { readonly calibrationDate: Date; readonly dueDate: Date | null } | null;
}

/**
 * The next due date from the latest effective record (ADR-133 § 1; spec P19-05 § 5, G-C1 / G-C2):
 *  1. no effective record: a `record` date (its record voided or corrected away) becomes NULL; a
 *     `manual` one is kept;
 *  2. the record's stated `dueDate` wins;
 *  3. else its date + the device's interval;
 *  4. else unchanged (a device with no interval and no stated date keeps its date).
 *
 * @param input - the device now, its interval, its latest effective record
 * @returns the date and source to store
 */
export const deriveNextCalibrationDate = (input: NextCalibrationDateInput): NextCalibrationDate => {
  const { current, intervalDays, latest } = input;
  if (latest === null) {
    return current.source === "record" ? { date: null, source: null } : current;
  }
  if (latest.dueDate !== null) {
    return { date: latest.dueDate, source: "record" };
  }
  if (intervalDays !== null && intervalDays > 0) {
    return { date: new Date(latest.calibrationDate.getTime() + intervalDays * DAY_MS), source: "record" };
  }
  return current;
};

/** The states "calibration due" answers (spec P19-05 § 6). */
export const CALIBRATION_DUE_STATES = Object.freeze(["not_scheduled", "requested", "overdue", "due_soon", "ok"] as const);
export type CalibrationDueState = (typeof CALIBRATION_DUE_STATES)[number];
/** The states the device list filters on (`?calibrationDue=`). */
export const CALIBRATION_DUE_FILTERS = Object.freeze(["overdue", "due_soon", "requested"] as const);
export type CalibrationDueFilter = (typeof CALIBRATION_DUE_FILTERS)[number];

/** The tenant setting `calibration_due_soon_days` (1 to 365); unset = 30. */
export const CALIBRATION_DUE_SOON_DAYS_DEFAULT = 30;

/** What `computeCalibrationDue` reads of one device. */
export interface CalibrationDueInput {
  readonly status: string | null;
  readonly deleted?: boolean | undefined;
  readonly nextCalibrationDate: Date | null;
  readonly source: NextCalibrationDateSource | null;
  readonly requestedAt: Date | null;
  readonly requestedBySessionId: string | null;
  readonly today: Date;
  readonly timeZone: string;
  readonly dueSoonDays: number;
}

/** "Calibration due", as every reader shows it. */
export interface CalibrationDue {
  readonly state: CalibrationDueState;
  /** `YYYY-MM-DD` in the tenant's zone, or null. */
  readonly nextCalibrationDate: string | null;
  readonly source: NextCalibrationDateSource | null;
  readonly requestedBySessionId: string | null;
}

const zonedParts = (at: Date, timeZone: string): Readonly<Record<string, number>> => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  return Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
};

/** A day of the tenant's zone: its day number (days since 1970-01-01) and `YYYY-MM-DD`. */
export const zonedDayNumber = (at: Date, timeZone: string): { readonly n: number; readonly text: string } => {
  const p = zonedParts(at, timeZone);
  const [y, m, d] = [p["year"] as number, p["month"] as number, p["day"] as number];
  return { n: Date.UTC(y, m - 1, d) / DAY_MS, text: `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
};

/**
 * The instant at which day number `n` begins in `timeZone` (its 00:00): UTC midnight less the
 * zone's offset at that moment.
 *
 * @param n - a day number (days since 1970-01-01)
 * @param timeZone - an IANA zone
 * @returns the instant
 */
export const zonedDayStart = (n: number, timeZone: string): Date => {
  const utc = n * DAY_MS;
  const p = zonedParts(new Date(utc), timeZone);
  const wall = Date.UTC(p["year"] as number, (p["month"] as number) - 1, p["day"], p["hour"], p["minute"], p["second"]);
  return new Date(utc - (wall - utc));
};

/**
 * "Calibration due" (ADR-133 § 4; spec P19-05 § 6): computed at read, in the tenant's zone. A
 * retired, inactive or deleted device is not scheduled; an IPM's request wins over the date.
 *
 * @param input - the device, today, the tenant's zone and "due soon" window
 * @returns the state and the date it was computed from
 */
export const computeCalibrationDue = (input: CalibrationDueInput): CalibrationDue => {
  const next = input.nextCalibrationDate ? zonedDayNumber(input.nextCalibrationDate, input.timeZone) : null;
  const base = { nextCalibrationDate: next?.text ?? null, source: input.source, requestedBySessionId: input.requestedBySessionId };
  if (input.deleted === true || input.status === "retired" || input.status === "inactive") {
    return { ...base, state: "not_scheduled" };
  }
  if (input.requestedAt !== null) {
    return { ...base, state: "requested" };
  }
  if (next === null) {
    return { ...base, state: "not_scheduled" };
  }
  const today = zonedDayNumber(input.today, input.timeZone).n;
  const state: CalibrationDueState = next.n < today ? "overdue" : next.n <= today + input.dueSoonDays ? "due_soon" : "ok";
  return { ...base, state };
};

/**
 * The `next_calibration_date` window one `?calibrationDue=` filter selects, the same days as
 * `computeCalibrationDue`: overdue = before `todayStart`; due soon = from `todayStart`, before
 * `soonEnd` (the start of the day after today + `dueSoonDays`).
 *
 * @param today - now
 * @param timeZone - the tenant's zone
 * @param dueSoonDays - the "due soon" window
 * @returns the two instants
 */
export const calibrationDueWindow = (today: Date, timeZone: string, dueSoonDays: number): { readonly todayStart: Date; readonly soonEnd: Date } => {
  const n = zonedDayNumber(today, timeZone).n;
  return { todayStart: zonedDayStart(n, timeZone), soonEnd: zonedDayStart(n + dueSoonDays + 1, timeZone) };
};
