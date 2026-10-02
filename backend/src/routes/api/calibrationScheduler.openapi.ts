/**
 * P9-20 / P9-25 (ADR-103) — the contract of `calibrationScheduler.route.ts`,
 * code-first. Both routes carry `auth` and a `dynamicAccess` gate on the
 * `maintenance` resource with `checkTenant` (a `tenantId` the request names must
 * be the caller's). Neither validates its input: `leadDays` is read raw and
 * ignored unless it is a finite number; `allTenants` and `tenantId` are honoured
 * for a super admin only. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const LEAD_DAYS = "Include devices due within this many days from now (a non-number is ignored: the scheduler's default lead).";
const ALL_TENANTS = "Super admin only: scan every tenant. Ignored for anyone else.";

/** One device the scan would act on (`calibrationScheduler.service#getDueDevices`). */
const DueDevice = z
  .object({
    id: z.guid(),
    name: z.string(),
    serialNumber: z.string().nullable(),
    tenantId: z.guid(),
    // The scan selects only devices whose next date is set (calibrationScheduler.service: `[Op.ne]: null`).
    nextCalibrationDate: z.iso.datetime(),
    calibrationIntervalDays: z.number().int().nullable(),
    overdue: z.boolean(),
  })
  .meta({
    id: "DueCalibrationDevice",
    description: "A calibration device whose next calibration is due within the window.",
    example: {
      id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      name: "Infusion pump",
      serialNumber: "SN-0001",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      nextCalibrationDate: "2030-01-15T00:00:00.000Z",
      calibrationIntervalDays: 365,
      overdue: true,
    },
  });

/** A scan's report (`calibrationScheduler.service#runCalibrationScan`). */
const ScanSummary = z
  .object({
    scanned: z.number().int(),
    workOrdersCreated: z.number().int(),
    notificationsCreated: z.number().int(),
    skipped: z.number().int(),
    overdue: z.number().int(),
    errors: z.number().int(),
    details: z.array(
      z
        .object({
          deviceId: z.guid(),
          action: z.enum(["created", "skipped", "error"]),
          reason: z.string().optional(),
          error: z.string().optional(),
          overdue: z.boolean().optional(),
          workOrderId: z.guid().optional(),
        })
        .meta({ description: "What the scan did with one device." }),
    ),
  })
  .meta({
    id: "CalibrationScanSummary",
    description:
      "Counts and per-device lines. Idempotent: a device with an open preventative work order is skipped, " +
      "and one a concurrent scan created first is a skip too (W-03).",
    example: {
      scanned: 2,
      workOrdersCreated: 1,
      notificationsCreated: 1,
      skipped: 1,
      overdue: 1,
      errors: 0,
      details: [
        { deviceId: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d", action: "created", overdue: true, workOrderId: "2e3d4c5b-6f7a-4b8c-9d0e-1f2a3b4c5d6e" },
        { deviceId: "3f4e5d6c-7a8b-4c9d-8e0f-2a3b4c5d6e7f", action: "skipped", reason: "open work order exists", workOrderId: "4a5b6c7d-8e9f-4a0b-9c1d-3e4f5a6b7c8d" },
      ],
    },
  });

export default defineRouteDocs({
  router: "api/calibrationScheduler.route",
  mount: "/api/v1/calibration-scheduler",
  tag: "Calibration Scheduler",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/due",
      operationId: "listDueCalibrationDevices",
      summary: "List devices due (or overdue) for calibration",
      description:
        "Read-only preview of the devices the scheduler would act on, in the caller's tenant (a super admin may pass allTenants=true). Writes nothing.",
      permission: { kind: "dynamicAccess", resource: "maintenance", action: "read" },
      audited: false,
      query: z.object({
        leadDays: z.coerce.number().optional().meta({ description: LEAD_DAYS, example: 14 }),
        allTenants: z.enum(["true", "false"]).optional().meta({ description: ALL_TENANTS }),
      }),
      success: { status: 200, description: "The due devices, earliest first", data: z.array(DueDevice) },
    },
    {
      method: "post",
      path: "/run",
      operationId: "runCalibrationScan",
      summary: "Run the calibration scan now",
      description:
        "Creates a Preventative work order and a tenant-wide CALIBRATION notification for each due device, each with its own audit row " +
        "attributed to the caller (W-30). Scoped to the caller's tenant unless a super admin passes allTenants=true or a tenantId.",
      permission: { kind: "dynamicAccess", resource: "maintenance", action: "create" },
      audited: true,
      body: z
        .object({
          leadDays: z.number().optional().meta({ description: LEAD_DAYS, example: 7 }),
          allTenants: z.boolean().optional().meta({ description: ALL_TENANTS }),
          tenantId: z.guid().optional().meta({ description: "Super admin only: the one tenant to scan." }),
        })
        .meta({ description: "Optional; no body scans the caller's tenant with the default lead." }),
      success: { status: 200, description: "The scan's report", data: ScanSummary },
    },
  ],
});
