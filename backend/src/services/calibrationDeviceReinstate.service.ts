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
 *
 * P9-14 (ADR-087, Stage C): converted from calibrationDeviceReinstate.service.js
 * with no behaviour change (its set_config moved to `sql()` first, as its own
 * change). `export =` keeps the exact object `require()` returned (the same
 * keys, in the same order; `REINSTATE_STATUSES` and `reinstateSchema` are the
 * validator's own objects). The model, `db`, `auditService`, `REINSTATE_SETTING`,
 * the two validator exports, `checkInput` and `sql` are captured once at load,
 * in the `.js`'s require order.
 */
import models from "../models";
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import migration0089 from "../migrations/0089-calibration-device-retired-terminal";
import {
  REINSTATE_STATUSES as LOADED_REINSTATE_STATUSES,
  reinstateCalibrationDeviceSchema as loadedReinstateSchema,
} from "../validators/calibrationDeviceReinstate.validator";
import { checkInput as loadedCheckInput } from "../validators/input";
import { sql as loadedSql, type SqlRunner } from "../utils/sql.util";
import type { FieldError } from "../validators/input";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { CalibrationDevice } = models;
const db = loadedDb;
const auditService = loadedAuditService;
const { REINSTATE_SETTING } = migration0089;

const RETIRED = "retired";

/** The statuses a reinstated device may return to (declared beside the request schema). */
const REINSTATE_STATUSES = LOADED_REINSTATE_STATUSES;
const reinstateSchema = loadedReinstateSchema;
const checkInput = loadedCheckInput;
const sql = loadedSql;

/** `db` as sql() takes it: the same object, viewed through the one method sql() calls. */
const dbRunner = db as unknown as SqlRunner;

type DeviceRow = ModelInstance<"CalibrationDevice">;

/** A service answer the controller forwards. */
interface Outcome<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
  errors?: FieldError[];
}

/**
 * The 409 for leaving `retired` through the edit path.
 *
 * @param device - the stored row
 */
const retirementConflict = (device: { name: string }): Outcome<null> & { success: false; status: 409 } => ({
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
 * @param device - the stored row
 * @param changes - the validated edit
 */
const leavesRetirement = (device: { status?: string | null }, changes: { status?: unknown }): boolean =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-unnecessary-type-conversion -- as built: an empty status reads as "", and a JavaScript caller may pass a non-string (ADR-038 rule 3)
  String(device.status || "").toLowerCase() === RETIRED &&
  typeof changes.status === "string" &&
  changes.status.toLowerCase() !== RETIRED;

/** A database error as Sequelize wraps it: the driver's error is `parent`. */
interface DatabaseErrorLike {
  parent?: { code?: string; message?: string } | null;
}

/**
 * Whether a database error is migration 0089's trigger refusing the write.
 *
 * @param error - a thrown value
 */
const isRetirementTerminalViolation = (error: unknown): boolean => {
  const e = error as DatabaseErrorLike | null | undefined;
  return Boolean(
    /* eslint-disable @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-includes -- as built (ADR-038 rule 3): the .js's `&&` chain, `|| ""` and regex test */
    e &&
      e.parent &&
      e.parent.code === "23514" &&
      /retirement is terminal/.test(e.parent.message || ""),
    /* eslint-enable @typescript-eslint/prefer-optional-chain, @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-includes */
  );
};

/** Who reinstates, and from where (auditActor(req)). */
interface Actor {
  userId?: UserId | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Reinstate a retired calibration device.
 *
 * 404 — not found, deleted, or another tenant's (indistinguishable).
 * 409 — the device is not retired: there is nothing to reinstate.
 * 400 — no reason (at least 10 characters), or no status to return to.
 *
 * @param tenantId
 * @param calibrationDeviceId
 * @param input - `{ reason, status }`
 * @param actor - auditActor(req)
 */
const reinstate = async (
  tenantId: TenantId,
  calibrationDeviceId: string,
  input: unknown,
  actor: Actor = {},
): Promise<Outcome<DeviceRow | null>> => {
  const checked = checkInput(input, reinstateSchema);
  if (!checked.ok) {
    return {
      success: false,
      status: 400,
      message: "Validation failed",
      data: null,
      errors: checked.errors,
    };
  }
  const { value } = checked;

  // Default scope: a deleted device is not reinstated (restore it first).
  // The tenant predicate is explicit, and the global tenant hooks apply too.
  const device = await CalibrationDevice.findOne({ where: { id: calibrationDeviceId, tenantId } });
  if (!device) {
    return { success: false, status: 404, message: "Calibration device not found", data: null };
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty status reads as "" (ADR-038 rule 3)
  if (String(device.status || "").toLowerCase() !== RETIRED) {
    return {
      success: false,
      status: 409,
      message:
        `Calibration device "${device.name}" is not retired (its status is "${String(device.status)}"), ` +
        "so there is nothing to reinstate. Change its status by editing it.",
      data: null,
    };
  }

  await db.transaction(async (transaction) => {
    // Transaction-local: names THIS device to the 0089 trigger, and ends with
    // the transaction. Reads no table, so it carries no tenant predicate.
    // P9-07: through sql() — bind parameters, type SELECT.
    await sql(dbRunner, "SELECT set_config($1, $2, true)", [REINSTATE_SETTING, device.id], { transaction });
    await device.update({ status: value.status }, { transaction });
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty value is recorded as null */
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
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  });

  return {
    success: true,
    status: 200,
    message: `Calibration device reinstated as "${value.status}"; the retirement is recorded as entered in error`,
    data: device,
  };
};

export = {
  RETIRED,
  REINSTATE_STATUSES,
  reinstateSchema,
  retirementConflict,
  leavesRetirement,
  isRetirementTerminalViolation,
  reinstate,
};
