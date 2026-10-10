/**
 * P24-04 — the per-tenant upstream import key as the calibration-record actor (ADR-133 § 6, Am. 4;
 * spec MEMORY/specs/P19-05-calibration-dates.md § 9.1, § 9.2; docs/UPSTREAM/07 § 3; FT-101).
 *
 * An imported calibration date names the PERSON when its upstream user maps to an imported user of
 * the same tenant; only a row whose upstream user is NULL or was deleted upstream is recorded by the
 * tenant's import key (`api_key_id`), so 0105's one-actor CHECK holds and the trail says "recorded by
 * the import", not by someone who did not do it.
 *
 *  - `provisionImportKey`: the key, created by the import itself — name `upstream-import` (reserved:
 *    the key route refuses it), scope `calibration:write` only, expiring at the planned sign-off + 90
 *    days. Its secret is generated, hashed and DISCARDED: nobody ever holds it, so it can never be
 *    presented over HTTP (§ 9.2: "never used over HTTP"). Audited in its transaction. A second call
 *    while a usable key exists returns that key and writes nothing.
 *  - `importCalibrationPerformer`: who an imported record names — the person (with their snapshot)
 *    or the key (with the pseudonymous "Former upstream user #<n>" for a deleted upstream user, or
 *    "Upstream import" for a NULL one). A mapped user that is not found in the tenant is refused,
 *    never replaced by the key: that is a mapping defect, and attributing it would hide it.
 *  - `revokeImportKeys` / `importKeyRevoked`: the cutover's revocation (P30) and its runbook check.
 *
 * The DPIA gate holds here too: while `UPSTREAM_REAL_DATA_ALLOWED` is off, a run declared real can
 * neither provision the key nor resolve an actor with it (06-DPIA § 5).
 *
 * Every read runs in the caller's tenant context (the hooks) AND names the tenant explicitly.
 * Named exports only.
 */
import { createHash, randomBytes } from "crypto";
import type { CreationAttributes } from "sequelize";
import models from "../../models";
import { db } from "../../config";
import auditService from "../audit.service";
import apiKeyService from "../apiKey.service";
import { personSnapshotOf } from "../deviceRegister.service";
import { upstreamRealDataAllowed } from "../../config/upstream";
import { AppError } from "../../utils/appError.util";
import { CodedError } from "../../utils/codedError.util";
import type { AuditActorInput } from "../../utils/auditPrincipal.util";
import type { CalibrationPerformerSnapshot } from "../../utils/jsonShape.util";
import { IMPORT_KEY_GRACE_DAYS, IMPORT_KEY_NAME, IMPORT_KEY_SCOPES } from "../../constants/upstreamImportKey";
import type { UpstreamSqlImportDataClass } from "@callibrator/contracts/upstreamSqlImport";
import { toUserId, type TenantId } from "../../types/ids";
import type { ModelInstance } from "../../types/models";

type ApiKeyRow = ModelInstance<"ApiKey">;

/** The import's `code`s (top-level in an error answer). */
export const IMPORT_KEY_CODES = Object.freeze({
  realDataRefused: "UPSTREAM_REAL_DATA_REFUSED",
  keyMissing: "IMPORT_KEY_MISSING",
  performerNotFound: "IMPORT_PERFORMER_NOT_FOUND",
});

/** The snapshot name of a record whose upstream user is NULL (the import recorded it). */
export const NULL_USER_PERFORMER = "Upstream import";

const DAY_MS = 86_400_000;

/**
 * Refuses a run declared real while the DPIA gate is off.
 *
 * @param dataClass - the run's declared class
 * @throws CodedError 403 `UPSTREAM_REAL_DATA_REFUSED`
 */
export const assertImportDataAllowed = (dataClass: UpstreamSqlImportDataClass): void => {
  if (dataClass === "real" && !upstreamRealDataAllowed()) {
    throw new CodedError(
      403,
      IMPORT_KEY_CODES.realDataRefused,
      "The run is declared real upstream data and UPSTREAM_REAL_DATA_ALLOWED is off (DPIA gates R-01, R-03, R-17). Only synthetic data may be imported.",
    );
  }
};

/** A key as the import reports it: never the key or its hash. */
export interface ImportKeyView {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
  readonly isActive: boolean;
}

