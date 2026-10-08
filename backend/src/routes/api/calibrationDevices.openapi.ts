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
    // warehouses.code is NOT NULL (warehouse.model).
    warehouse: z.object({ id: z.guid(), name: z.string(), code: z.string() }).nullable().optional(),
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
      description: "By name; `find` matches name, serial number or manufacturer (case-insensitive).",
      permission: read,
      audited: false,
      query: getCalibrationDevicesQuery,
      success: { status: 200, description: "A page of devices; pagination in the top-level `meta`", list: CalibrationDevice },
    },
    {
      method: "post",
      path: "/",
      operationId: "createCalibrationDevice",
      summary: "Register a calibration device",
      permission: write,
      audited: true,
      body: createCalibrationDeviceSchema,
      conflict: SERIAL,
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
      params: deviceIdParams,
      body: updateCalibrationDeviceSchema,
      conflict: `${SERIAL} A retired device stays retired: leaving \`retired\` is the audited reinstatement, never an edit (Q-02).`,
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
