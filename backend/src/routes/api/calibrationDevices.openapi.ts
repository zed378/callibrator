/**
 * P9-20 / P9-25 (ADR-103) — the contract of `calibrationDevices.route.ts`,
 * code-first. Every route carries `auth` and a `dynamicAccess` gate on the
 * `calibration` resource; restore and reinstate also require a tenant
 * administrator (`rbac`). The query, params and bodies are the schemas the
 * CONTROLLER validates (`validators/calibrationDevices.validator` →
 * `@callibrator/contracts/calibrationDevices`); reinstate's body is checked by
 * its service against `reinstateCalibrationDeviceSchema`. The response is the
 * model row as JSON (the IoT token hash is never sent, A-29).
 * Examples are synthetic.
 */
import { z } from "zod";
import { DEVICE_STATUSES } from "@callibrator/contracts/calibrationDevices";
import {
  calibrationDeviceIdSchema,
  createCalibrationDeviceSchema,
  getCalibrationDevicesQuery,
  updateCalibrationDeviceSchema,
} from "../../validators/calibrationDevices.validator";
import { reinstateCalibrationDeviceSchema } from "../../validators/calibrationDeviceReinstate.validator";
import { deviceMove, DEVICE_MOVE_COUNT_KEYS } from "@callibrator/contracts/clientFacilities";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { deviceIpmSessionsQuery } from "@callibrator/contracts/inspectionSessions";
import { deviceQrParams, devicePhotoParams, devicePhotoUpload } from "@callibrator/contracts/calibrationDevices";
import { DEVICE_PHOTO_CODES, DEVICE_PHOTO_PURPOSES } from "@callibrator/contracts/deviceValues";
import { calibrationDateEntry } from "@callibrator/contracts/calibrationRecords";
import {
  CALIBRATION_DUE_STATES,
  CALIBRATION_ENTRY_KINDS,
  DEVICE_CONDITIONS,
  FIELD_DEVICE_SUMMARY_KEYS,
  NEXT_CALIBRATION_DATE_SOURCES,
  WAREHOUSE_KINDS,
} from "@callibrator/contracts/deviceValues";
import { IpmSessionSummary } from "../../docs/openapi/ipmSessionSchemas";

const timestamp = z.iso.datetime();