const viewOf = (key: ApiKeyRow): ImportKeyView => ({
  id: key.id,
  name: key.name,
  keyPrefix: key.keyPrefix,
  scopes: [...key.scopes],
  expiresAt: key.expiresAt,
  isActive: key.isActive,
});

/** Whether a key is the import key and may still record: active, unexpired, `calibration:write` alone. */
const usable = (key: ApiKeyRow, now: number): boolean =>
  key.isActive &&
  key.expiresAt !== null &&
  new Date(key.expiresAt).getTime() > now &&
  key.scopes.length === IMPORT_KEY_SCOPES.length &&
  key.scopes.every((s, i) => s === IMPORT_KEY_SCOPES[i]);

/** The tenant's import keys not yet revoked (the defaultScope hides a soft-deleted one). */
const liveImportKeys = (tenantId: TenantId): Promise<ApiKeyRow[]> =>
  models.ApiKey.findAll({ where: { tenantId, name: IMPORT_KEY_NAME, isActive: true }, order: [["createdAt", "DESC"], ["id", "DESC"]] });

/** The provisioning's input. */
export interface ProvisionImportKeyInput {
  /** The planned sign-off day, `YYYY-MM-DD` (UTC); the key expires 90 days after it. */
  readonly signOffDate: string;
  /** The run's declared class (the DPIA gate). */
  readonly dataClass: UpstreamSqlImportDataClass;
}

/** The key's expiry: the sign-off day + 90 days, refused when malformed or not in the future. */
const expiryOf = (signOffDate: string, now: number): Date => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(signOffDate);
  const at = day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : Number.NaN;
  if (!day || new Date(at).toISOString().slice(0, 10) !== signOffDate) {
    throw new AppError(400, "signOffDate must be a calendar day, YYYY-MM-DD.");
  }
  const expiresAt = new Date(at + IMPORT_KEY_GRACE_DAYS * DAY_MS);
  if (expiresAt.getTime() <= now) {
    throw new AppError(400, `The import key would already be expired: the sign-off + ${String(IMPORT_KEY_GRACE_DAYS)} days is in the past.`);
  }
  return expiresAt;
};

/**
 * The tenant's import key: the usable one, or a new one (audited, secret discarded).
 *
 * @param tenantId - the provider tenant (stamped by the caller, never from a body)
 * @param input - the planned sign-off and the run's class
 * @param actor - the operator who starts the load
 * @returns the key's public view and whether it was created now
 */
export const provisionImportKey = async (
  tenantId: TenantId,
  input: ProvisionImportKeyInput,
  actor: { readonly userId: string },
): Promise<{ key: ImportKeyView; created: boolean }> => {
  assertImportDataAllowed(input.dataClass);
  const now = Date.now();
  const expiresAt = expiryOf(input.signOffDate, now);
  const existing = (await liveImportKeys(tenantId)).find((k) => usable(k, now));
  if (existing) {
    return { key: viewOf(existing), created: false };
  }
  // Generated and hashed as any key, then dropped: the import key authenticates nothing.
  const secret = `cbk_${randomBytes(28).toString("hex")}`;
  const key = await db.transaction(async (transaction) => {
    const values: CreationAttributes<ApiKeyRow> = {
      tenantId,
      name: IMPORT_KEY_NAME,
      keyPrefix: secret.slice(0, 12),
      keyHash: createHash("sha256").update(secret).digest("hex"),
      scopes: [...IMPORT_KEY_SCOPES],
      expiresAt,
      createdBy: toUserId(actor.userId),
    };
    const created = await models.ApiKey.create(values, { transaction });
    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId,
        action: "CREATE",
        resourceType: "ApiKey",
        resourceId: created.id,
        changes: {
          operation: "IMPORT_KEY_CREATE",
          name: IMPORT_KEY_NAME,
          keyPrefix: created.keyPrefix,
          scopes: [...IMPORT_KEY_SCOPES],
          expiresAt,
          signOffDate: input.signOffDate,
        },
      },
      { transaction },
    );
    return created;
  });
  return { key: viewOf(key), created: true };
};

/**
 * The import key as an actor, for the ETL's calls into the record services.
 *
 * @param tenantId - the provider tenant
 * @param dataClass - the run's declared class
 * @returns the key principal (no user, no request)
 * @throws CodedError 409 `IMPORT_KEY_MISSING` when no usable key exists
 */
