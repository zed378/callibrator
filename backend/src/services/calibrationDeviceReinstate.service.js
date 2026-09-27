/**
 * Q-02 (ADR-084) — a retired calibration device is permanently retired, with
 * one audited way back for a retirement entered in error.
 *
 * `retired` is terminal:
 *  - the edit path (calibrationDevices.service#updateCalibrationDevice) answers
 *    409 with a state explanation for any status other than `retired` on a
 *    retired device — retirementConflict();
 *  - the database refuses the same UPDATE from any path (migration 0089,
 *    trigger `calibration_devices_retired_terminal`, SQLSTATE 23514), and the
 *    edit path maps that to the same 409 for the race where the device was
 *    retired between its read and the write — isRetirementTerminalViolation().
 *
 * A retirement entered in error is corrected, not edited: reinstate() takes a
 * mandatory reason and the status to return to, and writes the status change
 * and an UPDATE audit row (`operation: "REINSTATE"`, the reason, before and
 * after) in ONE transaction. That transaction names the device in the
 * transaction-local setting the trigger reads, which is the only way past it.
 * The trail therefore reads "retired, then reinstated by X because Y" — never
 * a retirement that silently stopped being one.
 */

const Joi = require("joi");
const { CalibrationDevice } = require("../models");
const { db } = require("../config");
const auditService = require("./audit.service");
const { REINSTATE_SETTING } = require("../migrations/0089-calibration-device-retired-terminal");

const RETIRED = "retired";

/** The statuses a reinstated device may return to. */
const REINSTATE_STATUSES = Object.freeze(["active", "inactive", "maintenance"]);

const reinstateSchema = Joi.object({
  reason: Joi.string().trim().min(10).max(1000).required(),
  status: Joi.string()
    .lowercase()
    .valid(...REINSTATE_STATUSES)
    .required(),
});

/**
 * The 409 for leaving `retired` through the edit path.
 *
 * @param {{name: string}} device
 * @returns {{success: false, status: 409, message: string, data: null}}
 */
const retirementConflict = (device) => ({
  success: false,
  status: 409,
  message:
    `Calibration device "${device.name}" is retired, and retirement is permanent: its status ` +
    "cannot be changed by editing it. If it was retired in error, an administrator can reinstate " +
    "it with a reason (POST /calibration-devices/:id/reinstate), which records the correction.",
  data: null,
});

/**
 * Whether an edit asks a retired device to leave `retired`.
 *
 * @param {{status?: string}} device - the stored row
 * @param {{status?: string|null}} changes - the validated edit
 * @returns {boolean}
 */
const leavesRetirement = (device, changes) =>
  String(device.status || "").toLowerCase() === RETIRED &&
  typeof changes.status === "string" &&
  changes.status.toLowerCase() !== RETIRED;

/**
 * Whether a database error is migration 0089's trigger refusing the write.
 *
 * @param {Error & {parent?: {code?: string, message?: string}}} error
 * @returns {boolean}
 */
const isRetirementTerminalViolation = (error) =>
  Boolean(
    error &&
      error.parent &&
      error.parent.code === "23514" &&
      /retirement is terminal/.test(error.parent.message || ""),
  );

/**
 * Reinstate a retired calibration device.
 *
 * 404 — not found, deleted, or another tenant's (indistinguishable).
 * 409 — the device is not retired: there is nothing to reinstate.
 * 400 — no reason (at least 10 characters), or no status to return to.
 *
 * @param {string} tenantId
 * @param {string} calibrationDeviceId
 * @param {{reason?: unknown, status?: unknown}} input
 * @param {{userId?: string|null, ipAddress?: string|null, userAgent?: string|null}} [actor]
 */
const reinstate = async (tenantId, calibrationDeviceId, input, actor = {}) => {
  const { error, value } = reinstateSchema.validate(input ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) {
    return {
      success: false,
      status: 400,
      message: "Validation failed",
      data: null,
      errors: error.details.map((d) => ({ field: d.path.join("."), message: d.message })),
    };
  }

  // Default scope: a deleted device is not reinstated (restore it first).
  // The tenant predicate is explicit, and the global tenant hooks apply too.
  const device = await CalibrationDevice.findOne({ where: { id: calibrationDeviceId, tenantId } });
  if (!device) {
    return { success: false, status: 404, message: "Calibration device not found", data: null };
  }

  if (String(device.status || "").toLowerCase() !== RETIRED) {
    return {
      success: false,
      status: 409,
      message:
        `Calibration device "${device.name}" is not retired (its status is "${device.status}"), ` +
        "so there is nothing to reinstate. Change its status by editing it.",
      data: null,
    };
  }

  await db.transaction(async (transaction) => {
    // Transaction-local: names THIS device to the 0089 trigger, and ends with
    // the transaction. Reads no table, so it carries no tenant predicate.
    await db.query("SELECT set_config(:setting, :deviceId, true)", {
      replacements: { setting: REINSTATE_SETTING, deviceId: device.id },
      transaction,
    });
    await device.update({ status: value.status }, { transaction });
    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId || null,
        action: "UPDATE",
        resourceType: "CalibrationDevice",
        resourceId: device.id,
        changes: {
          operation: "REINSTATE",
          reason: value.reason,
          before: { status: RETIRED },
          after: { status: value.status },
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  return {
    success: true,
    status: 200,
    message: `Calibration device reinstated as "${value.status}"; the retirement is recorded as entered in error`,
    data: device,
  };
};

module.exports = {
  RETIRED,
  REINSTATE_STATUSES,
  reinstateSchema,
  retirementConflict,
  leavesRetirement,
  isRetirementTerminalViolation,
  reinstate,
};
