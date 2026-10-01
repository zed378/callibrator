// P9-13 (ADR-087, Stage C; converted under the four isolation gates): from
// tenantBackup.service.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order); the
// functions call each other directly, as before. `fs`, `path`, `crypto`,
// JSZip, moment and the `sequelize` package are the module objects themselves
// (default imports of CommonJS modules), so the tests' spies and mocks on them
// still apply. The three models, `Op`, the logger, the three error classes
// and `storagePath` are captured once at load, as the `.js` destructured them;
// `auditService` is the module object. The two `require("../models")`
// fallbacks stay lazy, inside the functions that use them.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import JSZip from "jszip";
import moment from "moment";
import type { Transaction, WhereOptions } from "sequelize";

// Simplified tenant backup service - removed deprecated models (TenantSettings, TenantRoles, TenantFeatures, TenantAuditLog, UserPermissions)
import models from "../models";
import auditService from "./audit.service";
// Sequelize helpers come from the package directly (not the models barrel) so
// they are available even when `../models` is mocked in unit tests.
import Sequelize from "sequelize";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import {
  AppError as LoadedAppError,
  ConflictError as LoadedConflictError,
  InternalServerError as LoadedInternalServerError,
} from "../utils/appError.util";
import loadedStoragePath from "../utils/storagePath.util";
import { env } from "../config/env";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, ModelsBarrel } from "../types/models";

const { TenantBackup, Tenant, Users } = models;
const { Op } = Sequelize;
const logger = loadedLogger;
const AppError = LoadedAppError;
const ConflictError = LoadedConflictError;
const InternalServerError = LoadedInternalServerError;
const storagePath = loadedStoragePath;

type BackupRow = ModelInstance<"TenantBackup">;

/**
 * The request-scoped models bag the controllers pass (the barrel itself).
 * Only these members are read; `sequelize` may be absent (a test double), in
 * which case the barrel's is required on demand.
 */
interface ModelsBag {
  sequelize?: ModelsBarrel["sequelize"];
  Users: ModelsBarrel["Users"];
  Tenants: ModelsBarrel["Tenants"];
}

/** A backed-up user row, read from an archive: untrusted, any shape. */
interface ArchivedUser {
  id?: unknown;
  username?: unknown;
  email?: unknown;
  [field: string]: unknown;
}

/** The parsed archive payload: untrusted, checked by assertRestorable. */
interface ArchiveData {
  metadata?: { backupType?: unknown; version?: unknown; [key: string]: unknown } | null;
  tenant?: { id?: unknown; [key: string]: unknown } | null;
  users?: unknown;
}

/** The export written into an archive. */
interface ExportData {
  metadata: {
    version: string;
    exportedAt: string;
    exportedBy: null;
    tenantId: TenantId;
    backupType: string;
    applicationVersion: string;
  };
  tenant: Record<string, unknown> | null;
  users: Record<string, unknown>[];
}

/** The service's answer (the controller sends it through success()). */
interface BackupResult<T = unknown> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** A restore's per-account outcome. */
interface ReconcileOutcome {
  updated: number;
  unchanged: number;
  skippedDeleted: number;
}

/** An archive entry a restore did not re-create, and why. */
interface NotRestored {
  entry: number;
  username: unknown;
  reason: string;
}

/** The message of whatever was thrown, read as the `.js` read `error.message`. */
const messageOf = (error: unknown): string => (error as Error).message;

/**
 * Backup storage directory
 */
const BACKUP_DIR = storagePath("backup", "tenant-backups");

/**
 * Ensure backup directory exists
 * Returns true if directory exists or was created successfully
 */
function ensureBackupDirExists(): boolean {
  if (!fs.existsSync(BACKUP_DIR)) {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") {
        return false;
      }
      return true;
    }
  }
  return true;
}

/**
 * The Sequelize instance transactions run on: the request's, else the barrel's.
 * @param models - the request-scoped models bag
 */
const sequelizeOf = (models: ModelsBag | null | undefined): ModelsBarrel["sequelize"] =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain, @typescript-eslint/no-require-imports -- as built: `(models && models.sequelize) || require("../models").sequelize`, the barrel loaded on demand
  (models && models.sequelize) || (require("../models") as ModelsBarrel).sequelize;

/**
 * Generate a unique backup filename
 */
function generateBackupFilename(tenantId: string, backupId: string): string {
  const timestamp = moment().format("YYYYMMDD_HHmmss");
  return `tenant_${tenantId}_${backupId}_${timestamp}.zip`;
}

/**
 * Calculate file checksum
 */
async function calculateChecksum(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("data", (data) => {
      hash.update(data);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
    stream.on("error", reject);
  });
}

/**
 * The user attributes a backup archive may carry: an ALLOW-list (A-139).
 *
 * The export used to be a deny-list (`exclude: ["password", ...]`), so every
 * other column went into a file an administrator downloads: the TOTP seed
 * (`mfaSecret`, `mfaPendingSecret`), `otpCode`, the WebAuthn credential and
 * the lockout counters. An allow-list inverts the failure: a column added to
 * the model later is left OUT until someone decides a backup needs it.
 *
 * What is here is what a restore matches on (`username`, `email`), what it
 * may write back onto a live account (`RESTORE_UPDATE_FIELDS`), and what an
 * administrator needs to re-invite an account a restore does not re-create
 * (ADR-051 Q-09): id, role and state. Never a credential, a second factor, a
 * one-time code or lockout state — `tenantBackup.secrets.a139.test.js` checks
 * this list against `Users.rawAttributes`.
 */