/** A calibration device as the API answers it (the model row's JSON). */
const CalibrationDevice = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    name: z.string(),
    serialNumber: z.string().nullable(),
    manufacturer: z.string().nullable(),
    model: z.string().nullable(),
    category: z.string().nullable(),
    // The column's ENUM (calibrationDevice.model; the contracts' DEVICE_STATUSES are the same four).
    status: z.enum(DEVICE_STATUSES).nullable(),
    locationId: z.guid().nullable(),
    installationDate: timestamp.nullable(),
    nextCalibrationDate: timestamp.nullable(),
    calibrationIntervalDays: z.number().int().nullable(),
    remarks: z.string().nullable(),
    iotEnabled: z.boolean(),
    isDeleted: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    // warehouses.code is NOT NULL (warehouse.model). P21-02a: a room's floor and the kind; NULL for a
    // bound reader when the location is a provider store.
    warehouse: z.object({ id: z.guid(), name: z.string(), code: z.string(), floor: z.string().nullable().optional(), kind: z.enum(WAREHOUSE_KINDS).optional() }).nullable().optional(),
    // P21-02a (P19-03 § 8.3): the register's fields and the read's facts.
    qrCode: z.string().nullable().optional(),
    deviceTypeId: z.guid().nullable().optional(),
    deviceType: z.object({ id: z.guid(), name: z.string() }).nullable().optional(),
    clientFacilityId: z.guid().optional(),
    clientFacility: z.object({ id: z.guid(), name: z.string(), code: z.string().nullable() }).nullable().optional(),
    inventoriedOn: z.iso.date().nullable().optional(),
    accessoriesComplete: z.boolean().nullable().optional(),
    condition: z.enum(DEVICE_CONDITIONS).nullable().optional(),
    conditionChangedAt: timestamp.nullable().optional(),
    ipmIntervalMonths: z.number().int().nullable().optional(),
    nextCalibrationDateSource: z.enum(NEXT_CALIBRATION_DATE_SOURCES).nullable().optional(),
    calibrationRequestedAt: timestamp.nullable().optional(),
    calibrationRequestedBySessionId: z.guid().nullable().optional(),
    calibrationVendorId: z.guid().nullable().optional().meta({ description: "Provider staff only; a facility reader gets `calibrationVendorDisplay`." }),
    calibrationVendorDisplay: z.object({ name: z.string() }).nullable().optional(),
    registrantDisplay: z.object({ name: z.string(), role: z.string().nullable(), organisation: z.string().nullable() }).nullable().optional(),
    ipmDue: z.record(z.string(), z.unknown()).optional().meta({ description: "`computeIpmDue` (P19-02 § 11)." }),
    lastIpm: z.object({ performedAt: timestamp, visitNumber: z.number().int().nullable() }).nullable().optional(),
    openIpmDraftId: z.guid().nullable().optional().meta({ description: "The caller's own open IPM draft of the device." }),
    photosComplete: z.boolean().optional(),
    frontPhotoAttachmentId: z.guid().nullable().optional(),
    serialPlatePhotoAttachmentId: z.guid().nullable().optional(),
    calibrationDue: z
      .object({
        state: z.enum(CALIBRATION_DUE_STATES),
        nextCalibrationDate: z.iso.date().nullable(),
        source: z.enum(NEXT_CALIBRATION_DATE_SOURCES).nullable(),
        requestedBySessionId: z.guid().nullable(),
      })
      .optional(),
    lastCalibration: z
      .object({
        recordId: z.guid(),
        date: z.iso.date(),
        entryKind: z.enum(CALIBRATION_ENTRY_KINDS),
        externalLabName: z.string().nullable(),
        performerDisplay: z.record(z.string(), z.unknown()).nullable(),
      })
      .nullable()
      .optional(),
    calibrationRecords: z.array(z.record(z.string(), z.unknown())).optional().meta({ description: "The 10 latest records (detail read only)." }),
  })
  .loose()
  .meta({
    id: "CalibrationDevice",
    description: "An instrument in the tenant's calibration register (ISO 17025 §6.4.13).",
    example: {
      id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      name: "Infusion pump",
      serialNumber: "SN-0001",
      manufacturer: "Example Medical",
      model: "IP-200",
      category: "infusion",
      status: "active",
      locationId: null,
      installationDate: "2029-03-01T00:00:00.000Z",
      nextCalibrationDate: "2030-01-15T00:00:00.000Z",
      calibrationIntervalDays: 365,
      remarks: null,
      iotEnabled: false,
      isDeleted: false,
      createdAt: "2029-03-01T09:00:00.000Z",
      updatedAt: "2029-03-01T09:00:00.000Z",
    },
  });

/** The CSV import's report (`calibrationDevices.service#bulkImportCalibrationDevices`). */
const ImportReport = z
  .object({
    successCount: z.number().int(),
    failedCount: z.number().int(),
    totalCount: z.number().int(),
    // P9-25: ImportRowError — a message (an empty CSV), or the row's field errors.
    errors: z.array(
      z.object({
        row: z.number().int(),
        errors: z.union([z.string(), z.array(z.object({ field: z.string(), message: z.string() }))]),
      }),
    ),
  })
  .meta({
    id: "CalibrationDeviceImportReport",
    description: "What was imported, and why each rejected row was rejected (row numbers count the header as row 1).",
    example: { successCount: 2, failedCount: 1, totalCount: 3, errors: [{ row: 3, errors: [{ field: "serialNumber", message: "Duplicate serial number: SN-0001" }] }] },
  });

/** `:calibrationDeviceId`, the validator's own field (`.meta()` clones it) with a synthetic example. */
const deviceIdParams = z.object({
  calibrationDeviceId: calibrationDeviceIdSchema.shape.calibrationDeviceId.meta({
    description: "The calibration device's id",
    example: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  }),
});

