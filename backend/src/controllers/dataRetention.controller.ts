// P9-20 (ADR-087): converted from dataRetention.controller.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). The service is the module object; every other
// load-time destructure is kept as a capture at load. The `.js` also
// destructured `error` and never used it; that unused name is gone.
// A validated tenant id becomes a `TenantId` through `toTenantId`, which cannot
// throw here: `z.guid()` has already accepted exactly the shape it checks.
import type { Request, Response } from "express";

import dataRetentionService from "../services/dataRetention.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import {
  tenantIdSchema as loadedTenantIdSchema,
  retentionPolicySchema as loadedRetentionPolicySchema,
  legalHoldSchema as loadedLegalHoldSchema,
  piiMaskSchema as loadedPiiMaskSchema,
  anonymizeSchema as loadedAnonymizeSchema,
} from "../validators/dataRetention.validator";
import { validateInput as loadedValidate } from "../validators/input";
// A-273: the path names the resource — path params win, a differing body id is 400.
import { withPathParams as loadedWithPathParams } from "../utils/pathParams.util";
import { toTenantId } from "../types/ids";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const auditActor = loadedAuditActor;
const tenantIdSchema = loadedTenantIdSchema;
const retentionPolicySchema = loadedRetentionPolicySchema;
const legalHoldSchema = loadedLegalHoldSchema;
const piiMaskSchema = loadedPiiMaskSchema;
const anonymizeSchema = loadedAnonymizeSchema;
const validate = loadedValidate;
const withPathParams = loadedWithPathParams;

/**
 * The path parameters. Express 5 types a parameter `string | string[]` (the
 * array is a `*splat`); these routes name only `:param`s, which are strings.
 */
const paramsOf = (req: Request): Record<string, string> => req.params as Record<string, string>;

/** The body, as a JavaScript caller sends it (withPathParams reads it as a plain object). */
const bodyOf = (req: Request): Record<string, unknown> | undefined => req.body as Record<string, unknown> | undefined;

const getRetentionPolicy = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.getRetentionPolicy(toTenantId(validated.tenantId));

  success(res, result, null, "Fetch retention policy successful");
});

const setRetentionPolicy = asyncHandler(async (req: Request, res: Response) => {
  // `tenantId` arrives as a path param (:tenantId); merged with the body so
  // the frontend does not have to repeat it — and it cannot override it (A-273).
  const validated = validate(withPathParams(paramsOf(req), bodyOf(req)), retentionPolicySchema);
  const result = await dataRetentionService.setRetentionPolicy(
    toTenantId(validated.tenantId),
    validated.policyKey,
    validated.days,
    auditActor(req), // A-153: audited in the transaction
  );

  success(res, result, null, "Retention policy updated");
});

const isOnLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.isOnLegalHold(toTenantId(validated.tenantId));

  success(res, { tenantId: validated.tenantId, onLegalHold: result }, null, "Legal hold status fetched");
});

const enableLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(withPathParams(paramsOf(req), bodyOf(req)), legalHoldSchema);
  // A-153: the actor, for the audit row written in the transaction.
  const result = await dataRetentionService.enableLegalHold(
    toTenantId(validated.tenantId),
    auditActor(req),
    validated.reason,
  );

  success(res, result, null, "Legal hold enabled");
});

const disableLegalHold = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.disableLegalHold(
    toTenantId(validated.tenantId),
    auditActor(req),
  );

  success(res, result, null, "Legal hold disabled");
});

const purgeExpiredRecords = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(req.params, tenantIdSchema);
  const result = await dataRetentionService.purgeExpiredRecords(toTenantId(validated.tenantId));

  success(res, result, null, "Purge completed");
});

const maskPII = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(withPathParams(paramsOf(req), bodyOf(req)), piiMaskSchema);
  const result = await dataRetentionService.maskPII(
    toTenantId(validated.tenantId),
    validated.entityType,
    // A-135: audit rows are masked per data subject (piiMaskSchema).
    // piiMaskSchema's superRefine refuses a request without the list its entityType needs.
    (validated.entityType === "audit_logs" ? validated.subjectIds : validated.recordIds) as string[],
    auditActor(req),
  );

  success(res, result, null, "PII masked");
});

const anonymizeDataset = asyncHandler(async (req: Request, res: Response) => {
  const validated = validate(withPathParams(paramsOf(req), bodyOf(req)), anonymizeSchema);
  // A-152: refused for every entity type (400); see the service.
  const result = await dataRetentionService.anonymizeDataset(
    toTenantId(validated.tenantId),
    validated.entityType,
  );

  success(res, result, null, "Dataset anonymized");
});

const controller = {
  getRetentionPolicy,
  setRetentionPolicy,
  isOnLegalHold,
  enableLegalHold,
  disableLegalHold,
  purgeExpiredRecords,
  maskPII,
  anonymizeDataset,
};

export = controller;