const USER_EXPORT_ATTRIBUTES = Object.freeze([
  "id",
  "tenantId",
  "roleId",
  "username",
  "email",
  "firstName",
  "lastName",
  "phone",
  "avatarUrl",
  "isActive",
  "status",
]);

/**
 * The tenant attributes a backup archive may carry: an ALLOW-list (A-139).
 *
 * `settings` is deliberately absent. `tenant.service#updateTenantSettings`
 * mirrors every `tenant_settings` row into that JSONB column after reading them
 * through the model's decrypting `afterFind` hook, so the column can hold
 * KMS-protected credentials (bring-your-own-bucket keys, SSO secrets) in
 * plaintext. A restore does not need it: it reads only `tenant.id`, to refuse
 * an archive taken from another tenant (`assertRestorable`), and never writes
 * the tenant row. Neither the plaintext nor an encrypted blob is exported.
 */
const TENANT_EXPORT_ATTRIBUTES = Object.freeze([
  "id",
  "name",
  "subdomain",
  "code",
  "email",
  "domain",
  "plan",
  "status",
  "parentId",
]);

/**
 * Copy the named fields of a row, keeping nulls (an export records a null
 * phone as null). A second line of defence behind the SELECT list: whatever a
 * row object carries, only allow-listed keys reach the archive.
 *
 * @param row - a model instance
 * @param fields - the allow-list
 * @returns the projected plain object
 */
function projectForExport(row: { toJSON: () => object }, fields: readonly string[]): Record<string, unknown> {
  const plain = row.toJSON() as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(plain, field)) {
      out[field] = plain[field];
    }
  }
  return out;
}

/**
 * P7-04 drill finding D-3 (ADR-078): the API validator and the UI send
 * "FULL" / "USER_ONLY"; the model constants (and the scheduled backup) are
 * "full" / "user_only". Compared case-sensitively, every backup taken through
 * the API exported NO users — a "full" backup of the tenant row alone.
 *
 * @param value - a backupType as stored or sent
 * @param type - a TenantBackup.BACKUP_TYPES value
 */
const isBackupType = (value: unknown, type: string): boolean => typeof value === "string" && value.toLowerCase() === type;

/**
 * Export tenant data to JSON structure (simplified)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: the third parameter is accepted and not read
async function exportTenantData(tenantId: TenantId, backupType: string, _models?: ModelsBag): Promise<ExportData> {
  const data: ExportData = {
    metadata: {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      exportedBy: null,
      tenantId,
      backupType,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty version reads as 1.0.0
      applicationVersion: env("npm_package_version") || "1.0.0",
    },
    tenant: null,
    users: [],
  };

  // Export tenant data
  const tenant = await Tenant.findByPk(tenantId, {
    attributes: [...TENANT_EXPORT_ATTRIBUTES],
  });
  if (tenant) {
    data.tenant = projectForExport(tenant, TENANT_EXPORT_ATTRIBUTES);
  }

  if (
    isBackupType(backupType, TenantBackup.BACKUP_TYPES.FULL) ||
    isBackupType(backupType, TenantBackup.BACKUP_TYPES.USER_ONLY)
  ) {
    // A-139: only allow-listed columns are selected, and only allow-listed
    // keys are written — never a credential or second factor.
    const users = await Users.findAll({
      where: { tenantId },
      attributes: [...USER_EXPORT_ATTRIBUTES],
    });
    data.users = users.map((u) => projectForExport(u, USER_EXPORT_ATTRIBUTES));
  }

  return data;
}

/**
 * Create a backup for a tenant
 */
interface CreateBackupInput {
  tenantId: TenantId;
  // P9-20: `undefined` admitted on the optional fields, as a request body gives it (type-only).
  createdById?: UserId | null | undefined;
  name?: string | null | undefined;
  description?: string | null | undefined;
  backupType?: string | undefined;
  retentionDays?: number | undefined;
  tag?: string | null | undefined;
  models: ModelsBag;
}