/** `:calibrationDeviceId` + `:attachmentId` (P21-02b), the contract's fields with synthetic examples. */
const photoParams = z.object({
  calibrationDeviceId: devicePhotoParams.shape.calibrationDeviceId.meta({
    description: "The calibration device's id",
    example: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  }),
  attachmentId: devicePhotoParams.shape.attachmentId.meta({
    description: "The photo's attachment id",
    example: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
  }),
});

/** P21-09d: the body of a move (the contract validates params and body together). */
const moveBody = deviceMove.omit({ calibrationDeviceId: true });
const moveCounts = z.object(Object.fromEntries(DEVICE_MOVE_COUNT_KEYS.map((k) => [k, z.number().int()])) as Record<(typeof DEVICE_MOVE_COUNT_KEYS)[number], z.ZodNumber>);
const DeviceMoveResult = z
  .object({
    moveId: z.guid(),
    calibrationDeviceId: z.guid(),
    fromClientFacilityId: z.guid(),
    toClientFacilityId: z.guid(),
    locationId: z.guid().nullable(),
    counts: moveCounts,
  })
  .meta({ id: "DeviceMoveResult" });
const DeviceMove = z
  .object({
    id: z.guid(),
    from: z.object({ id: z.guid(), name: z.string() }),
    to: z.object({ id: z.guid(), name: z.string() }),
    reason: z.string(),
    movedBy: z.guid(),
    counts: z.record(z.string(), z.number().int()),
    createdAt: timestamp,
    completedAt: timestamp,
  })
  .meta({ id: "DeviceMove" });
const UNMARKED_MOVE = "Not facility-accessible: a facility-bound principal is refused 403 `FACILITY_ROUTE_REFUSED` before a parameter is read.";

/** P21-02a (P19-08 § 7.2): one row of `?view=field`, exactly these keys. */
const FieldDeviceSummary = z
  .object(Object.fromEntries(FIELD_DEVICE_SUMMARY_KEYS.map((k) => [k, z.unknown()])) as Record<(typeof FIELD_DEVICE_SUMMARY_KEYS)[number], z.ZodUnknown>)
  .meta({ id: "FieldDeviceSummary", description: "The PWA working set's row: no registrant, vendor, notes, documents or photos." });

/** P21-05: the quick entry's body (the contract validates params and body together). */
const calibrationDateBody = z.object(calibrationDateEntry.shape).omit({ calibrationDeviceId: true });
const ExternalCalibration = z
  .object({
    id: z.guid(),
    deviceId: z.guid(),
    entryKind: z.literal("external_date"),
    calibrationDate: timestamp,
    dueDate: timestamp.nullable(),
    externalLabName: z.string().nullable(),
    device: z.object({ id: z.guid(), nextCalibrationDate: timestamp.nullable(), nextCalibrationDateSource: z.enum(NEXT_CALIBRATION_DATE_SOURCES).nullable(), calibrationRequestedAt: timestamp.nullable() }),
    notices: z.array(z.string()),
  })
  .loose()
  .meta({ id: "ExternalCalibrationRecord" });

/** P21-02b: a device photo as the photo routes answer it — ids and facts, never a key or a file name. */
const DevicePhoto = z
  .object({
    id: z.guid(),
    calibrationDeviceId: z.guid(),
    purpose: z.enum(DEVICE_PHOTO_PURPOSES),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    size: z.number().int(),
    checksum: z.string().meta({ description: "SHA-256 of the stored original (location metadata removed)" }),
    width: z.number().int(),
    height: z.number().int(),
    variants: z.array(z.enum(["original", "display", "thumb"])),
    replacedAttachmentId: z.guid().nullable().meta({ description: "The live photo of the same single purpose this one replaced, if any" }),
    createdAt: timestamp,
  })
  .meta({ id: "DevicePhoto" });
