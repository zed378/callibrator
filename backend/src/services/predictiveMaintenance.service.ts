// src/services/predictiveMaintenance.service.ts
//
// P9-18 (ADR-087, Stage C): converted from predictiveMaintenance.service.js
// with no behaviour change. `export =` keeps what `require()` returned: ONE
// instance of the class, its two methods on the prototype. The models,
// `sequelize`, `AppError`, the auditPrincipal helpers, the logger and `Op` are
// captured at load, as the `.js` destructured them; `auditService` is read at
// call time through its object.
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import auditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import Sequelize from "sequelize";
import type { CreationAttributes } from "sequelize";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { CalibrationDevice, IotReading, Notification, sequelize } = models;
const AppError = LoadedAppError;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const logger = loadedLogger;
const { Op } = Sequelize;

/** What analyzeDevice answers. */
type AnalysisResult =
  | { status: "skipped" | "unchanged"; reason: string }
  | { status: "recommended"; newInterval: number; reason: string };

class PredictiveMaintenanceService {
  /**
   * Analyze IoT data for a specific calibration device and generate a
   * recommendation for its calibration interval.
   *
   * A-190 — the recommendation it stores (the value approveRecommendation
   * later applies, A-145), the tenant notification and ONE audit row now
   * commit together. Before, both writes autocommitted unattributed: who
   * proposed a change to a device's calibration programme was not recorded.
   * The outcomes that write nothing ("skipped", "unchanged") record nothing.
   *
   * @param tenantId
   * @param deviceId
   * @param actor - auditActor(req)
   */
  async analyzeDevice(tenantId: TenantId, deviceId: string, actor: AuditActorInput = {}): Promise<AnalysisResult> {
    const device = await CalibrationDevice.findOne({
      where: { id: deviceId, tenantId, iotEnabled: true },
    });

    if (!device) {
      throw new AppError(404, "IoT enabled Calibration Device not found");
    }

    if (!device.calibrationIntervalDays) {
      throw new AppError(400, "Device has no baseline calibration interval to optimize");
    }

    // Analyze the last 30 days of telemetry
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const totalReadings = await IotReading.count({
      where: {
        deviceId,
        tenantId,
        timestamp: { [Op.gte]: thirtyDaysAgo },
      },
    });

    if (totalReadings < 10) {
      // Not enough data
      return { status: "skipped", reason: "Not enough IoT readings in the last 30 days." };
    }

    const anomalyReadings = await IotReading.count({
      where: {
        deviceId,
        tenantId,
        isAnomaly: true,
        timestamp: { [Op.gte]: thirtyDaysAgo },
      },
    });

    const anomalyRate = anomalyReadings / totalReadings;
    let newInterval = device.calibrationIntervalDays;
    let reason: string;

    // Statistical rules engine
    if (anomalyRate > 0.05) {
      // > 5% anomaly rate: Device is drifting heavily. Shorten interval by 50%.
      newInterval = Math.max(1, Math.floor(device.calibrationIntervalDays * 0.5));
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the interval interpolated as its decimal string
      reason = `High anomaly rate (${(anomalyRate * 100).toFixed(1)}%). Recommending shortening the calibration interval to ${newInterval} days to maintain accuracy and prevent critical failures.`;
    } else if (anomalyRate > 0.01) {
      // 1-5% anomaly rate: Slight drift. Shorten interval by 20%.
      newInterval = Math.max(1, Math.floor(device.calibrationIntervalDays * 0.8));
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the interval interpolated as its decimal string
      reason = `Moderate anomaly rate (${(anomalyRate * 100).toFixed(1)}%). Recommending slightly shorter calibration interval of ${newInterval} days.`;
    } else if (anomalyRate === 0 && totalReadings > 100) {
      // 0% anomalies over a large sample: Device is extremely stable. Extend interval by 20%.
      newInterval = Math.floor(device.calibrationIntervalDays * 1.2);
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the interval interpolated as its decimal string
      reason = `Zero anomalies detected over a large sample of readings. Device is highly stable. Recommending extending calibration interval to ${newInterval} days to reduce maintenance costs.`;
    } else {
      // Stable, no change needed.
      return { status: "unchanged", reason: "Current calibration interval is optimal based on recent readings." };
    }

    const before = {
      recommendedCalibrationInterval: device.recommendedCalibrationInterval ?? null,
      recommendationReason: device.recommendationReason ?? null,
    };

    await sequelize.transaction(async (transaction) => {
      // Save the recommendation to the device
      await device.update(
        { recommendedCalibrationInterval: newInterval, recommendationReason: reason },
        { transaction },
      );

      // Notify the tenant
      const notification: Record<string, unknown> = {
        tenantId,
        title: `Predictive Maintenance Recommendation: ${device.name}`,
        message: `We analyzed the IoT telemetry for ${device.name}. ${reason}`,
        type: "MAINTENANCE",
      };
      await Notification.create(
        // As built: the notification is written as given.
        notification as CreationAttributes<ModelInstance<"Notification">>,
        { transaction },
      );

      await auditService.logAction(
        {
          tenantId,
          // A-282 (ADR-100): a key is system:api-key, its id in changes.
          ...auditEntryActor(actor),
          action: "UPDATE",
          resourceType: "CalibrationDevice",
          resourceId: device.id,
          changes: {
            ...actorChanges(actor),
            operation: "RECOMMEND_INTERVAL",
            before,
            after: {
              recommendedCalibrationInterval: newInterval,
              recommendationReason: reason,
              calibrationIntervalDays: device.calibrationIntervalDays,
              anomalyRate,
              totalReadings,
            },
          },
        },
        { transaction },
      );
    });

    logger.info(`Generated predictive maintenance recommendation for device ${deviceId}`, { newInterval, reason });

    return { status: "recommended", newInterval, reason };
  }