async function createBackup({
  tenantId,
  createdById,
  name,
  description,
  backupType = TenantBackup.BACKUP_TYPES.FULL,
  retentionDays = TenantBackup.DEFAULT_RETENTION_DAYS,
  tag,
  models,
}: CreateBackupInput): Promise<BackupResult> {
  // Validate tenant exists
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // Create backup record
  // As built: the optional fields are passed through as given (undefined when absent).
  const createData = {
    tenantId,
    createdById,
    name,
    description,
    backupType,
    retentionDays,
    tag,
  };
  const backup = await TenantBackup.createBackup(
    createData as Parameters<typeof TenantBackup.createBackup>[0],
    models,
  );

  // Update status to in progress
  await TenantBackup.updateStatus(
    backup.id,
    {
      status: TenantBackup.STATUS.IN_PROGRESS,
    },
    models,
  );

  try {
    // Export data
    const exportData = await exportTenantData(tenantId, backupType, models);

    // Create ZIP file
    const zip = new JSZip();
    const filename = `tenant_data_${backupType.toLowerCase()}.json`;
    zip.file(filename, JSON.stringify(exportData, null, 2));

    // Add metadata file
    zip.file(
      "backup_metadata.json",
      JSON.stringify(
        {
          backupId: backup.id,
          tenantId,
          createdById,
          createdAt: new Date().toISOString(),
          backupType,
          retentionDays,
          tag,
          description,
        },
        null,
        2,
      ),
    );

    // Generate ZIP
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Ensure backup directory exists
    ensureBackupDirExists();

    // Save to file
    const filenameStr = generateBackupFilename(tenantId, backup.id);
    const filePath = path.join(BACKUP_DIR, filenameStr);
    fs.writeFileSync(filePath, zipBuffer);

    // Calculate checksum
    const checksum = await calculateChecksum(filePath);

    // Count records (simplified - only users now)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `exportData.users?.length || 0`
    const recordCount = exportData.users?.length || 0;

    // S-32: COMPLETED, its expiry and its audit row commit together.
    //  - `retentionDays` makes updateStatus stamp `expiresAt`; the HTTP path
    //    used to leave it NULL, so the pruner had to guess from createdAt.
    //  - a backup a USER took is attributed here, inside the transaction. A
    //    system actor (the scheduled job: createdById null) writes its own
    //    CREATE row with `systemActor` — scheduledBackup.service#backupTenant —
    //    so there is exactly one audit row either way.
    await sequelizeOf(models).transaction(async (transaction: Transaction) => {
      await TenantBackup.updateStatus(
        backup.id,
        {
          status: TenantBackup.STATUS.COMPLETED,
          filePath,
          fileSize: zipBuffer.length,
          recordCount,
          retentionDays,
          metadata: {
            checksum,
            filename: filenameStr,
            exportedAt: new Date().toISOString(),
            dataVersion: exportData.metadata.version,
          },
        },
        models,
        { transaction },
      );
      if (createdById) {
        await auditService.logAction(
          {
            tenantId,
            userId: createdById,
            action: "CREATE",
            resourceType: "TenantBackup",
            resourceId: backup.id,
            changes: {
              operation: "BACKUP",
              backupType,
              fileName: filenameStr,
              fileSize: zipBuffer.length,
              recordCount,
              retentionDays,
            },
          },
          { transaction },
        );
      }
    });

    logger.info("Tenant backup created", {
      backupId: backup.id,
      tenantId,
      backupType,
      recordCount,
      fileSize: zipBuffer.length,
    });

    return {
      success: true,
      status: 201,
      message: "Backup created successfully",
      data: await TenantBackup.findByPk(backup.id, {
        include: [
          {
            model: models.Users,
            as: "creator",
            attributes: ["id", "username", "email"],
            // A-90: LEFT JOIN — a backup whose creator is deleted or outside
            // the tenant (the super admin) is still returned.
            required: false,
          },
        ],
      }),
    };
  } catch (error) {
    // Update backup record with error
    await TenantBackup.updateStatus(
      backup.id,
      {
        status: TenantBackup.STATUS.FAILED,
        errorMessage: messageOf(error),
      },
      models,
    );

    logger.error("Tenant backup failed", {
      backupId: backup.id,
      tenantId,
      error: messageOf(error),
    });

    throw new InternalServerError("Failed to create backup: " + messageOf(error));
  }
}

/**
 * Download a backup file
 */
async function downloadBackup(backupId: string, models: ModelsBag): Promise<BackupResult<{ filePath: string; metadata: BackupRow }>> {
  const backup = await TenantBackup.findByPk(backupId, {
    // A-90: LEFT JOINs, as in restoreBackup — a backup whose creator is
    // deleted or outside the tenant, or whose tenant row is soft-deleted, is
    // still downloadable; neither relation is read below.
    include: [
      {
        model: models.Tenants,
        as: "tenant",
        required: false,
      },
      {
        model: models.Users,
        as: "creator",
        required: false,
      },
    ],
  });

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  if (backup.status !== TenantBackup.STATUS.COMPLETED) {
    throw new AppError(400, "Backup is not ready for download");
  }

  if (!backup.filePath || !fs.existsSync(backup.filePath)) {
    throw new AppError(404, "Backup file not found on storage");
  }

  return {
    success: true,
    status: 200,
    message: "Backup ready for download",
    data: {
      filePath: backup.filePath,
      metadata: backup,
    },
  };
}

/* ------------------------------------------------------------------ */
/* RESTORE                                                            */
/* ------------------------------------------------------------------ */

