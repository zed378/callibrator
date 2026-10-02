/**
 * P9-18 / P9-25 (ADR-103) — the contract of `predictiveMaintenance.route.ts`,
 * code-first.
 *
 * Every route sits behind `router.use(auth)` and the `calibration` gate with
 * `checkTenant`: analysing a device and approving its recommendation are
 * `calibration` writes, listing recommendations a read. Approving sets the
 * device's calibration interval, the same field PUT /calibration-devices/:id
 * edits, with its audit row in the same transaction (A-145). No route reads a
 * body. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const DEVICE = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const params = z.object({ deviceId: z.guid().meta({ description: "The calibration device", example: DEVICE }) });

const DeviceAnalysis = z
  .object({
    status: z.enum(["skipped", "unchanged", "recommended"]),
    newInterval: z.number().int().optional().meta({ description: "Present when `status` is `recommended`" }),
    reason: z.string(),
  })
  .meta({
    id: "PredictiveDeviceAnalysis",
    description: "The outcome of the analysis. A recommendation is stored on the device, notified and audited under the caller, together (A-190); `skipped` and `unchanged` write nothing.",
    example: { status: "recommended", newInterval: 180, reason: "Drift above tolerance in 2 of the last 30 readings" },
  });

const Recommendation = z
  .object({
    id: z.guid(),
    name: z.string(),
    serialNumber: z.string().nullable(),
    calibrationIntervalDays: z.number().int().nullable(),
    recommendedCalibrationInterval: z.number().int(),
    recommendationReason: z.string().nullable(),
  })
  .meta({
    id: "CalibrationIntervalRecommendation",
    example: {
      id: DEVICE,
      name: "Infusion pump",
      serialNumber: "SN-0001",
      calibrationIntervalDays: 365,
      recommendedCalibrationInterval: 180,
      recommendationReason: "Drift above tolerance in 2 of the last 30 readings",
    },
  });

export default defineRouteDocs({
  router: "api/predictiveMaintenance.route",
  mount: "/api/v1/predictive-maintenance",
  tag: "PredictiveMaintenance",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/analyze/:deviceId",
      operationId: "analyzeDevice",
      summary: "Run IoT anomaly analysis for a device",
      permission: { kind: "dynamicAccess", resource: "calibration", action: "write" },
      audited: true,
      params,
      success: { status: 200, description: "The analysis", data: DeviceAnalysis },
    },
    {
      method: "get",
      path: "/recommendations",
      operationId: "listCalibrationRecommendations",
      summary: "List devices with a pending interval recommendation",
      permission: { kind: "dynamicAccess", resource: "calibration", action: "read" },
      audited: false,
      success: { status: 200, description: "The devices", data: z.array(Recommendation) },
    },
    {
      method: "post",
      path: "/recommendations/:deviceId/approve",
      operationId: "approveCalibrationRecommendation",
      summary: "Apply the recommended calibration interval",
      permission: { kind: "dynamicAccess", resource: "calibration", action: "write" },
      audited: true,
      params,
      conflict: "The device has no pending recommendation.",
      success: { status: 200, description: "The device, with its new interval", data: z.object({ id: z.guid() }).loose() },
    },
  ],
});