  /**
   * Apply a device's pending recommended calibration interval.
   *
   * A-145 — the interval change and its audit row commit together. Until
   * 2026-09-24 the controller updated the device with no audit row, so a
   * change to a device's calibration programme (ISO 17025 §6.4.7) was
   * unattributable. The route is deliberately NOT a Part 11 authoring route
   * (tests/routes/denyPlatformAuthoring.a127.test.js NOT_GUARDED): the same
   * field is editable through PUT /calibration-devices/:id, which is not one.
   *
   * @param tenantId
   * @param deviceId
   * @param userId - the approving user
   * @returns the updated device
   * @throws {AppError} 404 when the device is not in the tenant; 409 when it
   *   has no pending recommendation
   */
  async approveRecommendation(tenantId: TenantId, deviceId: string, userId: UserId): Promise<ModelInstance<"CalibrationDevice">> {
    const device = await CalibrationDevice.findOne({ where: { id: deviceId, tenantId } });

    if (!device) {
      throw new AppError(404, "Device not found");
    }

    // A state conflict, explained — not a malformed request.
    if (!device.recommendedCalibrationInterval) {
      throw new AppError(
        409,
        "Device does not have a pending recommendation. Run an analysis first; a recommendation can be applied only once.",
      );
    }

    const before = {
      calibrationIntervalDays: device.calibrationIntervalDays,
      recommendedCalibrationInterval: device.recommendedCalibrationInterval,
      recommendationReason: device.recommendationReason,
    };

    await sequelize.transaction(async (transaction) => {
      const applied: Record<string, unknown> = {
        calibrationIntervalDays: device.recommendedCalibrationInterval,
        recommendedCalibrationInterval: null,
        recommendationReason: null,
      };
      await device.update(applied, { transaction });
      await auditService.logAction(
        {
          tenantId,
          userId,
          action: "APPROVE",
          resourceType: "CalibrationDevice",
          resourceId: device.id,
          changes: {
            operation: "APPLY_RECOMMENDED_INTERVAL",
            before,
            after: { calibrationIntervalDays: before.recommendedCalibrationInterval },
          },
        },
        { transaction },
      );
    });

    return device;
  }
}

export = new PredictiveMaintenanceService();