/**
 * Why a backed-up account was not restored (ADR-051 Q-09, A-120).
 *
 * A restore never CREATES an account. An account that is in the archive but
 * matches nothing in the tenant can only be one whose natural key has gone:
 * hard-deleted, or anonymised by a GDPR erasure (`gdpr.service#anonymizeUser`
 * rewrites the username and email). Re-creating it from the archive would put
 * an erased person's name, email and phone back into the live database the
 * moment the restore commits — the restore tool would reverse the erasure (F-1).
 * The re-created account would also have a new id, so it would re-link to none
 * of its history; nothing is recovered that an administrator re-inviting the
 * person through the ordinary user-create path does not also recover.
 *
 * - `erased`: the archived account's id is still in the tenant, anonymised.
 *   It must not be re-invited: the person asked to be forgotten.
 * - `absent`: no account in the tenant carries this username or email.
 */
const NOT_RESTORED_REASONS = Object.freeze({
  ERASED: "erased",
  ABSENT: "absent",
});

/** The status `gdpr.service#anonymizeUser` leaves on an erased account. */
const ERASED_USER_STATUS = "erased";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fields a restore may write onto an account that ALREADY EXISTS — the
 * only kind of account a restore writes at all (A-120).
 *
 * A backup file is caller-supplied data (D-02): nothing outside this list is
 * ever read from it into a row. `username` and `email` are the
 * natural key the row was matched on, so rewriting them is meaningless.
 * `roleId`, `isActive` and `status` are privilege state: a file that could
 * raise the role of a live, active account would be a privilege-escalation
 * primitive, which is the abuse D-02 describes. A restore updates the profile;
 * it does not re-grant access.
 */
const RESTORE_UPDATE_FIELDS = ["firstName", "lastName", "phone", "avatarUrl"];

/** Columns a backed-up user row must carry before it can be written at all. */
const REQUIRED_BACKUP_USER_FIELDS = [
  "username",
  "email",
  "firstName",
  "lastName",
];

/**
 * Copy only the named fields out of an untrusted object.
 * A field that is absent or null is left out so the model default applies.
 */
function pickFields(source: ArchivedUser, fields: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      picked[field] = source[field];
    }
  }
  return picked;
}

/**
 * Decide whether this archive may be restored into this tenant at all.
 *
 * Every refusal here is a 409 carrying a state explanation that names the
 * problem, per the status-code table: the request is well formed and the caller
 * is permitted, but the backup and the target tenant are in states that cannot
 * be reconciled. Reporting these as a 500 would hide a design gap behind a
 * stack trace. None of these refusals touches a row, and none of them marks the
 * backup FAILED, because nothing was attempted.
 *
 * @param args - the restore being validated: `backupId`, the backup being
 *   restored; `backup`, the backup row (server-side truth); `data`, the parsed
 *   archive payload (untrusted); `targetTenantId`, the tenant that owns the
 *   backup row
 */
