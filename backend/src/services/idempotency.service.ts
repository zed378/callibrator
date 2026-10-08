/**
 * `Idempotency-Key` — the stored side of an offline replay (P21-03b; ADR-127 § 7; spec
 * MEMORY/specs/P19-02-ipm-session-aggregate.md § 9.1, § 9.2; AM-25; G-26).
 *
 * A key is the caller's own (per user, or per API key on a route that takes keys): the table is
 * tenant-scoped and `FACILITY_READABLE` by `userId` (G-S11), so another principal's key with the
 * same value is simply not found. NO response body is stored — only the status and the resource the
 * first call created or changed; a replay re-reads that resource IN THE CURRENT CONTEXT (a resource
 * the caller can no longer see answers 404), and the scope fingerprint refuses a replay made under
 * a different access (`IDEMPOTENCY_SCOPE_CHANGED`, FT-92).
 *
 *  - `beginIdempotentRequest`: the in-flight row, inserted and committed BEFORE the route runs; or
 *    the stored answer to replay; or the 409 of a reused key, a changed scope or a request still
 *    in flight. A row in flight for longer than 5 minutes is taken over (its request died).
 *  - `completeIdempotentRequest`: called by the route's service INSIDE its own transaction, so a
 *    rolled-back write leaves no completed key (the request is retried, not replayed).
 *  - `releaseIdempotentRequest`: an answer that is not a success frees the key (a 4xx is corrected
 *    and retried; a 5xx rolled back) — ADR-126 Am. 4 § 5.
 *  - `purgeExpiredIdempotencyKeys`: the nightly purge of keys past `expires_at` (30 days).
 *
 * Named exports only (ADR-087 Am. 15).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Op, UniqueConstraintError, type Transaction } from "sequelize";
import models from "../models";
import type { IdempotencyConflictCode } from "@callibrator/contracts/inspectionValues";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

/** How long a key is kept (spec § 9.1). */
export const IDEMPOTENCY_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** An in-flight row older than this belongs to a request that died; the next attempt takes it over. */
export const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;
/** The purge deletes at most this many rows per batch, and this many batches per run. */
const PURGE_BATCH = 1000;
const PURGE_MAX_BATCHES = 50;

/** The request in flight under a key, as the route's service sees it. */
export interface IdempotencyHandle {
  readonly rowId: string;
  /** Set once the row is completed (by the service, in its transaction, or by the fallback). */
  completed: boolean;
}

/** The handle of the request being served, for `completeIdempotentRequest` (empty without a key). */
export const idempotencyStorage = new AsyncLocalStorage<IdempotencyHandle>();

/** Who holds the key: a person, or an API key on a route that accepts keys. */
export interface IdempotencyOwner {
  readonly userId: string | null;
  readonly apiKeyId: string | null;
}

/** What `beginIdempotentRequest` was given. */
export interface IdempotencyRequest extends IdempotencyOwner {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly route: string;
  readonly requestHash: string;
  readonly scopeFingerprint: string;
}

/** What the middleware does next. */
export type IdempotencyBegin =
  | { readonly kind: "proceed"; readonly handle: IdempotencyHandle }
  | { readonly kind: "replay"; readonly status: number; readonly resourceType: string | null; readonly resourceId: string | null }
  | { readonly kind: "conflict"; readonly code: IdempotencyConflictCode; readonly message: string };

const CONFLICTS: Readonly<Record<IdempotencyConflictCode, string>> = Object.freeze({
  IDEMPOTENCY_IN_FLIGHT: "This request is still being processed; retry shortly.",
  IDEMPOTENCY_KEY_REUSED: "This key was used for a different request.",
  IDEMPOTENCY_SCOPE_CHANGED: "This request was made under a different access; review it.",
});

const conflictOf = (code: IdempotencyConflictCode): IdempotencyBegin => ({ kind: "conflict", code, message: CONFLICTS[code] });

const ownerWhere = (owner: IdempotencyOwner): { userId: string } | { apiKeyId: string } =>
  owner.userId ? { userId: owner.userId } : { apiKeyId: owner.apiKeyId as string };

const findKey = (request: IdempotencyRequest): Promise<ModelInstance<"IdempotencyKey"> | null> =>
  models.IdempotencyKey.findOne({ where: { ...ownerWhere(request), key: request.key } });