const PHOTO_REFUSALS =
  `415 \`${DEVICE_PHOTO_CODES.heicUnsupported}\` (HEIC/HEIF: convert to JPEG on the client) or \`${DEVICE_PHOTO_CODES.typeUnsupported}\` (not JPEG/PNG by content); ` +
  `422 \`${DEVICE_PHOTO_CODES.undecodable}\`, \`${DEVICE_PHOTO_CODES.imageTooLarge}\` (over 50 megapixels or 12,000 px a side) or \`${DEVICE_PHOTO_CODES.rejectedByScan}\`; ` +
  `400 \`${DEVICE_PHOTO_CODES.fileRequired}\` without a file. 10 MB at most.`;

const read = { kind: "dynamicAccess", resource: "calibration", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "calibration", action: "write" } as const;
/** Restore and reinstate: `rbac([TENANT_ADMIN])` first, then the `calibration` write gate. */
const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;
const ADMIN_THEN_WRITE = "Tenant administrators only (rbac), who also need `calibration` write (dynamicAccess).";
const SERIAL =
  "A serial number is unique per tenant, deleted devices included (A-92): a serial another device holds is a 409 that names the holder.";

export default defineRouteDocs({
  router: "api/calibrationDevices.route",
  mount: "/api/v1/calibration-devices",
  tag: "CalibrationDevices",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listCalibrationDevices",
      summary: "List calibration devices",
      description:
        "By name (or `sort=id`); `find` matches name, serial number or manufacturer (case-insensitive). P21-02a: filters `qrCode` (normalised), " +
        "`deviceTypeId`, `condition`, `locationId`, `clientFacilityId`; P21-05: `calibrationDue` (`overdue`, `due_soon`, `requested`, the tenant zone's days). " +
        "`view=field` answers the narrow `FieldDeviceSummary` rows (P19-08 § 7.2); a selection above the tenant's working-set cap is a 400 " +
        "`FIELD_WORKING_SET_TOO_LARGE` (narrow by `locationId`). Each full row carries `ipmDue`, `calibrationDue`, `lastCalibration`, `photosComplete` and the displays.",
      permission: read,
      audited: false,
      query: getCalibrationDevicesQuery,
      success: { status: 200, description: "A page of devices (or `FieldDeviceSummary` rows); pagination in the top-level `meta`", list: z.union([CalibrationDevice, FieldDeviceSummary]) },
    },
    {
      method: "get",
      path: "/by-qr/:qrCode",
      operationId: "getCalibrationDeviceByQr",
      summary: "Find a device by its QR sticker",
      description:
        "P21-02a (P19-03 § 8.2): the sticker is normalised with the tenant's prefix and digits, then looked up IN THE CALLER'S CONTEXT. " +
        "Unknown, deleted, another facility's and another tenant's QR answer the same 404; a value that is no QR is a 400. Reachable by a facility-bound account.",
      permission: read,
      audited: false,
      params: z.object({ qrCode: deviceQrParams.shape.qrCode.meta({ description: "The sticker as scanned or typed", example: "TST000042" }) }),
      success: { status: 200, description: "The device, as `GET /:calibrationDeviceId` answers it", data: CalibrationDevice },
    },
    {
      method: "post",
      path: "/",
      operationId: "createCalibrationDevice",
      summary: "Register a calibration device",
      description:
        "P21-02a: a facility-bound technician's body has no `qrCode`, `status` or `calibrationVendorId` (strict: 400). `room` finds or creates a room " +
        "of the device's facility. `clientRef` with the same creator answers its device (200). `Idempotency-Key` replays a create.",
      permission: write,
      audited: true,
      body: createCalibrationDeviceSchema,
      conflict: `${SERIAL} A QR code is unique per tenant, deleted devices included: \`DEVICE_QR_TAKEN\` names the holder.`,
      success: { status: 201, description: "The registered device", data: CalibrationDevice },
    },
    {
      method: "get",
      path: "/:calibrationDeviceId",
      operationId: "getCalibrationDevice",
      summary: "Get one calibration device",
      description: "With its warehouse and its 10 latest calibration records.",
      permission: read,
      audited: false,
      params: deviceIdParams,
      success: { status: 200, description: "The device", data: CalibrationDevice },
    },
    {
      method: "put",
      path: "/:calibrationDeviceId",
      operationId: "updateCalibrationDevice",
      summary: "Edit a calibration device",
      permission: write,
      audited: true,
      description: "P21-02a: the facility never changes here (400 — move the device). A date typed here is `manual` (ADR-133 Am. 1); a new interval re-derives a `record` date.",
      params: deviceIdParams,
      body: updateCalibrationDeviceSchema,
      conflict: `${SERIAL} \`DEVICE_QR_TAKEN\` for a QR another device holds. A retired device stays retired: leaving \`retired\` is the audited reinstatement, never an edit (Q-02).`,
      success: { status: 200, description: "The edited device", data: CalibrationDevice },
    },
    {
      method: "delete",
      path: "/:calibrationDeviceId",
      operationId: "deleteCalibrationDevice",
      summary: "Delete a calibration device (soft)",
      description: "Its attachments go with it, in the same transaction (D-22). A tenant administrator can restore it.",
      permission: write,
      audited: true,
      params: deviceIdParams,
      success: { status: 200, description: "Deleted", empty: true },
    },
    {
      method: "post",
      path: "/:calibrationDeviceId/restore",
      operationId: "restoreCalibrationDevice",
      summary: "Restore a deleted calibration device",
      description: `${ADMIN_THEN_WRITE} Restores exactly the attachments its deletion took with it (A-133).`,
      permission: tenantAdmin,
      audited: true,
      params: deviceIdParams,
      conflict: "The device is not deleted, or a live device of this tenant now holds its serial number.",
      success: { status: 200, description: "The restored device", data: CalibrationDevice },
    },
    {
      method: "post",
      path: "/:calibrationDeviceId/reinstate",
      operationId: "reinstateCalibrationDevice",
      summary: "Reinstate a device retired in error",
      description:
        `${ADMIN_THEN_WRITE} Retirement is terminal; this is the one audited way back, with a mandatory reason and the status to return to (Q-02, ADR-084).`,
      permission: tenantAdmin,
      audited: true,
      params: deviceIdParams,
      body: reinstateCalibrationDeviceSchema,
      conflict: "The device is not retired: there is nothing to reinstate.",
      success: { status: 200, description: "The reinstated device", data: CalibrationDevice },
    },
    {
      method: "post",
      path: "/:calibrationDeviceId/move",
      operationId: "moveCalibrationDevice",
      summary: "Move a device, and its whole history, to another client facility",
      description:
        `${ADMIN_THEN_WRITE} API keys are refused. The device's records, certificates, work orders, IoT readings, non-conformances and files follow it ` +
        "(P19-04 § 11); the move is recorded with two audit rows, one in each facility. A room of the old facility is cleared unless `targetLocationId` names a room of the target or a provider store. " +
        UNMARKED_MOVE,
      permission: tenantAdmin,
      audited: true,
      params: deviceIdParams,
      body: moveBody,
      conflict:
        "The device is already in the target; the target is not active; the device is retired; a certificate of the device is not yet signed or revoked; the target already holds the serial number; the location belongs to another facility.",
      success: { status: 200, description: "The move", data: DeviceMoveResult },
    },
    {
      method: "get",
      path: "/:calibrationDeviceId/moves",
      operationId: "listCalibrationDeviceMoves",
      summary: "A device's moves between client facilities",
      description: `\`calibration\` read, newest first. ${UNMARKED_MOVE}`,
      permission: read,
      audited: false,
      params: deviceIdParams,
      success: { status: 200, description: "The completed moves", data: z.array(DeviceMove) },
    },
    {
      method: "get",
      path: "/:calibrationDeviceId/ipm-sessions",
      operationId: "listCalibrationDeviceIpmSessions",
      summary: "A device's IPM history",
      description:
        "`ipm` read. Submitted and voided sessions and the caller's own drafts, newest first (`performedAt`, then `id`), with the chain " +
        "links (`supersedesId`, `supersededById`, `effective`). The device is read in the caller's context first: another tenant's or " +
        "another facility's device is the 404 of a missing one. Reachable by a facility-bound account (its facility's devices).",
      permission: { kind: "dynamicAccess", resource: "ipm", action: "read" },
      audited: false,
      params: deviceIdParams,
      query: z.object({ page: deviceIpmSessionsQuery.shape.page, limit: deviceIpmSessionsQuery.shape.limit }),
      success: { status: 200, description: "A page of sessions; pagination in the top-level `meta`", list: IpmSessionSummary },
    },
    {
      method: "post",
      path: "/:calibrationDeviceId/calibration-dates",
      operationId: "recordExternalCalibrationDate",
      summary: "Record an outside laboratory's calibration by its date",
      description:
        "P21-05 (ADR-133 § 2): the date and key data of a calibration an outside laboratory performed: no file, no results. A person names the " +
        "laboratory (`calibrationVendorId` and/or `externalLabName`); an API key may not. History is kept: a second entry on the same day is " +
        "accepted with a notice. The device's next due date is re-derived from its latest effective record; an IPM's calibration request " +
        "is cleared. Not facility-accessible (N-10). `Idempotency-Key` replays the entry.",
      permission: write,
      audited: true,
      params: deviceIdParams,
      body: calibrationDateBody,
      conflict: "`CALIBRATION_DEVICE_RETIRED`: the device is retired. `CALIBRATION_FACILITY_ENDED`: its facility has ended.",
      success: { status: 201, description: "The record, the device's derived date and any notices", data: ExternalCalibration },
    },
    {
      method: "post",
      path: "/:calibrationDeviceId/photos",
      operationId: "uploadCalibrationDevicePhoto",
      summary: "Upload or replace a device photo (multipart, field `file`)",
      description:
        "P21-02b (P19-03 § 7.2, ADR-132 Am. 3): the device is read in the caller's context first (another tenant's or facility's: 404, nothing stored). " +
        "The file is checked by its content, its location metadata removed, virus-scanned (fail-closed), fully decoded, and stored with a display (1,600 px) " +
        "and a thumbnail (320 px) derivative carrying no metadata — open them with `POST /attachments/:id/signed-url` `{ variant }`. A `device_front` or " +
        `\`device_serial_plate\` replaces the live one in the same transaction. ${PHOTO_REFUSALS} Counts against the storage quota. ` +
        "Reachable by a facility-bound account (N-6). `Idempotency-Key` replays the upload.",
      permission: write,
      audited: true,
      params: deviceIdParams,
      bodyMediaType: "multipart/form-data",
      body: z.object({
        file: z.string().meta({ format: "binary", description: "The photo: JPEG or PNG by content" }),
        purpose: devicePhotoUpload.shape.purpose,
      }),
      errors: [415, 422],
      success: { status: 201, description: "The stored photo", data: DevicePhoto },
    },
    {
      method: "delete",
      path: "/:calibrationDeviceId/photos/:attachmentId",
      operationId: "deleteCalibrationDevicePhoto",
      summary: "Delete a device photo",
      description:
        "P21-02b: a soft delete, audited (a register photo is not Part 11 evidence); its bytes and derivatives are removed by the deleted-file sweep after " +
        "the retention window. A photo of another device, facility or tenant is the same 404. Reachable by a facility-bound account (N-6).",
      permission: write,
      audited: true,
      params: photoParams,
      success: { status: 200, description: "The deleted photo's id", data: z.object({ id: z.guid() }) },
    },
    {
      method: "post",
      path: "/bulk-import",
      operationId: "bulkImportCalibrationDevices",
      summary: "Import calibration devices from a CSV file",
      description:
        "A header row then one device per row. Rows are checked like a single registration; valid rows are inserted together with ONE audit row, all or none.",
      permission: write,
      audited: true,
      body: z
        .object({ file: z.file().meta({ description: "The CSV file (text/csv, .csv)" }) })
        .meta({ description: "multipart/form-data with a `file` field" }),
      bodyMediaType: "multipart/form-data",
      conflict: "A serial number in the file was registered while the import ran: nothing was imported; upload the file again.",
      success: { status: 200, description: "The import report", data: ImportReport },
    },
  ],
});
