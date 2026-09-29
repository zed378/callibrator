import { AsyncLocalStorage } from "async_hooks";

/**
 * F-8 — who is really acting when a super admin impersonates a user.
 *
 * impersonateUser (auth.service.js) issues the hospital user's access token
 * with an `impersonatorId` claim. The auth middleware reads that claim from the
 * VERIFIED token — never from a body, a header or a query — exposes it as
 * `req.impersonatorId`, and runs the rest of the request inside this context.
 *
 * The context exists because most services build their audit entry from
 * chosen fields (`userId: actor.userId, ipAddress: actor.ipAddress, ...`) and
 * would drop a new field of the actor on the floor. audit.service#logAction
 * reads the context when its caller passed no impersonator, so every audit row
 * written during an impersonated request names the operator without each
 * service having to be changed. Outside a request (a cron job, a queue
 * consumer) the context is empty and the row records none.
 *
 * P9-09 (ADR-087): converted from auditActor.util.js with no behaviour change.
 */

interface ImpersonationStore {
  impersonatorId: string | null;
}

const impersonationStorage = new AsyncLocalStorage<ImpersonationStore>();

/**
 * The request fields `auditActor` reads. Structural, so both an Express
 * request and the plain objects services and tests pass satisfy it;
 * `impersonatorId` is set by auth.middleware.js from the verified token.
 */
export interface AuditActorRequest {
  readonly user?: { readonly id?: string | null; readonly tenantId?: string | null } | null | undefined;
  readonly ip?: string | null | undefined;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>> | null | undefined;
  readonly impersonatorId?: string | null | undefined;
}

/** The actor an audit row records. */
export interface AuditActor {
  userId: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | string[] | null;
  impersonatorId?: string;
}

/**
 * Run `fn` with `impersonatorId` as the current request's impersonator.
 *
 * @param impersonatorId - from the verified token claim only
 */
const runWithImpersonator = <T>(impersonatorId: string | null | undefined, fn: () => T): T =>
  // `||`: an empty claim is no impersonator, as before.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
  impersonationStorage.run({ impersonatorId: impersonatorId || null }, fn);

/**
 * @returns the impersonating super admin of the current request, or null
 */
const currentImpersonatorId = (): string | null => {
  const store = impersonationStorage.getStore();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
  return store?.impersonatorId || null;
};

/**
 * The actor of a request, for the audit row a service writes inside its
 * transaction (A-41, MEMORY/specs/A-41-audit-inside-transaction.md).
 *
 * `tenantId` is the actor's HOME tenant (req.user.tenantId), not a SUPER_ADMIN
 * x-tenant-id override: it is where a change to a global resource (a role) is
 * recorded (BR-A41-4). Missing values are null, never undefined — and a null
 * tenant makes the audit insert fail and the change roll back, which is the
 * intended fail-closed behaviour, not something to paper over here.
 *
 * `userId` is the principal the token names — under impersonation, the
 * impersonated user. `impersonatorId` (F-8) is the super admin actually acting,
 * set by the auth middleware from the verified token claim.
 *
 * `impersonatorId` is present only on an impersonated request — the one
 * exception to "null, never undefined". The actor of an ordinary request keeps
 * the four-field shape every service and test was written against, and nothing
 * is lost by its absence: audit.service#logAction takes the impersonator from
 * the request context when the entry names none.
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3): every empty value becomes null */
const auditActor = (req: AuditActorRequest): AuditActor => ({
  userId: req.user?.id || null,
  tenantId: req.user?.tenantId || null,
  ipAddress: req.ip || null,
  userAgent: req.headers?.["user-agent"] || null,
  ...(req.impersonatorId ? { impersonatorId: req.impersonatorId } : {}),
});
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

export { auditActor, runWithImpersonator, currentImpersonatorId };