const insertKey = async (request: IdempotencyRequest): Promise<IdempotencyBegin | null> => {
  try {
    const now = Date.now();
    const row = await models.IdempotencyKey.create({
      tenantId: request.tenantId,
      userId: request.userId as UserId | null,
      apiKeyId: request.userId ? null : request.apiKeyId,
      key: request.key,
      route: request.route,
      requestHash: request.requestHash,
      scopeFingerprint: request.scopeFingerprint,
      status: "in_flight",
      expiresAt: new Date(now + IDEMPOTENCY_KEY_TTL_MS),
    });
    return { kind: "proceed", handle: { rowId: row.id, completed: false } };
  } catch (err) {
    // Two first attempts at once: the other one inserted the row; read it like any repeat.
    if (err instanceof UniqueConstraintError) {
      return null;
    }
    throw err;
  }
};

/**
 * Start a request under its key (spec § 9.2 steps 1 – 2). The in-flight row is committed on its
 * own, before the route runs, so a concurrent repeat sees it.
 *
 * @param request - the owner, key, route, request hash and scope fingerprint
 * @returns proceed (with the handle), replay (the stored status and resource) or conflict
 */
export const beginIdempotentRequest = async (request: IdempotencyRequest): Promise<IdempotencyBegin> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findKey(request);
    if (!existing) {
      const inserted = await insertKey(request);
      if (inserted) {
        return inserted;
      }
      continue;
    }
    if (existing.requestHash !== request.requestHash || existing.route !== request.route) {
      return conflictOf("IDEMPOTENCY_KEY_REUSED");
    }
    if (existing.scopeFingerprint !== request.scopeFingerprint) {
      return conflictOf("IDEMPOTENCY_SCOPE_CHANGED");
    }
    if (existing.status === "completed") {
      return { kind: "replay", status: existing.responseStatus ?? 200, resourceType: existing.resourceType, resourceId: existing.resourceId };
    }
    if (Date.now() - existing.createdAt.getTime() < IDEMPOTENCY_STALE_MS) {
      return conflictOf("IDEMPOTENCY_IN_FLIGHT");
    }
    // A stale in-flight row: its request died. Take it over (one winner — the destroy is conditional).
    await models.IdempotencyKey.destroy({ where: { id: existing.id, status: "in_flight" } });
  }
  return conflictOf("IDEMPOTENCY_IN_FLIGHT");
};

/**
 * Record the answer of the request in flight — called by the route's service INSIDE its write
 * transaction (spec § 9.2 step 3). A no-op when the request carries no key.
 *
 * @param transaction - the write's transaction
 * @param status - the status the route answers
 * @param resourceType - what was created or changed
 * @param resourceId - its id
 */
export const completeIdempotentRequest = async (
  transaction: Transaction | null,
  status: number,
  resourceType: string | null,
  resourceId: string | null,
): Promise<void> => {
  const handle = idempotencyStorage.getStore();
  if (!handle || handle.completed) {
    return;
  }
  await models.IdempotencyKey.update(
    { status: "completed", responseStatus: status, resourceType, resourceId, completedAt: new Date() },
    { where: { id: handle.rowId, status: "in_flight" }, transaction },
  );
  handle.completed = true;
};

/**
 * Settle a key once its answer is known: a success its service did not complete is completed here
 * (no resource to re-read — a replay answers the status alone); any other answer frees the key.
 *
 * @param handle - the request's handle
 * @param status - the status being answered
 */
export const releaseIdempotentRequest = async (handle: IdempotencyHandle, status: number): Promise<void> => {
  if (handle.completed) {
    return;
  }
  if (status >= 200 && status < 300) {
    await idempotencyStorage.run(handle, () => completeIdempotentRequest(null, status, null, null));
    return;
  }
  await models.IdempotencyKey.destroy({ where: { id: handle.rowId, status: "in_flight" } });
};

/**
 * The nightly purge (spec § 9.1): keys past `expires_at`, in every tenant, bounded per run. No
 * audit row per key — they are plumbing; the job logs the count.
 *
 * @param now - the purge's clock
 * @returns how many rows were deleted, and whether the run stopped at its bound
 */
export const purgeExpiredIdempotencyKeys = async (now: Date = new Date()): Promise<{ deleted: number; stoppedEarly: boolean }> => {
  let deleted = 0;
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
    const rows = await models.IdempotencyKey.findAll({
      where: { expiresAt: { [Op.lt]: now } },
      attributes: ["id"],
      order: [["expiresAt", "ASC"], ["id", "ASC"]],
      limit: PURGE_BATCH,
      skipTenantScope: true,
    });
    if (rows.length === 0) {
      return { deleted, stoppedEarly: false };
    }
    deleted += await models.IdempotencyKey.destroy({ where: { id: rows.map((r) => r.id), expiresAt: { [Op.lt]: now } }, skipTenantScope: true });
  }
  return { deleted, stoppedEarly: true };
};
