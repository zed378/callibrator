/**
 * IoT ingest and device provisioning, `/api/v1/iot`.
 *
 * P9-18 (ADR-087): converted from iot.controller.js, behaviour unchanged.
 * Ingest keeps its own try/catch and hands an error to `next`, as before; the
 * provisioning handlers validate their path and body with the iot validator's
 * own schemas and answer a 400 themselves. `req.user` is read without a guard
 * on the provisioning routes (`auth` runs first). Everything the `.js` required
 * at load is captured at load, in its order; the services are read through
 * their module objects at call time. `export =` keeps the exact object
 * `require()` returned (the same keys, in the same order).
 */
import type { NextFunction, Request, Response } from "express";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { success as loadedSuccess, error as loadedError } from "../utils/response.util";
import models from "../models";
import iotService from "../services/iot.service";
import iotDeviceService from "../services/iotDevice.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import {
  deviceIdSchema as loadedDeviceIdSchema,
  updateIotConfigSchema as loadedUpdateIotConfigSchema,
} from "../validators/iot.validator";
import { checkInput as loadedCheckInput } from "../validators/input";
import type { z } from "zod";
import type { TenantId } from "../types/ids";

const AppError = LoadedAppError;
const success = loadedSuccess;
const error = loadedError;
const { CalibrationDevice } = models;
const asyncHandler = loadedAsyncHandler;
const auditActor = loadedAuditActor;
const deviceIdSchema = loadedDeviceIdSchema;
const updateIotConfigSchema = loadedUpdateIotConfigSchema;
const checkInput = loadedCheckInput;

/** What a provisioning service call answers. */
type IotResult = Awaited<ReturnType<typeof iotDeviceService.issueToken>>;

/** The audit actor of a provisioning change (auditActor(req); its ids are the principal's). */
const actorOf = (req: Request): Parameters<typeof iotDeviceService.issueToken>[2] =>
  auditActor(req) as Parameters<typeof iotDeviceService.issueToken>[2];

const ingestHttp = async (req: Request, res: Response, next: NextFunction): Promise<Response | undefined> => {
  try {
    // A-09: ingest is a public endpoint — a POST with no body at all left
    // `req.body` undefined under Express 5, so reading `.token` off it threw a
    // TypeError and the unauthenticated caller got a 500 instead of a 401.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy body reads as {}
    const { token: bodyToken, payload } = (req.body || {}) as { token?: unknown; payload?: unknown };
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty header falls back to the body
    const token: unknown = req.headers["x-iot-token"] || bodyToken;

    // A non-string (a JSON object or array in the body) is no token at all:
    // hashing it would throw a 500 on an unauthenticated endpoint.
    if (!token || typeof token !== "string") {
      throw new AppError(401, "IoT Device Token is required");
    }

    if (!payload || typeof payload !== "object") {
      throw new AppError(400, "Payload object is required");
    }

    // Authenticate device
    // `.unscoped()` is required to cross tenants — ingest arrives with a device
    // token, not a session — but it also drops the defaultScope, which is what
    // excludes soft-deleted rows. A decommissioned device kept ingesting, so
    // the predicate is carried explicitly.
    const device = await CalibrationDevice.unscoped().findOne({
      // A-29: tokens are stored only as their SHA-256 hash (migration 0044).
      where: {
        iotTokenHash: iotDeviceService.hashIotToken(token),
        iotEnabled: true,
        isDeleted: false,
      },
      attributes: ["id", "tenantId"],
    });

    if (!device) {
      throw new AppError(401, "Invalid IoT Device Token or IoT is disabled for this device");
    }

    const result = await iotService.ingestReading(device.tenantId, device.id, payload as Record<string, unknown>);

    // success(res, data, meta, message, statusCode) sends the response itself.
    // This previously passed the message as `res`, so `res.status` was
    // undefined and every successful ingest threw a TypeError into next().
    return success(res, result, null, "Reading ingested successfully");
  } catch (err) {
    next(err);
  }
  return undefined;
};

// ------------------------------------------------------------------
// Device provisioning (A-29, A-46) — /api/v1/iot/devices/:deviceId
// ------------------------------------------------------------------

/**
 * Validate `data`, or send the 400 and return null.
 * @param res - the response
 * @param data - the input
 * @param schema - the schema
 * @returns the validated value
 */
const validOr400 = <S extends z.ZodType>(res: Response, data: unknown, schema: S): z.output<S> | null => {
  const checked = checkInput(data, schema);
  if (!checked.ok) {
    error(res, "Validation failed", 400, checked.errors);
    return null;
  }
  return checked.value;
};

/**
 * Send a service result down the path its status belongs on: a 404 or 409 is
 * `success: false` with its explanation as the message.
 * @param res - the response
 * @param result - the service result
 * @returns the sent response
 */
const send = (res: Response, result: IotResult): Response =>
  result.status >= 400
    ? error(res, result.message, result.status)
    : success(res, result.data, null, result.message, result.status);

/** A provisioning call: the tenant, the validated device id, the request and response. */
type DeviceRun = (tenantId: TenantId, deviceId: string, req: Request, res: Response) => Promise<IotResult> | null;

/**
 * Wrap a provisioning handler: validate the path, resolve the tenant, and send
 * what `run(tenantId, deviceId, req, res)` returns (null: already answered).
 * @param run - the service call
 * @returns the Express handler
 */
const deviceHandler = (run: DeviceRun): ReturnType<typeof asyncHandler> =>
  asyncHandler(async (req: Request, res: Response) => {
    const params = validOr400(res, req.params, deviceIdSchema);
    if (!params) {
      return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty req.tenantId falls back to the user's
    const tenantId = (req.tenantId || (req.user as { tenantId: TenantId }).tenantId);
    const result = await run(tenantId, params.deviceId, req, res);
    return result ? send(res, result) : undefined;
  });

const getDeviceIotConfig = deviceHandler((tenantId, deviceId) =>
  iotDeviceService.getIotConfig(tenantId, deviceId),
);

const updateDeviceIotConfig = deviceHandler((tenantId, deviceId, req, res) => {
  const input = validOr400(res, req.body, updateIotConfigSchema);
  return input
    ? iotDeviceService.updateIotConfig(tenantId, deviceId, input as Parameters<typeof iotDeviceService.updateIotConfig>[2], actorOf(req))
    : null;
});

const issueDeviceToken = deviceHandler((tenantId, deviceId, req) =>
  iotDeviceService.issueToken(tenantId, deviceId, actorOf(req)),
);

const revokeDeviceToken = deviceHandler((tenantId, deviceId, req) =>
  iotDeviceService.revokeToken(tenantId, deviceId, actorOf(req)),
);

const controller = { ingestHttp, getDeviceIotConfig, updateDeviceIotConfig, issueDeviceToken, revokeDeviceToken };

export = controller;