/* eslint-disable @typescript-eslint/restrict-template-expressions -- as built: the archive's own values are interpolated as given */
function assertRestorable({
  backupId,
  backup,
  data,
  targetTenantId,
}: {
  backupId: string;
  backup: BackupRow;
  data: ArchiveData;
  targetTenantId: string | null;
}): void {
  if (!targetTenantId) {
    throw new ConflictError(
      `Backup ${backupId} has no owning tenant recorded, so there is no tenant to restore it into. ` +
        "A restore always targets the tenant that owns the backup row; the tenant named inside the archive is never used.",
    );
  }

  if (!data.metadata || !data.tenant) {
    throw new ConflictError(
      `Backup ${backupId} cannot be restored: its archive is missing the ` +
        `${!data.metadata ? "metadata" : "tenant"} section, so there is nothing to reconcile against.`,
    );
  }

  // The archive names a tenant. So does the backup row. When they disagree the
  // archive is the one that must be refused — the alternative is writing rows
  // into whatever tenant a file names, which is exactly D-02.
  if (data.tenant.id !== targetTenantId) {
    throw new ConflictError(
      `Backup ${backupId} belongs to tenant ${targetTenantId}, but its archive was taken from tenant ${data.tenant.id}. ` +
        "A backup can only be restored into the tenant that owns it; nothing has been written.",
    );
  }

  if (data.users !== undefined && !Array.isArray(data.users)) {
    throw new ConflictError(
      `Backup ${backupId} cannot be restored: its archive has a "users" section that is not a list.`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
  const backupType = data.metadata.backupType || backup.backupType;
  if (
    isBackupType(backupType, TenantBackup.BACKUP_TYPES.FULL) &&
    !Array.isArray(data.users)
  ) {
    throw new ConflictError(
      `Backup ${backupId} is recorded as a "full" backup but its archive carries no "users" section. ` +
        'A "full" tenant backup contains the tenant row and its user accounts and nothing else — ' +
        "no devices, calibrations, certificates, attachments or stock — so with the users missing there is nothing left in it to restore.",
    );
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `data.users || []` (a list here, checked above)
  for (const [index, user] of ((data.users || []) as ArchivedUser[]).entries()) {
    const missing = REQUIRED_BACKUP_USER_FIELDS.filter((field) => !user[field]);
    if (missing.length > 0) {
      throw new ConflictError(
        `Backup ${backupId} cannot be restored: user entry ${String(index)} is missing ${missing.join(", ")}. ` +
          "A user row is matched and written by these fields, so an entry without them cannot be reconciled; nothing has been written.",
      );
    }
  }
}
/* eslint-enable @typescript-eslint/restrict-template-expressions */

/**
 * Reconcile the backed-up users into the target tenant. Never creates, never
 * deletes.
 *
 * WHAT A RESTORE MEANS FOR A USER PRESENT IN BOTH the archive and the tenant:
 *   - `mergeData: false` (the default, "restore"): the live row is KEPT and its
 *     profile fields are updated from the backup. Its credential, its role and
 *     its active/suspended state are left exactly as they are.
 *   - `mergeData: true` ("merge"): the live row is left completely untouched.
 *
 * WHAT NEVER HAPPENS, in either mode:
 *   - No account is created (ADR-051 Q-09, A-120). An account in the archive
 *     that matches nothing in the tenant is reported in `notRestored` with a
 *     reason (`NOT_RESTORED_REASONS`) and left for an administrator to
 *     re-invite through the ordinary user-create path — or, for an erased
 *     person, not at all.
 *   - No account is deleted. An account created after the backup was taken —
 *     the case that made this path destructive (S-02) — is not in the archive,
 *     is therefore never matched, and survives untouched. It is counted as
 *     `retained` so the operator can see what was not restored over.
 *   - No live password is overwritten. The export has no hashes to restore.
 *   - A soft-deleted account matching a backed-up natural key is NOT revived.
 *     Reviving an account an administrator deleted is a grant of access and an
 *     owner decision, not a side effect of a restore. It is counted as
 *     `skippedDeleted`.
 *
 * @param args - the reconciliation inputs: `users`, the backed-up user rows
 *   (untrusted); `targetTenantId`, the tenant the backup belongs to;
 *   `mergeData`, true to leave matched accounts untouched, false to update
 *   their profiles; `transaction`, the enclosing transaction
 * @returns per-account outcome counts, and the archive entries that were not restored
 */
async function reconcileUsers({
  users,
  targetTenantId,
  mergeData,
  transaction,
}: {
  users: ArchivedUser[];
  targetTenantId: TenantId;
  mergeData: boolean;
  transaction: Transaction;
}): Promise<{ outcome: ReconcileOutcome; notRestored: NotRestored[] }> {
  const outcome: ReconcileOutcome = { updated: 0, unchanged: 0, skippedDeleted: 0 };
  const notRestored: NotRestored[] = [];

  for (const [index, user] of users.entries()) {
    // The natural key. `Op` here is the STATIC operator set from the sequelize
    // package (imported at the top of this file). The previous merge branch
    // read `sequelize.Op.or` off a Sequelize INSTANCE, where `.Op` is
    // undefined, so it threw a TypeError before touching a row — the merge path
    // had never run.
    //
    // Unscoped and non-paranoid on purpose: the default scope hides `isDeleted`
    // rows and paranoid hides `deletedAt` rows, and both still hold the
    // globally unique username/email. They have to be seen in order to be
    // skipped.
    // As built: the archive's username and email are matched as given.
    const where = {
      tenantId: targetTenantId,
      [Op.or]: [{ username: user.username }, { email: user.email }],
    };
    const live = await Users.unscoped().findOne({
      where: where as WhereOptions,
      paranoid: false,
      transaction,
    });

    if (!live) {
      notRestored.push({
        entry: index,
        username: user.username,
        reason: await notRestoredReason(user, targetTenantId, transaction),
      });
      continue;
    }

    if (live.isDeleted || live.deletedAt) {
      outcome.skippedDeleted += 1;
      continue;
    }

    if (mergeData) {
      outcome.unchanged += 1;
      continue;
    }

    await live.update(pickFields(user, RESTORE_UPDATE_FIELDS), { transaction });
    outcome.updated += 1;
  }

  return { outcome, notRestored };
}

/**
 * Why an archived account matched nothing in the tenant.
 *
 * An erasure anonymises the row IN PLACE (`gdpr.service#anonymizeUser`), so
 * the archived id still resolves to it. Telling the administrator "erased"
 * rather than "absent" is what stops them re-inviting a person who asked to be
 * forgotten. The id comes from the archive, so it is shape-checked before it
 * reaches the query: a malformed uuid would abort the whole transaction.
 *
 * @param user - the archived user row (untrusted)
 * @param targetTenantId - the tenant the backup belongs to
 * @param transaction - the enclosing transaction
 * @returns one of NOT_RESTORED_REASONS
 */
async function notRestoredReason(user: ArchivedUser, targetTenantId: TenantId, transaction: Transaction): Promise<string> {
  if (typeof user.id !== "string" || !UUID_PATTERN.test(user.id)) {
    return NOT_RESTORED_REASONS.ABSENT;
  }
  const byId = await Users.unscoped().findOne({
    where: { id: user.id, tenantId: targetTenantId },
    attributes: ["id", "status"],
    paranoid: false,
    transaction,
  });
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  return byId && byId.status === ERASED_USER_STATUS
    ? NOT_RESTORED_REASONS.ERASED
    : NOT_RESTORED_REASONS.ABSENT;
}

/**
 * Restore a backup into the tenant that owns it.
 *
 * This is a non-destructive reconciliation, not a replace. See
 * `reconcileUsers` for what a restore means for each account, and
 * `assertRestorable` for the states that are refused with a 409.
 *
 * @param args - the restore request: `backupId`, the backup to restore;
 *   `restoredById`, the acting user, for the audit row; `mergeData`, true to
 *   add only, false to also update profiles; `models`, the request-scoped
 *   models bag
 * @returns the response envelope
 */
/**
 * The 409 message for a backup a restore cannot start from.
 * @param backupId - the backup
 * @param backup - its status and restore time
 */
function restoreRefusal(backupId: string, backup: { status: string | null; restoredAt?: Date | null }): string {
  const { COMPLETED, IN_PROGRESS } = TenantBackup.STATUS;
  if (backup.status === COMPLETED) {
    return (
      `Backup ${backupId} has already been restored (at ${new Date(backup.restoredAt as Date).toISOString()}) and cannot be restored again: ` +
      "take a new backup to restore again."
    );
  }
  return (
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a null status interpolates as "null"
    `Backup ${backupId} is ${backup.status} and cannot be restored: only a ${COMPLETED} backup can be. ` +
    (backup.status === IN_PROGRESS
      ? "A backup or a restore of it is already running."
      : "Wait for it to complete, or take a new backup.")
  );
}

async function restoreBackup({
  backupId,
  restoredById,
  mergeData = false,
  models,
}: {
  backupId: string;
  restoredById?: UserId | null;
  mergeData?: boolean;
  models: ModelsBag;
}): Promise<BackupResult> {
  const backup = await TenantBackup.findByPk(backupId, {
    include: [
      {
        model: models.Tenants,
        as: "tenant",
        required: false,
      },
    ],
  });

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  // A restore is a state transition COMPLETED -> IN_PROGRESS -> COMPLETED
  // with `restoredAt` set, so a backup in any other state is a 409 that names
  // the state, not a 400: the request is well formed, the backup is simply
  // not somewhere a restore can start from (CLAUDE.md, "Status Codes That
  // Carry Meaning"). S-32: these used to be RESTORING and RESTORED, which the
  // status ENUM does not have — every restore failed on PostgreSQL.
  if (backup.status !== TenantBackup.STATUS.COMPLETED || backup.restoredAt) {
    throw new ConflictError(restoreRefusal(backupId, backup));
  }

  if (!backup.filePath || !fs.existsSync(backup.filePath)) {
    throw new AppError(404, "Backup file not found on storage");
  }

  // The archive on disk must be the archive that was written. createBackup
  // records its SHA-256; a file that no longer matches has been altered or
  // replaced since, and its contents are not the tenant's backup (D-02).
  const recordedChecksum = backup.metadata?.["checksum"];
  if (recordedChecksum) {
    const actualChecksum = await calculateChecksum(backup.filePath);
    if (actualChecksum !== recordedChecksum) {
      throw new ConflictError(
        `Backup ${backupId} cannot be restored: its archive no longer matches the checksum recorded when it was taken, ` +
          "so it has been altered or replaced since. Nothing has been written.",
      );
    }
  }

  // Server-side truth for where this restore may write: the tenant that owns
  // the backup row, never `data.tenant.id` from the archive.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `backup.tenantId || backup.tenant?.id || null`
  const targetTenantId = backup.tenantId || backup.tenant?.id || null;

  let data: ArchiveData;
  try {
    // Extract and read the ZIP file
    const zip = new JSZip();
    const zipData = fs.readFileSync(backup.filePath);
    const extracted = await zip.loadAsync(zipData);

    // Find the tenant data file
    const dataFile = Object.keys(extracted.files).find((key) =>
      key.startsWith("tenant_data_"),
    );

    if (!dataFile) {
      throw new ConflictError(
        `Backup ${backupId} cannot be restored: its archive contains no tenant data file. Nothing has been written.`,
      );
    }

    // dataFile is one of these keys, found just above.
    const dataStr = await (extracted.files[dataFile] as JSZip.JSZipObject).async("string");
    data = JSON.parse(dataStr) as ArchiveData;

    assertRestorable({ backupId, backup, data, targetTenantId });
  } catch (error) {
    // A refusal is a state explanation about the backup, not a failure of this
    // restore: the backup row stays COMPLETED and the caller gets the 409
    // unchanged. Anything else really is a failure to read the archive.
    if (error instanceof AppError) {
      throw error;
    }

    await TenantBackup.updateStatus(
      backupId,
      {
        status: TenantBackup.STATUS.FAILED,
        errorMessage: messageOf(error),
      },
      models,
    );

    logger.error("Tenant backup restore failed", {
      backupId,
      error: messageOf(error),
    });

    throw new InternalServerError("Failed to restore backup: " + messageOf(error));
  }

  // Claim the backup for this restore — only now, once the archive is known
  // to be restorable into this tenant. CONDITIONAL on it still being an
  // unrestored COMPLETED backup, so of two concurrent restores exactly one
  // proceeds; the other gets the same 409 a later request would.
  const [claimed] = await TenantBackup.update(
    { status: TenantBackup.STATUS.IN_PROGRESS },
    {
      where: {
        id: backupId,
        status: TenantBackup.STATUS.COMPLETED,
        restoredAt: null,
      },
    },
  );
  if (claimed !== 1) {
    throw new ConflictError(
      restoreRefusal(backupId, { status: TenantBackup.STATUS.IN_PROGRESS }),
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `data.users || []` (a list, checked by assertRestorable)
    const backedUpUsers = (data.users || []) as ArchivedUser[];

    // Get the transaction from models parameter for consistency
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-require-imports -- as built: the barrel's instance, loaded on demand
    const sequelize = models.sequelize || (require("../models") as ModelsBarrel).sequelize;

    // Start transaction
    const transaction = await sequelize.transaction();

    try {
      const { outcome, notRestored } = await reconcileUsers({
        users: backedUpUsers,
        // assertRestorable refused a restore with no owning tenant.
        targetTenantId: targetTenantId as TenantId,
        mergeData,
        transaction,
      });

      // Accounts the tenant has that the archive does not. They are left alone;
      // the count is reported so a restore cannot silently look like a replace.
      const liveUserCount = await Users.count({
        where: { tenantId: targetTenantId as TenantId },
        transaction,
      });
      const retained = Math.max(
        liveUserCount - (outcome.updated + outcome.unchanged),
        0,
      );

      const recordsProcessed = backedUpUsers.length;

      // Every mutation writes an audit row, inside the same transaction.
      // `audit_logs.action` is a closed ENUM (CREATE, UPDATE, DELETE, LOGIN,
      // APPROVE, EXPORT — auditLog.model.js) with no RESTORE member: writing
      // "RESTORE" is rejected by the ENUM and would roll back every restore.
      // A restore updates the tenant's accounts, so it is recorded as UPDATE
      // with the operation named in `changes`.
      //
      // `notRestored` (ADR-051 Q-09) is recorded by ARCHIVE ENTRY and reason,
      // not by username. audit_logs is never purged (Q-12), and an entry here
      // is often a person erased under GDPR: writing their username into a
      // permanent table would re-create, in the trail, the personal data the
      // erasure removed. The entry index resolves against this backup's own
      // archive (resourceId) for as long as that archive is retained; the
      // response to the operator carries the usernames.
      await auditService.logAction(
        {
          tenantId: targetTenantId,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
          userId: restoredById || null,
          action: "UPDATE",
          resourceType: "TenantBackup",
          resourceId: backupId,
          changes: {
            operation: "RESTORE",
            mergeData,
            recordsProcessed,
            ...outcome,
            retained,
            notRestored: notRestored.map(({ entry, reason }) => ({ entry, reason })),
          },
        },
        { transaction },
      );

      // Commit transaction
      await transaction.commit();

      // Back to COMPLETED, now with `restoredAt` — the "restored" state the
      // ENUM can hold (S-32).
      await TenantBackup.updateStatus(
        backupId,
        {
          status: TenantBackup.STATUS.COMPLETED,
          restoredAt: new Date(),
          metadata: {
            ...backup.metadata,
            restoredAt: new Date().toISOString(),
            restoredById,
            recordsProcessed,
            ...outcome,
            retained,
            notRestored: notRestored.length,
          },
        },
        models,
      );

      logger.info("Tenant backup restored", {
        backupId,
        targetTenantId,
        recordsProcessed,
        restoredById,
        ...outcome,
        retained,
        notRestored: notRestored.length,
      });

      return {
        success: true,
        status: 200,
        message: "Backup restored successfully",
        data: {
          tenantId: targetTenantId,
          recordsProcessed,
          ...outcome,
          retained,
          // Accounts in the archive that this restore did NOT re-create, and
          // why. A restore never creates an account (ADR-051 Q-09); an
          // `absent` one can be re-invited through user creation, an `erased`
          // one must not be.
          notRestored,
          restoredAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    // Reconciliation raises no refusals: since A-120 it never creates an
    // account, so the only 409 it had (a re-created account's key held in
    // another tenant) cannot occur. Anything thrown here is a failure, and the
    // transaction has already been rolled back.
    // Update backup status with error
    await TenantBackup.updateStatus(
      backupId,
      {
        status: TenantBackup.STATUS.FAILED,
        errorMessage: messageOf(error),
      },
      models,
    );

    logger.error("Tenant backup restore failed", {
      backupId,
      error: messageOf(error),
    });

    throw new InternalServerError("Failed to restore backup: " + messageOf(error));
  }
}

/**
 * Delete a backup.
 *
 * S-32. This wrote a DELETING status first — not a member of the status ENUM,
 * so on PostgreSQL every delete failed before touching anything — and it
 * wrote no audit row. Now: the row is marked DELETED (with `deletedBy`),
 * soft-deleted and audited in ONE transaction, and the file is unlinked only
 * after that commits — the order the scheduled prune uses. A file that
 * outlives a failed unlink is an orphan on disk (logged); never a row
 * pointing at nothing.
 *
 * A backup still IN_PROGRESS (being taken, or being restored) is a 409.
 */
async function deleteBackup(backupId: string, deletedById: UserId | null | undefined, models?: ModelsBag): Promise<BackupResult<null>> {
  const backup = await TenantBackup.findByPk(backupId);

  if (!backup) {
    throw new AppError(404, "Backup not found");
  }

  const previousStatus = backup.status;
  if (previousStatus === TenantBackup.STATUS.IN_PROGRESS) {
    throw new ConflictError(
      `Backup ${backupId} is ${previousStatus} and cannot be deleted: a backup or a restore of it is running. Wait for it to finish.`,
    );
  }

  try {
    await sequelizeOf(models).transaction(async (transaction: Transaction) => {
      await backup.update(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        { status: TenantBackup.STATUS.DELETED, deletedBy: deletedById || null },
        { transaction },
      );
      await backup.destroy({ transaction });
      await auditService.logAction(
        {
          tenantId: backup.tenantId,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
          userId: deletedById || null,
          action: "DELETE",
          resourceType: "TenantBackup",
          resourceId: backupId,
          changes: {
            operation: "BACKUP_DELETE",
            fileName: backup.filePath ? path.basename(backup.filePath) : null,
            before: { status: previousStatus },
            after: { status: TenantBackup.STATUS.DELETED },
          },
        },
        { transaction },
      );
    });
  } catch (error) {
    logger.error("Tenant backup deletion failed", {
      backupId,
      error: messageOf(error),
    });
    throw new InternalServerError("Failed to delete backup: " + messageOf(error));
  }

  if (backup.filePath && fs.existsSync(backup.filePath)) {
    try {
      fs.unlinkSync(backup.filePath);
    } catch (error) {
      logger.error("Tenant backup deleted; its file could not be removed and is left on disk", {
        backupId,
        filePath: backup.filePath,
        error: messageOf(error),
      });
    }
  }

  logger.info("Tenant backup deleted", {
    backupId,
    deletedById,
  });

  return {
    success: true,
    status: 200,
    message: "Backup deleted successfully",
    data: null,
  };
}

/**
 * Get backup statistics for a tenant
 */
async function getBackupStats(tenantId: TenantId, models?: ModelsBag): Promise<BackupResult> {
  const totalBackups = await TenantBackup.count({ where: { tenantId } });
  const completedBackups = await TenantBackup.count({
    where: { tenantId, status: TenantBackup.STATUS.COMPLETED },
  });
  const failedBackups = await TenantBackup.count({
    where: { tenantId, status: TenantBackup.STATUS.FAILED },
  });

  const totalSizeResult = await TenantBackup.findAll({
    where: {
      tenantId,
      status: TenantBackup.STATUS.COMPLETED,
      fileSize: { [Op.ne]: null },
    },
    attributes: [
      [Sequelize.fn("SUM", Sequelize.col("file_size")), "totalSize"],
    ],
  });

  // As built: the SUM alias is read off the first row's dataValues.
  const rawTotalSize = (totalSizeResult[0]?.dataValues as { totalSize?: string | number | null } | undefined)?.totalSize;
  const totalSize = rawTotalSize ? parseFloat(String(rawTotalSize)) : 0;

  const latestBackup = await TenantBackup.getLatestBackup(tenantId, models);

  return {
    success: true,
    status: 200,
    message: "Backup statistics retrieved successfully",
    data: {
      totalBackups,
      completedBackups,
      failedBackups,
      totalSize,
      latestBackup,
      hasValidBackups: await TenantBackup.hasValidBackups(tenantId, models),
    },
  };
}

/**
 * Clean up expired backups and their physical files
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: the second parameter is accepted and not read
async function cleanupExpiredBackups(tenantId?: TenantId | null, _models?: ModelsBag): Promise<BackupResult<{ deletedCount: number }>> {
  const where: { status: string; expiresAt: { [Op.lt]: Date }; tenantId?: TenantId } = {
    status: TenantBackup.STATUS.COMPLETED,
    expiresAt: {
      [Op.lt]: new Date(),
    },
  };

  if (tenantId) {
    where.tenantId = tenantId;
  }

  const expiredBackups = await TenantBackup.findAll({ where: where as WhereOptions });

  let deletedCount = 0;

  for (const backup of expiredBackups) {
    try {
      // Delete physical file
      if (backup.filePath && fs.existsSync(backup.filePath)) {
        fs.unlinkSync(backup.filePath);
      }

      // Soft delete the record
      await backup.destroy();
      deletedCount++;
    } catch (error) {
      logger.error("Failed to clean up expired backup", {
        backupId: backup.id,
        error: messageOf(error),
      });
    }
  }

  if (deletedCount > 0) {
    logger.info("Cleaned up expired backups", {
      deletedCount,
      tenantId,
    });
  }

  return {
    success: true,
    status: 200,
    message: "Expired backups cleanup completed",
    data: { deletedCount },
  };
}

export = {
  USER_EXPORT_ATTRIBUTES,
  TENANT_EXPORT_ATTRIBUTES,
  NOT_RESTORED_REASONS,
  createBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupStats,
  cleanupExpiredBackups,
  BACKUP_DIR,
};