export const importKeyActor = async (tenantId: TenantId, dataClass: UpstreamSqlImportDataClass): Promise<AuditActorInput> => {
  assertImportDataAllowed(dataClass);
  const key = (await liveImportKeys(tenantId)).find((k) => usable(k, Date.now()));
  if (!key) {
    throw new CodedError(
      409,
      IMPORT_KEY_CODES.keyMissing,
      "This tenant has no usable import key (none provisioned, revoked at cutover, or expired). Provision it before loading calibration dates.",
    );
  }
  return { userId: null, apiKeyId: key.id, ipAddress: null, userAgent: null };
};

/** Who an imported record's upstream user is, as the ETL's `id_map` resolved it. */
export type UpstreamPerformer =
  /** The upstream user maps to this imported user of the same tenant. */
  | { readonly kind: "user"; readonly userId: string }
  /** The upstream user was hard-deleted: its per-migration sequence number (07 § 3), never the upstream id. */
  | { readonly kind: "former"; readonly sequence: number }
  /** `id_user` is NULL upstream. */
  | { readonly kind: "none" };

/** The actor and snapshot an imported calibration record is written with. */
export interface ImportedPerformer {
  readonly actor: AuditActorInput;
  readonly performerSnapshot: CalibrationPerformerSnapshot;
}

/**
 * Who an imported calibration record names (§ 9.1): the person, else the import key.
 *
 * @param tenantId - the provider tenant
 * @param performer - the upstream user as mapped
 * @param keyActor - from `importKeyActor` (resolved once per run)
 * @returns the actor and the performer's snapshot, `source: "upstream-import"`
 * @throws CodedError 409 `IMPORT_PERFORMER_NOT_FOUND` for a mapped user not in the tenant
 */
export const importCalibrationPerformer = async (
  tenantId: TenantId,
  performer: UpstreamPerformer,
  keyActor: AuditActorInput,
): Promise<ImportedPerformer> => {
  if (performer.kind === "user") {
    // In context AND by tenant: another tenant's user, or one deleted here, is not found.
    const user = await models.User.findOne({ where: { id: performer.userId, tenantId }, attributes: ["id"] });
    if (!user) {
      throw new CodedError(
        409,
        IMPORT_KEY_CODES.performerNotFound,
        "The mapped user is not a user of this tenant; the record is not attributed to the import key in their place. Fix the user mapping.",
      );
    }
    const person = (await personSnapshotOf(user.id)) as NonNullable<Awaited<ReturnType<typeof personSnapshotOf>>>;
    return { actor: { userId: user.id, apiKeyId: null, ipAddress: null, userAgent: null }, performerSnapshot: { ...person, source: "upstream-import" } };
  }
  if (!keyActor.apiKeyId) {
    throw new AppError(500, "The import key actor is required for a record with no resolvable person.");
  }
  if (performer.kind === "former") {
    if (!Number.isInteger(performer.sequence) || performer.sequence < 1) {
      throw new AppError(400, "A former upstream user's sequence number is a positive integer.");
    }
    return {
      actor: keyActor,
      performerSnapshot: { name: `Former upstream user #${String(performer.sequence)}`, role: null, organisation: null, source: "upstream-import" },
    };
  }
  const tenant = await models.Tenant.findOne({ where: { id: tenantId }, attributes: ["id", "name"] });
  return {
    actor: keyActor,
    performerSnapshot: { name: NULL_USER_PERFORMER, role: "import", organisation: tenant?.name ?? null, source: "upstream-import" },
  };
};

/**
 * The cutover's revocation (P30, FT-101): every live import key of the tenant, each audited.
 *
 * @param tenantId - the provider tenant
 * @param actor - the operator
 * @returns the ids revoked (none when already revoked)
 */
export const revokeImportKeys = async (tenantId: TenantId, actor: { readonly userId: string }): Promise<string[]> => {
  const revoked: string[] = [];
  for (const key of await liveImportKeys(tenantId)) {
    await apiKeyService.revokeApiKey(tenantId, key.id, { userId: actor.userId });
    revoked.push(key.id);
  }
  return revoked;
};

/**
 * The runbook check after cutover: no import key of the tenant can record any more.
 *
 * @param tenantId - the provider tenant
 * @returns true when no live import key remains
 */
export const importKeyRevoked = async (tenantId: TenantId): Promise<boolean> => (await liveImportKeys(tenantId)).length === 0;
