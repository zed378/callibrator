// P9-20 (ADR-087): converted from featureFlag.controller.js with no behaviour
// change. `export =` keeps the exact object `require()` returned (the same
// keys, in the same order). The service is the module object; every other
// load-time destructure is kept as a capture at load. The `.js` also
// destructured `error` and never used it; that unused name is gone.
// A validated tenant id becomes a `TenantId` through `toTenantId`, which cannot
// throw here: `z.guid()` has already accepted exactly the shape it checks.
import type { Request, Response } from "express";

import featureFlagService from "../services/featureFlag.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import {
  flagKeySchema as loadedFlagKeySchema,
  flagValueSchema as loadedFlagValueSchema,
  tenantFlagQuerySchema as loadedTenantFlagQuerySchema,
} from "../validators/featureFlag.validator";
import { validateInput as loadedValidate } from "../validators/input";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
// A-273: the path names the resource — path params win, a differing body id is 400.
import { withPathParams as loadedWithPathParams } from "../utils/pathParams.util";
import { toTenantId } from "../types/ids";
import type { UserId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const flagKeySchema = loadedFlagKeySchema;
const flagValueSchema = loadedFlagValueSchema;
const tenantFlagQuerySchema = loadedTenantFlagQuerySchema;
const validate = loadedValidate;
const auditPrincipal = loadedAuditPrincipal;
const withPathParams = loadedWithPathParams;

/**
 * The path parameters. Express 5 types a parameter `string | string[]` (the
 * array is a `*splat`); these routes name only `:param`s, which are strings.
 */
const paramsOf = (req: Request): Record<string, string> => req.params as Record<string, string>;

/** The caller `auth` put on the request. */
interface Caller {
  id?: UserId | null;
}

const getTenantFlags = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.query, tenantFlagQuerySchema);
  const result = await featureFlagService.getTenantFlags(toTenantId(validated.tenantId));

  success(res, result, null, "Fetch feature flags successful");
});

const isFlagEnabled = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(withPathParams(paramsOf(req), req.query), flagKeySchema);
  const result = await featureFlagService.isEnabled(
    toTenantId(validated.tenantId),
    validated.flagKey,
  );

  success(res, { flagKey: validated.flagKey, enabled: result }, null, "Flag status fetched");
});

const setTenantFlag = asyncHandler(async (req: Request, res: Response) => {
  // tenantId + flagKey are path params (:tenantId/:flagKey); merged with the
  // body (which carries `enabled`) so the documented { enabled } payload works.
  // A-273: the path wins, and a body naming another tenant or flag is 400.
  const validated = validate(withPathParams(paramsOf(req), req.body as Record<string, unknown> | undefined), flagValueSchema);
  const result = await featureFlagService.setTenantFlag(
    toTenantId(validated.tenantId),
    validated.flagKey,
    validated.enabled,
    (req.user as Caller | undefined)?.id,
    auditPrincipal(req),
  );

  success(res, result, null, "Feature flag updated");
});

const resetTenantFlag = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, flagKeySchema);
  const result = await featureFlagService.resetTenantFlag(
    toTenantId(validated.tenantId),
    validated.flagKey,
    auditPrincipal(req),
  );

  success(res, result, null, "Feature flag reset to default");
});

const initializeTenantFlags = asyncHandler(async (req: Request, res: Response) => {
  // Only tenantId is in the path here — validating against flagKeySchema (which
  // also requires flagKey) rejected every call with 400.
  const validated = validate(req.params, tenantFlagQuerySchema);
  const result = await featureFlagService.initializeTenantFlags(toTenantId(validated.tenantId), auditPrincipal(req));

  success(res, result, null, "Feature flags initialized");
});

// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async handler, so its result is a promise the wrapper chains
const getAllFlagDefinitions = asyncHandler(async (_req: Request, res: Response) => {
  success(res, featureFlagService.DEFAULT_FLAGS, null, "Fetch flag definitions successful");
});

const controller = {
  getTenantFlags,
  isFlagEnabled,
  setTenantFlag,
  resetTenantFlag,
  initializeTenantFlags,
  getAllFlagDefinitions,
};

export = controller;
