/**
 * A-282 (ADR-094) — the actor of an audit row, for a route an API key can reach.
 *
 * `auditActor(req)` (auditActor.util) names `req.user.id` as the row's user.
 * For an API-key principal that id is the KEY's (auth.middleware#tryApiKeyAuth
 * builds a synthetic principal), and `audit_logs.user_id` references `users`
 * (migration 0030): on PostgreSQL the insert fails its foreign key and the
 * mutation rolls back. A key is a machine credential, as SCIM's is (A-37), so
 * it is recorded as the system actor `system:api-key` with the key's id in
 * `changes.apiKeyId`.
 *
 * `auditPrincipal(req)` captures who acted; `actorFields(principal)` gives the
 * fields of a `logAction` entry that name them, and `actorChanges` the key id
 * to merge into `changes`. Services build the rest of the entry as before.
 */
import { SYSTEM_ACTORS } from "../constants/systemActors";
import type { AuditActorRequest } from "./auditActor.util";

/** The principal an audit row names. */
export interface AuditPrincipal {
  /** The user who acted; null for an API key. */
  readonly userId: string | null;
  /** The API key that acted; null for a user. */
  readonly apiKeyId: string | null;
  readonly ipAddress: string | null;
  /** One string, as `audit_logs.user_agent` stores it (A-282, ADR-100). */
  readonly userAgent: string | null;
}

interface PrincipalRequest extends AuditActorRequest {
  readonly user?:
    | {
        readonly id?: string | null;
        readonly tenantId?: string | null;
        readonly isApiKey?: boolean;
      }
    | null
    | undefined;
}

/**
 * @param req - the request (or any object of its shape)
 * @returns who acted, with the key and the user kept apart
 */
export const auditPrincipal = (req: PrincipalRequest): AuditPrincipal => {
  const id = req.user?.id ?? null;
  const isKey = req.user?.isApiKey === true;
  const agent = req.headers?.["user-agent"];
  return {
    userId: isKey ? null : id,
    apiKeyId: isKey ? id : null,
    ipAddress: req.ip ?? null,
    // Node gives one string; a repeated header (typed string[]) is joined, as
    // Node joins most repeated headers, so the audit entry holds one string.
    userAgent: Array.isArray(agent) ? agent.join(", ") : (agent ?? null),
  };
};

/** The actor fields of a `logAction` entry: exactly one of `userId` or `systemActor`. */
export type ActorFields = { userId: string | null } | { systemActor: string };

/**
 * What a service may hand the audit helpers: a request's principal, or (A-282,
 * ADR-100) a job's `{ systemActor }` — maintenance and the calibration scan
 * write the same rows from a scheduler as from a request.
 */
export type AuditActorInput = Partial<AuditPrincipal> & { readonly systemActor?: string | null };

/**
 * A key is `system:api-key`; otherwise a user is the row's user; otherwise a
 * job's system actor; otherwise no user (the insert then fails closed).
 *
 * @param principal - from auditPrincipal, or a job's `{ systemActor }`
 */
export const actorFields = (
  principal: AuditActorInput | null | undefined,
): ActorFields => {
  if (principal?.apiKeyId) {
    return { systemActor: SYSTEM_ACTORS.API_KEY };
  }
  if (!principal?.userId && principal?.systemActor) {
    return { systemActor: principal.systemActor };
  }
  return { userId: principal?.userId ?? null };
};

/**
 * @param principal - from auditPrincipal
 * @returns `{ apiKeyId }` for a key, `{}` for a user, to spread into `changes`
 */
export const actorChanges = (
  principal: AuditActorInput | null | undefined,
): { apiKeyId?: string } =>
  principal?.apiKeyId ? { apiKeyId: principal.apiKeyId } : {};

/**
 * One `logAction` entry's actor part plus the request fields.
 *
 * @param principal - from auditPrincipal
 */
export const auditEntryActor = (
  principal: AuditActorInput | null | undefined,
): ActorFields & {
  ipAddress: string | null;
  userAgent: string | null;
} => ({
  ...actorFields(principal),
  ipAddress: principal?.ipAddress ?? null,
  userAgent: principal?.userAgent ?? null,
});

/**
 * Who a DATA row names as its actor (Q-51): a user's id in the user column,
 * or a key's id in the row's `api_key_id` column — never a key's id in a
 * column that references `users` (it fails the foreign key on PostgreSQL).
 * A database CHECK on each such table holds exactly one of the two set.
 */
export interface RowActor {
  /** For the row's user column (`performed_by`, `adjusted_by`, `requested_by`); null for a key. */
  readonly userId: string | null;
  /** For the row's `api_key_id`; null for a user. */
  readonly apiKeyId: string | null;
}

/**
 * @param principal - from auditPrincipal(req); never from the request body
 * @param userId - the caller's user id, for a service called without a principal
 * @returns the key alone for a key, else the user alone
 */
export const rowActor = (
  principal: AuditActorInput | null | undefined,
  userId?: string | null,
): RowActor =>
  principal?.apiKeyId
    ? { userId: null, apiKeyId: principal.apiKeyId }
    : { userId: principal?.userId ?? userId ?? null, apiKeyId: null };
