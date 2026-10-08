/**
 * GDPR/CCPA Compliance Service
 *
 * Provides data export, right-to-erasure, consent management, and
 * privacy preference handling for multi-tenant SaaS compliance.
 *
 * Usage:
 *   const { exportUserData, eraseUserData } = require('./services/gdpr.service');
 *   await exportUserData(tenantId, userId);
 *
 * P9-18 (ADR-087, Stage C): converted from gdpr.service.js with no behaviour
 * change, under the four isolation gates. `export =` keeps the object
 * `require()` returned (the same fifteen keys, in the same order).
 * `updateConsent` and `restrictProcessing` reach `recordConsent`,
 * `withdrawConsent` and `createDsar` through that object, as the `.js` did
 * through `exports`. The modules the `.js` loaded at top level are loaded in
 * the same order, and captured at load as it destructured them. Every lazy
 * `require` (the models barrel, mfa, session, auth, the validator, jwt, the
 * email queue, activationToken, crypto and sequelize's `where`/`fn`/`col`)
 * stays lazy, typed through type-only imports.
 */

import fs from "fs";
import path from "path";
import type { CreationAttributes, Transaction } from "sequelize";
import type * as SequelizeTypes from "sequelize";
import type * as CryptoTypes from "crypto";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { Op as LoadedOp } from "sequelize";
import loadedStoragePath from "../utils/storagePath.util";
import { deleteUpload as loadedDeleteUpload } from "../utils/upload.util";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import storage from "./storage";
import storedFile from "./storedFile.service";
import type { StorageObject } from "../utils/fileResponse.util";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { runForTenant as loadedRunForTenant } from "../utils/jobContext.util";
import type mfaServiceType from "./mfa.service";
import type sessionServiceType from "./session.service";
import type authServiceType from "./auth.service";
import type jwtUtilType from "../utils/jwt.util";
import type emailQueueType from "./emailQueue.service";
import type * as GdprValidator from "../validators/gdpr.validator";
import type * as ActivationToken from "../utils/activationToken.util";
import type { ModelInstance, ModelsBarrel } from "../types/models";
import type { TenantId, UserId } from "../types/ids";
import { env } from "../config/env";

/** The surface of archiver 8 this module uses (the package ships no types). */
interface ZipArchiveLike {
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "end", listener: () => void): void;
  pipe(destination: NodeJS.WritableStream): void;
  directory(dir: string, destPath: false): void;
  finalize(): Promise<void> | void;
}

// archiver 8 is an ES module with named classes and no default export: the
// `require` yields its namespace, so the old `archiver("zip", …)` threw
// "archiver is not a function" and every GDPR export answered 500 (P6-02,
// found live — every unit test mocked archiver as a function).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- archiver 8 ships no types; loaded where and as the `.js` loaded it
const { ZipArchive } = require("archiver") as {
  ZipArchive: new (options: { zlib: { level: number } }) => ZipArchiveLike;
};
const logger = loadedLogger;
const AppError = LoadedAppError;
const Op = LoadedOp;
const storagePath = loadedStoragePath;
const deleteUpload = loadedDeleteUpload;
const db = loadedDb;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type RawRow = Record<string, unknown>;

/** The models barrel, loaded lazily where the `.js` required it. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
const modelsBarrel = (): ModelsBarrel => require("../models") as ModelsBarrel;

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

/**
 * P6-11 (2026-09-30) — a consent, preference or data-subject request commits
 * with ONE audit row in its transaction: the record of how a request was
 * handled is itself the evidence GDPR Art. 5(2)/30 and UU PDP ask for. The row
 * records WHAT happened (purpose, request type, which preference keys), never
 * the personal data itself: no free-text reason or details, no preference
 * values. The subject acts for themselves (self-service), as rectifyData
 * records; `actor` is auditPrincipal(req) when the controller has one.
 *
 * @param transaction
 * @param tenantId
 * @param userId - the data subject
 * @param actor - auditPrincipal(req), or null for the subject
 * @param action
 * @param resourceType
 * @param resourceId
 * @param changes - { operation, ... } without personal data
 */
const auditGdpr = (
  transaction: Transaction,
  tenantId: TenantId,
  userId: UserId,
  actor: AuditActorInput | null,
  action: "CREATE" | "UPDATE" | "EXPORT",
  resourceType: string,
  resourceId: string | null,
  changes: Record<string, unknown>,
): Promise<unknown> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy actor means the subject
  const who: AuditActorInput = actor || { userId };
  return auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(who),
      action,
      resourceType,
      resourceId,
      changes: { ...changes, subjectId: userId, ...actorChanges(who) },
    },
    { transaction },
  );
};
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const runForTenant = loadedRunForTenant;

// ==========================================
// CONFIGURATION
// ==========================================

const isGdprEnabled = (): boolean => env("GDPR_ENABLED") !== "false";
// As built: an unset, empty or non-numeric value falls back to the default.
const EXPORT_RETENTION_HOURS =
  parseInt(env("EXPORT_RETENTION_HOURS") as string) || 168; // 7 days
// ERASURE_BATCH_SIZE was read here and never used; the unused constant is not
// carried over (reading an environment variable has no effect).
const CONSENT_REQUIRED = env("CONSENT_REQUIRED") === "true";

// ==========================================
// DATA EXPORT
// ==========================================

/**
 * Export all user data for GDPR Article 15 (Right of Access)
 *
 * A-364 (2026-10-02): the export is recorded. It writes FILES (the manifest,
 * then the ZIP), not rows, so there is no mutation transaction to join; the
 * audit row is the export's only database write. It is written the way the
 * other audited file actions here are (contentMedia's upload, the A-360
 * download): the file work first, then ONE `EXPORT` row (`DataExport`,
 * `GDPR_EXPORT_CREATE`, the export id, size and expiry — never the data) in
 * `db.transaction`, BEFORE the export id is handed out. If that row cannot be
 * written, the catch below deletes the ZIP and its manifest and the request is
 * a 500: no row, no export. An export that fails earlier writes no row (it
 * does not exist).
 *
 * @param tenantId - Tenant ID
 * @param userId - User ID
 * @param actor - auditPrincipal(req), or null for the subject (A-364). This
 *   position held an `_options` object that was accepted and never read; no
 *   caller passed it.
 */
const exportUserData = async (
  tenantId: TenantId,
  userId: UserId,
  actor: AuditActorInput | null = null,
): Promise<{ exportId: string; downloadUrl: string; expiresAt: string; fileSize: number }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Data export is disabled");
  }

  const exportId = generateExportId();
  // P8-01 (ADR-086 Amendment 1): the working directory and the ZIP being built
  // are SCRATCH on this host, for the length of this request; the archive and
  // its manifest are kept in the tenant's storage (`t/<tenantId>/exports/`),
  // where every replica — and the retention sweep — finds them.
  const exportDir = storagePath("exports", exportId);
  const zipPath = storagePath("exports", `${exportId}.zip`);
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + EXPORT_RETENTION_HOURS * 3600000);
  let scoped: Awaited<ReturnType<typeof storage.getTenantStorage>> | null = null;

  try {
    scoped = await storage.getTenantStorage(tenantId);
    // W-15 (ADR-079): the manifest is written FIRST, so every object this
    // export leaves, even after a crash part-way, has a recorded expiry and
    // owner that the retention sweep (purgeExpiredExports) enforces.
    await fs.promises.mkdir(storagePath("exports"), { recursive: true });
    await scoped.put(
      exportManifestKey(scoped, exportId),
      Buffer.from(
        JSON.stringify({
          exportId,
          tenantId,
          userId,
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }),
      ),
      { contentType: "application/json" },
    );

    // Create export directory
    await fs.promises.mkdir(exportDir, { recursive: true });

    // Export user profile
    await exportUserProfile(exportDir, tenantId, userId);

    // A-151: the records that name the subject — never whole-tenant tables
    await exportSubjectRecords(exportDir, tenantId, userId);

    // A-180: the subject's consent history, DSARs and sessions
    await exportPrivacyRecords(exportDir, tenantId, userId);

    // Export audit logs
    await exportAuditLogs(exportDir, tenantId, userId);

    // Create ZIP archive
    await createZipArchive(exportDir, zipPath);

    // W-15: the unpacked copy has no use once zipped; it used to wait for the
    // same seven-day timer as the ZIP. The ZIP's expiry is the manifest's, and
    // the retention sweep deletes it. There is no in-process timer.
    await fs.promises.rm(exportDir, { recursive: true, force: true });

    const fileSize = await getFileSize(zipPath);
    // P8-01: the archive into the tenant's storage; the scratch ZIP is removed
    // once it is there.
    await storedFile.putLocalFile(scoped, exportArchiveKey(scoped, exportId), zipPath, "application/zip");

    // A-364: the export's record, before its id is handed out (see above).
    await db.transaction(async (transaction) => {
      await auditGdpr(transaction, tenantId, userId, actor, "EXPORT", "DataExport", exportId, {
        operation: "GDPR_EXPORT_CREATE",
        fileSize,
        expiresAt: expiresAt.toISOString(),
      });
    });

    logger.info("User data export completed", {
      tenantId,
      userId,
      exportId,
    });

    return {
      exportId,
      // A-360: served by GET /gdpr/exports/:exportId/download (getExportDownload).
      downloadUrl: `/api/v1/gdpr/exports/${exportId}/download`,
      expiresAt: expiresAt.toISOString(),
      fileSize,
    };
  } catch (err) {
    logger.error("Data export failed", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    // A-151: an unpacked export must not linger on disk for 7 days with no
    // cleanup scheduled; `force` makes a missing directory a no-op. W-15: nor
    // a half-written ZIP, nor the manifest of an export that does not exist.
    await fs.promises.rm(exportDir, { recursive: true, force: true });
    await fs.promises.rm(zipPath, { force: true });
    if (scoped) {
      const kept = scoped;
      await kept.delete(exportArchiveKey(kept, exportId)).catch(() => undefined);
      await kept.delete(exportManifestKey(kept, exportId)).catch(() => undefined);
    }
    // A-151: "no such subject" is a 404 — it was rewritten into a 500.
    if (err instanceof AppError && err.status < 500) {
      throw err;
    }
    throw new AppError(500, "Failed to export user data");
  }
};

/**
 * Export user profile data
 */
async function exportUserProfile(exportDir: string, tenantId: TenantId, userId: UserId): Promise<void> {
  const { User, Role } = modelsBarrel();

  // A-140: `User` is associated to `Role` under the alias `role`
  // (user.model.js). `include: [Role]` without it made Sequelize throw before
  // any query ran, so every Article 15 export failed. No `raw: true`: it
  // flattens an include to `"role.name"` keys, and `user.role` would be unset.
  // The role is a LEFT JOIN — a user whose role was deleted (role_id SET NULL)
  // is still owed their data. The attributes are named, so no credential or
  // second-factor column is ever selected into an export.
  const user = await User.findOne({
    where: { id: userId, tenantId },
    attributes: [
      "id",
      "email",
      "username",
      "firstName",
      "lastName",
      "phone",
      "avatarUrl",
      "status",
      "createdAt",
      "lastLoginAt",
    ],
    include: [
      { model: Role, as: "role", attributes: ["id", "name"], required: false },
    ],
  });

  if (!user) {
    throw new AppError(404, "User not found");
  }

  const profileData = {
    exportDate: new Date().toISOString(),
    requestType: "Data Export (GDPR Article 15)",
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      // Personal data the subject is owed and the export used to omit.
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      // As built: a LEFT JOIN leaves the role null.
      role: user.role?.name ?? null,
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    },
  };

  await fs.promises.writeFile(
    path.join(exportDir, "user_profile.json"),
    JSON.stringify(profileData, null, 2),
  );
}

/**
 * A-151 — the operational records that NAME the data subject, per table, and
 * the columns that name them. Written out by hand: each entry is a claim that
 * the column holds a user id, checked against its model.
 *
 * The previous export dumped whole-tenant tables into one person's Article 15
 * archive — every stock row, device, calibration record, certificate and
 * notification of the hospital (up to 1,000 per table), i.e. other people's
 * data, sent to whoever asked. `userId` was accepted and never used. Stocks
 * and calibration devices name no user at all, so they are not here.
 */
const SUBJECT_RECORDS = Object.freeze([
  { model: "StockTransfer", columns: ["requestedBy", "approvedBy"] },
  { model: "StockAdjustment", columns: ["adjustedBy"] },
  { model: "StockOpname", columns: ["performedBy"] },
  { model: "CalibrationRecord", columns: ["performedBy"] },
  {
    model: "Certificate",
    columns: ["calibratedBy", "approvedBy", "signedBy", "createdBy", "updatedBy"],
  },
  { model: "MaintenanceWorkOrder", columns: ["assignedTo"] },
  { model: "Notification", columns: ["userId"] },
]);

/**
 * D-24 (ADR-070) — rows read per query while an export is written. The export
 * is COMPLETE and STREAMED: each table is read a keyset page at a time (by id,
 * stable while rows are added) and each page is written to the file before the
 * next is read, so memory is bounded by one page, not by the tenant's history.
 * It used to read every table whole into memory and truncate at 1,000 rows per
 * table (5,000 audit rows) — an Article 15 answer that silently stopped.
 */
const EXPORT_PAGE_SIZE = 500;

/** A model (or an unscoped one) as pagesOf reads it: raw rows, a page at a time. */
interface PageSource {
  findAll(options: Record<string, unknown>): Promise<unknown[]>;
  /** The model's attributes (absent on a test double): read for its DECIMAL columns. */
  getAttributes?(): Record<string, { type?: unknown }>;
}

/**
 * D-21 / Q-55 — a `raw: true` read bypasses the model's DECIMAL getters, so a
 * NUMERIC (a work order's `estimatedCost`) would reach the export as the pg
 * driver's string ("1250.00") while the API answers it as a number. Every
 * DECIMAL attribute of the model is read back as a number; NULL stays NULL.
 *
 * @param Model - the model the rows were read from
 * @returns a per-row transform (the identity when the model has no DECIMAL)
 */
function decimalsAsNumbers(Model: PageSource): (row: RawRow) => RawRow {
  const decimals = Object.entries(Model.getAttributes?.() ?? {})
    .filter(([, attribute]) => (attribute.type as { key?: string } | undefined)?.key === "DECIMAL")
    .map(([name]) => name);
  if (decimals.length === 0) {
    return (row) => row;
  }
  return (row) => {
    const converted: RawRow = { ...row };
    for (const name of decimals) {
      const value = converted[name];
      if (value !== null && value !== undefined) {
        converted[name] = Number(value);
      }
    }
    return converted;
  };
}

/**
 * Every row of `Model` matching `where`, a keyset page (by id) at a time.
 *
 * @param Model - a Sequelize model (or an unscoped one)
 * @param where - the tenant AND subject predicate
 * @param options - extra findAll options (attributes)
 * @returns non-empty pages of raw rows
 */
async function* pagesOf(
  Model: PageSource,
  where: Record<string | symbol, unknown>,
  options: Record<string, unknown> = {},
): AsyncGenerator<RawRow[]> {
  let afterId: unknown = null;
  for (;;) {
    const rows = (await Model.findAll({
      ...options,
      where: afterId === null ? where : { ...where, id: { [Op.gt]: afterId } },
      order: [["id", "ASC"]],
      limit: EXPORT_PAGE_SIZE,
      raw: true,
    })) as RawRow[];
    if (rows.length > 0) {
      yield rows;
    }
    if (rows.length < EXPORT_PAGE_SIZE) {
      return;
    }
    afterId = (rows[rows.length - 1] as RawRow)["id"];
  }
}

/**
 * A JSON array, written as it is read: `[`, one row per line, `]`.
 *
 * @param pages
 * @param map - a per-row transform
 */
async function* jsonArray(pages: AsyncIterable<RawRow[]>, map: (row: RawRow) => unknown = (row) => row): AsyncGenerator<string> {
  yield "[";
  let separator = "\n";
  for await (const rows of pages) {
    const lines = [];
    for (const row of rows) {
      lines.push(`${separator}${JSON.stringify(map(row))}`);
      separator = ",\n";
    }
    yield lines.join("");
  }
  // `separator` is still the opening one only when no row was written.
  yield separator === "\n" ? "]" : "\n]";
}

/**
 * A JSON object of named arrays, each streamed: `{"name": [...], ...}`.
 *
 * @param members - name, and
 *   a factory for its streamed value (called only when it is reached)
 */
async function* jsonObject(members: [string, () => AsyncGenerator<string>][]): AsyncGenerator<string> {
  yield "{";
  for (const [index, [name, value]] of members.entries()) {
    yield `${index === 0 ? "\n" : ",\n"}${JSON.stringify(name)}: `;
    yield* value();
  }
  yield "\n}\n";
}

/**
 * Export the records that name the subject (`SUBJECT_RECORDS`), each filtered
 * by the tenant AND by the subject's user id in one of its columns.
 *
 * A failure is not swallowed: an Article 15 answer that silently omits a
 * table is an incomplete answer presented as a complete one. The export fails
 * and the requester can retry.
 *
 * @param exportDir - the export's working directory
 * @param tenantId - the subject's tenant
 * @param userId - the data subject
 * @returns resolves when subject_records.json is written
 */
async function exportSubjectRecords(exportDir: string, tenantId: TenantId, userId: UserId): Promise<void> {
  const models = modelsBarrel();

  // D-24: streamed — fs.promises.writeFile consumes the generator a chunk at a
  // time, and a failed read rejects the write (and so the export).
  await fs.promises.writeFile(
    path.join(exportDir, "subject_records.json"),
    jsonObject(
      SUBJECT_RECORDS.map(({ model, columns }): [string, () => AsyncGenerator<string>] => {
        const Model = (models as unknown as Record<string, PageSource>)[model] as PageSource;
        return [
          model,
          () =>
            jsonArray(
              pagesOf(Model, {
                tenantId,
                [Op.or]: columns.map((column) => ({ [column]: userId })),
              }),
              decimalsAsNumbers(Model),
            ),
        ];
      }),
    ),
  );
}

/**
 * A-180 — the session attributes an Article 15 export carries. `token_hash`
 * is a credential (the SHA-256 a refresh token is checked against), so it is
 * not here; the list is an allow-list so a column added later stays out until
 * someone decides the subject is owed it.
 */
const EXPORTED_SESSION_ATTRIBUTES = Object.freeze([
  "id",
  "impersonator_id",
  "ip_address",
  "user_agent",
  "device",
  "created_at",
  "last_activity_at",
  "expired_at",
  "is_active",
  "is_revoked",
  "revoked_at",
  "revoked_reason",
]);

/** The session fields that describe the impersonator, not the subject. */
const IMPERSONATOR_SESSION_FIELDS = Object.freeze(["ip_address", "user_agent", "device"]);

/**
 * Export the privacy records that are about the subject (A-180): their consent
 * history (GDPR Art. 7(1) — every grant and withdrawal), their data-subject
 * requests, and their sign-in sessions. Each read is filtered by the tenant
 * AND the subject. Before A-180 the Article 15 archive omitted all three.
 *
 * A session a super admin opened by impersonating the subject records the
 * IMPERSONATOR's network address, user agent and device — someone else's
 * personal data. Those fields are withheld on such a row; the row itself
 * (the fact that the account was used, when, and that it was impersonated)
 * is the subject's.
 *
 * A failure is not swallowed (the A-151 rule): an Article 15 answer that
 * silently omits a table is an incomplete answer presented as complete.
 *
 * @param exportDir - the export's working directory
 * @param tenantId - the subject's tenant
 * @param userId - the data subject
 * @returns resolves when privacy_records.json is written
 */
async function exportPrivacyRecords(exportDir: string, tenantId: TenantId, userId: UserId): Promise<void> {
  const { ConsentRecord, DsarRequest, Session } = modelsBarrel();

  const withholdImpersonator = (row: RawRow): RawRow => {
    if (!row["impersonator_id"]) {
      return row;
    }
    const withheld: RawRow = { ...row, impersonated: true };
    for (const field of IMPERSONATOR_SESSION_FIELDS) {
      withheld[field] = null;
    }
    delete withheld["impersonator_id"];
    return withheld;
  };

  // D-24: streamed, complete, in id order (was: newest first, 1,000 each).
  await fs.promises.writeFile(
    path.join(exportDir, "privacy_records.json"),
    jsonObject([
      [
        "consentHistory",
        () =>
          jsonArray(
            pagesOf(
              ConsentRecord,
              { tenantId, userId },
              {
                attributes: [
                  "id",
                  "purpose",
                  "version",
                  "status",
                  "ipAddress",
                  "consentedAt",
                  "withdrawnAt",
                  "createdAt",
                ],
              },
            ),
          ),
      ],
      [
        "dsarRequests",
        () =>
          jsonArray(
            pagesOf(
              DsarRequest,
              { tenantId, userId },
              { attributes: ["id", "type", "status", "details", "requestedAt", "completedAt"] },
            ),
          ),
      ],
      // `sessions` is snake_case (CLAUDE.md § Traps), and the defaultScope
      // hides soft-deleted rows — which are still the subject's history, so
      // unscoped.
      [
        "sessions",
        () =>
          jsonArray(
            pagesOf(
              Session.unscoped(),
              { tenant_id: tenantId, user_id: userId },
              { attributes: [...EXPORTED_SESSION_ATTRIBUTES] },
            ),
            withholdImpersonator,
          ),
      ],
    ]),
  );
}

/**
 * Export audit logs for user
 */
async function exportAuditLogs(exportDir: string, tenantId: TenantId, userId: UserId): Promise<void> {
  const { AuditLog } = modelsBarrel();
  const file = path.join(exportDir, "audit_logs.json");

  try {
    // The rows the subject acted in: as the principal, or as the super admin
    // behind an impersonation (F-8). `performedBy` is not an audit_logs
    // column; filtering on it made PostgreSQL reject the query, and the
    // subject received an error object in place of their own audit rows.
    // D-24: streamed and complete (was: the first 5,000, in memory).
    await fs.promises.writeFile(
      file,
      jsonArray(
        pagesOf(AuditLog, {
          tenantId,
          [Op.or]: [{ userId }, { impersonatorId: userId }],
        }),
      ),
    );
  } catch (err) {
    logger.warn("Failed to export audit logs", { error: messageOf(err) });
    await fs.promises.writeFile(file, JSON.stringify({ error: "Failed to export" }, null, 2));
  }
}

/**
 * Create ZIP archive of export
 */
async function createZipArchive(exportDir: string, zipPath: string): Promise<string> {
  const output = fs.createWriteStream(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    archive.on("error", (err) => { reject(err); });
    archive.pipe(output);
    archive.directory(exportDir, false);
    // Not awaited, as built: completion is the "close"/"end" events below.
    void archive.finalize();

    output.on("close", () => { resolve(zipPath); });
    archive.on("end", () => { resolve(zipPath); });
  });
}

/** P8-01: an export's archive key in its tenant's storage. */
const exportArchiveKey = (scoped: { buildKey(input: { domain: string; name: string }): string }, exportId: string): string =>
  scoped.buildKey({ domain: "exports", name: `${exportId}.zip` });

/** P8-01: an export's manifest key in its tenant's storage. */
const exportManifestKey = (scoped: { buildKey(input: { domain: string; name: string }): string }, exportId: string): string =>
  scoped.buildKey({ domain: "exports", name: `${exportId}.json` });

/** An export's files: `<id>.json` (manifest), `<id>.zip`, and the `<id>` working directory. */
const EXPORT_ENTRY = /^(export-(\d+)-[0-9a-f]+)(\.zip|\.json)?$/;

/**
 * W-15 (ADR-079): delete every GDPR export whose expiry has passed. Run by the
 * nightly retention sweep (dataRetention.service#runRetentionSweep).
 *
 * The expiry used to be enforced only by a `setTimeout` in the process that
 * built the export: any restart inside the seven days left the subject's
 * exported personal data on disk for good. The expiry is now on disk with the
 * file, in its manifest, and this sweep enforces it whatever process wrote it.
 *
 * - An export with a manifest: its ZIP and working directory are deleted, then
 *   one audit row is written in the export's tenant, naming the retention job
 *   (`system:retention-purge`) and the subject. The manifest goes last, so an
 *   audit row that failed is retried by the next sweep.
 * - An export with no manifest (written before W-15): its expiry is the
 *   creation time in its id plus EXPORT_RETENTION_HOURS. Its owner is not
 *   recorded anywhere, so it is deleted and logged, not audited.
 * - Anything else in the directory is left alone.
 *
 * @param opts.now
 */
const purgeExpiredExports = async (
  { now = new Date() }: { now?: Date } = {},
): Promise<{ deleted: number; errors: number }> => {
  // P8-01 (ADR-086 Amendment 1): exports kept in tenants' storage, then the
  // legacy directory (exports written before the cut-over, and any scratch a
  // crash left behind).
  const stored = await purgeExpiredStoredExports(now);
  const legacy = await purgeExpiredLegacyExports(now);
  return { deleted: stored.deleted + legacy.deleted, errors: stored.errors + legacy.errors };
};

/** The tenants whose storage the export sweep walks, a page at a time. */
const TENANT_PAGE = 500;

/**
 * P8-01 — W-15's sweep over the exports kept in each tenant's storage. The
 * same rules as the legacy directory's: an export with a manifest goes at its
 * recorded expiry, with one audit row in its tenant naming the retention job
 * and the subject, the manifest last (so a failed audit row is retried); an
 * archive with no manifest goes at the creation time in its id plus
 * EXPORT_RETENTION_HOURS, logged.
 */
const purgeExpiredStoredExports = async (now: Date): Promise<{ deleted: number; errors: number }> => {
  const result = { deleted: 0, errors: 0 };
  const { Tenant } = modelsBarrel();
  let after: string | null = null;
  for (;;) {
    const page = (await Tenant.findAll({
      attributes: ["id"],
      ...(after ? { where: { id: { [Op.gt]: after } } } : {}),
      order: [["id", "ASC"]],
      limit: TENANT_PAGE,
      paranoid: false,
    })) as unknown as { id: TenantId }[];
    for (const { id } of page) {
      try {
        const counts = await purgeTenantExports(id, now);
        result.deleted += counts.deleted;
        result.errors += counts.errors;
      } catch (err) {
        result.errors += 1;
        logger.error(`GDPR export sweep could not read tenant ${id}'s storage: ${messageOf(err)}`);
      }
    }
    if (page.length < TENANT_PAGE) {break;}
    after = (page[page.length - 1] as { id: TenantId }).id;
  }
  return result;
};

/** One tenant's stored exports (P8-01). */
const purgeTenantExports = async (tenantId: TenantId, now: Date): Promise<{ deleted: number; errors: number }> => {
  const result = { deleted: 0, errors: 0 };
  const scoped = await storage.getTenantStorage(tenantId);
  const names: string[] = [];
  let cursor: string | null | undefined;
  do {
    const listed = (await scoped.list("exports", { limit: 1000, ...(cursor ? { cursor } : {}) })) as {
      keys: string[];
      cursor?: string | null;
    };
    names.push(...listed.keys.map((key) => path.posix.basename(key)));
    cursor = listed.cursor;
  } while (cursor);

  const exportsById = new Map<string, { createdMs: number; manifest: boolean }>();
  for (const name of names) {
    const match = EXPORT_ENTRY.exec(name);
    if (match) {
      const id = match[1] as string;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as the legacy sweep
      const entry = exportsById.get(id) || { createdMs: Number(match[2]), manifest: false };
      entry.manifest = entry.manifest || match[3] === ".json";
      exportsById.set(id, entry);
    }
  }

  for (const [exportId, entry] of exportsById) {
    const manifestKey = exportManifestKey(scoped, exportId);
    try {
      const manifest = entry.manifest
        ? (JSON.parse((await storedFile.readObject(scoped, manifestKey)).toString("utf8")) as {
            userId: unknown;
            createdAt: unknown;
            expiresAt: string;
          } | null)
        : null;
      const expiresMs = manifest
        ? Date.parse(manifest.expiresAt)
        : entry.createdMs + EXPORT_RETENTION_HOURS * 3600000;
      // A manifest whose expiry does not parse (NaN) is treated as expired.
      if (now.getTime() < expiresMs) {
        continue;
      }
      await storedFile.removeObject(scoped, exportArchiveKey(scoped, exportId));
      if (manifest) {
        await runForTenant(tenantId, () =>
          auditService.logAction({
            tenantId,
            systemActor: SYSTEM_ACTORS.RETENTION_PURGE,
            action: "DELETE",
            resourceType: "DataExport",
            resourceId: exportId,
            changes: {
              operation: "GDPR_EXPORT_EXPIRED",
              actor: SYSTEM_ACTORS.RETENTION_PURGE,
              subjectUserId: manifest.userId,
              createdAt: manifest.createdAt,
              expiresAt: manifest.expiresAt,
            },
          }),
        );
        await storedFile.removeObject(scoped, manifestKey);
      } else {
        logger.info(`GDPR export ${exportId} expired and deleted from storage (no manifest)`);
      }
      result.deleted += 1;
    } catch (err) {
      result.errors += 1;
      logger.error(`GDPR export sweep could not delete ${exportId}: ${messageOf(err)}`);
    }
  }
  return result;
};

/** W-15's sweep over the legacy exports directory on this host. */
const purgeExpiredLegacyExports = async (now: Date): Promise<{ deleted: number; errors: number }> => {
  const dir = storagePath("exports");
  const result = { deleted: 0, errors: 0 };
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return result;
    }
    logger.error(`GDPR export sweep could not read ${dir}: ${messageOf(err)}`);
    result.errors += 1;
    return result;
  }

  const exportsById = new Map<string, { createdMs: number; manifest: boolean }>();
  for (const name of names) {
    const match = EXPORT_ENTRY.exec(name);
    if (match) {
      // The regular expression's groups 1 and 2 always match; group 3 may not.
      const id = match[1] as string;
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      const entry = exportsById.get(id) || { createdMs: Number(match[2]), manifest: false };
      entry.manifest = entry.manifest || match[3] === ".json";
      exportsById.set(id, entry);
    }
  }

  for (const [exportId, entry] of exportsById) {
    const manifestPath = path.join(dir, `${exportId}.json`);
    try {
      const manifest = entry.manifest
        ? (JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as {
            tenantId: TenantId;
            userId: unknown;
            createdAt: unknown;
            expiresAt: string;
          } | null)
        : null;
      const expiresMs = manifest
        ? Date.parse(manifest.expiresAt)
        : entry.createdMs + EXPORT_RETENTION_HOURS * 3600000;
      // A manifest whose expiry does not parse (NaN) is treated as expired:
      // personal data with no readable expiry is not kept.
      if (now.getTime() < expiresMs) {
        continue;
      }
      await fs.promises.rm(path.join(dir, `${exportId}.zip`), { force: true });
      await fs.promises.rm(path.join(dir, exportId), { recursive: true, force: true });
      if (manifest) {
        await runForTenant(manifest.tenantId, () =>
          auditService.logAction({
            tenantId: manifest.tenantId,
            systemActor: SYSTEM_ACTORS.RETENTION_PURGE,
            action: "DELETE",
            resourceType: "DataExport",
            resourceId: exportId,
            changes: {
              operation: "GDPR_EXPORT_EXPIRED",
              actor: SYSTEM_ACTORS.RETENTION_PURGE,
              subjectUserId: manifest.userId,
              createdAt: manifest.createdAt,
              expiresAt: manifest.expiresAt,
            },
          }),
        );
        await fs.promises.rm(manifestPath, { force: true });
      } else {
        logger.info(`GDPR export ${exportId} expired and deleted (no manifest: written before W-15)`);
      }
      result.deleted += 1;
    } catch (err) {
      result.errors += 1;
      logger.error(`GDPR export sweep could not delete ${exportId}: ${messageOf(err)}`);
    }
  }

  return result;
};

/** An export id as generateExportId makes it; nothing else names a file. */
const EXPORT_ID = /^export-\d+-[0-9a-f]{8}$/;

/** What an export's manifest records (exportUserData writes it first, W-15). */
interface ExportManifest {
  exportId?: unknown;
  tenantId?: unknown;
  userId?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
}

/**
 * A-360 (ADR-114) — the data subject downloads their OWN export archive
 * (GDPR Art. 15(3) / Art. 20: a copy, in a machine-readable format).
 *
 * `POST /gdpr/export` answered a `downloadUrl` that no route served, and the
 * privacy page saved that answer — four fields of metadata — as the export.
 * The archive is on disk with its manifest (owner, tenant, expiry: W-15); this
 * resolves an export id to that archive for the caller, or refuses.
 *
 * Every refusal is the SAME 404, "Export not found": an id that is malformed,
 * unknown, another subject's, another tenant's, expired (the sweep may not have
 * run yet) or whose archive is gone. A 403 for "someone else's" would confirm
 * that the id exists. The id is checked against EXPORT_ID before any path is
 * built from it, so it can never name a file outside the exports directory.
 *
 * A download is a disclosure of personal data: one EXPORT audit row
 * (`DataExport`, `GDPR_EXPORT_DOWNLOAD`) is written in a transaction BEFORE the
 * file is handed over. If that row cannot be written, nothing is served.
 *
 * @param tenantId - the caller's tenant
 * @param userId - the caller (the data subject)
 * @param exportId - from the path
 * @param actor - auditPrincipal(req), or null for the subject
 * @param opts.now - the clock (tests)
 * @returns the archive's path, the file name to save it as, and its size
 */
const getExportDownload = async (
  tenantId: TenantId,
  userId: UserId,
  exportId: string,
  actor: AuditActorInput | null = null,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ filePath?: string; object?: StorageObject; filename: string; fileSize: number }> => {
  const found = await locateExport(tenantId, userId, exportId, now);
  // ONE throw site: a development error body carries the stack, and a refusal
  // thrown from different lines would tell "not yours" from "never existed".
  if (!found) {
    throw new AppError(404, "Export not found");
  }

  await db.transaction(async (transaction) => {
    await auditGdpr(transaction, tenantId, userId, actor, "EXPORT", "DataExport", exportId, {
      operation: "GDPR_EXPORT_DOWNLOAD",
      fileSize: found.fileSize,
      expiresAt: found.expiresAt,
    });
  });

  // P8-01: an archive in storage is handed back as the object; a legacy one
  // as its path, exactly as before.
  return {
    ...(found.object ? { object: found.object } : { filePath: found.filePath as string }),
    filename: `${exportId}.zip`,
    fileSize: found.fileSize,
  };
};

/**
 * A-360 — the caller's live export archive, or null for every reason it is
 * not theirs to have (see getExportDownload). A failure that is not "absent"
 * (a permission error, a full disk) propagates.
 */
async function locateExport(
  tenantId: TenantId,
  userId: UserId,
  exportId: unknown,
  now: Date,
): Promise<{ filePath?: string; object?: StorageObject; fileSize: number; expiresAt: string } | null> {
  // The shape first: the id comes from the path, and is never joined to a
  // path before it matches. A principal with no tenant or id owns nothing.
  if (!tenantId || !userId || typeof exportId !== "string" || !EXPORT_ID.test(exportId)) {
    return null;
  }

  // P8-01 (ADR-086 Amendment 1): the CALLER's tenant's storage first — an
  // export of another tenant's is never in it — then the legacy directory.
  const scoped = await storage.getTenantStorage(tenantId);
  let stored: ExportManifest | null | undefined;
  try {
    stored = JSON.parse(
      (await storedFile.readObject(scoped, exportManifestKey(scoped, exportId))).toString("utf8"),
    ) as ExportManifest | null;
  } catch (err) {
    if (err instanceof SyntaxError) {
      return null;
    }
    if (!storedFile.isMissing(err)) {
      throw err;
    }
  }
  if (stored !== undefined) {
    if (!manifestGrants(stored, tenantId, userId, now)) {
      return null;
    }
    try {
      const object = await storedFile.openObject(scoped, exportArchiveKey(scoped, exportId));
      return { object, fileSize: object.meta.size as number, expiresAt: (stored as { expiresAt: string }).expiresAt };
    } catch (err) {
      if (storedFile.isMissing(err)) {
        return null;
      }
      throw err;
    }
  }

  let manifest: ExportManifest | null;
  try {
    manifest = JSON.parse(
      await fs.promises.readFile(storagePath("exports", `${exportId}.json`), "utf8"),
    ) as ExportManifest | null;
  } catch (err) {
    // No manifest (never existed, swept, or written before W-15 with no
    // recorded owner) or an unreadable one: there is no owner to match.
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError) {
      return null;
    }
    throw err;
  }
  if (!manifestGrants(manifest, tenantId, userId, now)) {
    return null;
  }

  const filePath = storagePath("exports", `${exportId}.zip`);
  try {
    return { filePath, fileSize: (await fs.promises.stat(filePath)).size, expiresAt: (manifest as { expiresAt: string }).expiresAt };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Whether a manifest makes the export the caller's, now: it names their
 * tenant AND user, and its expiry is a time still ahead (one that does not
 * parse — NaN — is treated as expired, as the sweep does).
 */
function manifestGrants(manifest: ExportManifest | null, tenantId: TenantId, userId: UserId, now: Date): boolean {
  return !(
    manifest === null ||
    typeof manifest !== "object" ||
    manifest.tenantId !== tenantId ||
    manifest.userId !== userId ||
    typeof manifest.expiresAt !== "string" ||
    !(now.getTime() < Date.parse(manifest.expiresAt))
  );
}

/**
 * Get file size
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

/**
 * Generate export ID
 */
function generateExportId(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  const crypto = require("crypto") as typeof CryptoTypes;
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
  return `export-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

// ==========================================
// RIGHT TO ERASURE (Right to be Forgotten)
// ==========================================

/**
 * Erase user data for GDPR Article 17 (Right to Erasure).
 *
 * D-11 (ADR-063): an erasure PSEUDONYMISES the account in place — it
 * never removes the row. The row's id is what calibration records, signatures,
 * certificates and the audit trail point at (ON DELETE RESTRICT, ADR-051
 * Q-16), and those are records the platform must retain (21 CFR Part 11,
 * ISO 17025; GDPR Art. 17(3)(b)). What identifies or authenticates the person
 * is destroyed; the id that keeps the retained records attributable stays.
 *
 * There is no physical delete. `hardDelete: true` used to select a function
 * named hardDeleteUser that ran a paranoid (soft) destroy — every column,
 * password hash included, stayed readable — and reported `hard_deleted`. It
 * is now refused (400) rather than honoured with something else.
 *
 * @param tenantId - Tenant ID
 * @param userId - User ID to erase
 * @param options - Erasure options
 * @param options.anonymize - default true; false = soft delete only (the
 *   account is closed, NOTHING is erased; reported as `soft_deleted`)
 * @param options.hardDelete - refused: not offered (D-11)
 * @param options.requestedBy - A-124: the user who requested the
 *   erasure; the audit row's actor. Refused (400) when absent — an erasure is
 *   never recorded without one.
 */
const eraseUserData = async (
  tenantId: TenantId,
  userId: UserId,
  options: { anonymize?: boolean; hardDelete?: boolean; requestedBy?: UserId | null } = {},
): Promise<{ erased: true; method: string; erasureDate: string }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Data erasure is disabled");
  }
  if (!options.requestedBy) {
    throw new AppError(400, "An erasure must name the user who requested it");
  }

  if (options.hardDelete === true) {
    throw new AppError(
      400,
      "A physical delete of an account is not offered: the account is referenced by calibration, " +
        "signature and audit records that must be retained (21 CFR Part 11, ISO 17025). An erasure " +
        "pseudonymises the account in place instead — its name, contact details, credentials and " +
        "second factors are destroyed. Omit hardDelete to erase.",
    );
  }
  const anonymize = options.anonymize !== false;
  const method = anonymize ? "anonymized" : "soft_deleted";
  let avatarFile: string | null = null;

  try {
    // A-153 / A-154: the erasure and the audit row that records it are ONE
    // transaction. The row used to be written first, on its own, so a failed
    // erasure left a permanent record of an erasure that did not happen.
    await db.transaction(async (transaction) => {
      const { User } = modelsBarrel();
      const user = await User.findOne({
        where: { id: userId, tenantId },
        attributes: ["id", "avatarUrl"],
        transaction,
      });
      if (!user) {
        throw new AppError(404, "User not found");
      }

      let sessionsRevoked = 0;
      if (anonymize) {
        ({ avatarFile, sessionsRevoked } = await anonymizeUser(tenantId, user, transaction));
      } else {
        await softDeleteUser(tenantId, userId, transaction);
      }

      await auditService.logAction(
        {
          tenantId,
          // A-124 (ADR-051 Q-13): the requester is the actor — never a null user.
          userId: options.requestedBy,
          action: "DELETE",
          resourceType: "User",
          resourceId: userId,
          // Which erasure, not what was erased: the trail is never purged.
          changes: {
            operation: "GDPR_ERASURE",
            method,
            sessionsRevoked,
            avatarRemoved: Boolean(avatarFile),
          },
        },
        { transaction },
      );
    });
  } catch (err) {
    logger.error("Data erasure failed", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    if (err instanceof AppError && err.status < 500) {
      throw err;
    }
    throw new AppError(500, "Failed to erase user data");
  }

  // A-154: the avatar file goes AFTER the commit that stopped referencing it.
  // A rolled-back erasure keeps its file; a leftover file after a committed
  // one is a storage leak to log, not a reason to report the erasure failed.
  // `avatarFile` is assigned inside the transaction callback above.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set asynchronously, in the callback
  if (avatarFile) {
    try {
      await deleteUpload(avatarFile, AVATAR_FOLDER);
    } catch (err) {
      logger.warn("Failed to delete an erased user's avatar file", {
        userId,
        error: messageOf(err),
      });
    }
  }

  logger.info("User data erased", {
    tenantId,
    userId,
    method,
  });

  return {
    erased: true,
    method,
    erasureDate: new Date().toISOString(),
  };
};

/** Where avatars are stored (user.service), and its "no photo" sentinel. */
const AVATAR_FOLDER = "uploads/public/profile";
const AVATAR_PLACEHOLDER = "default.svg";

/**
 * Every second-factor and one-time-code column back to "never enrolled"
 * (A-154). The TOTP set is mfa.service's MFA_CLEARED; the WebAuthn and OTP
 * columns are the account's other authenticators.
 */
const AUTHENTICATORS_CLEARED = Object.freeze({
  webauthnEnabled: false,
  webauthnCredentialId: null,
  webauthnPublicKey: null,
  webauthnSignCount: 0,
  otpCode: null,
  otpExpiredAt: null,
});

/**
 * The password column of an erased account (D-11). Not a bcrypt hash, so it
 * matches no password (`bcrypt.compare` answers false for it), and it replaces
 * the hash an erasure used to leave behind: a hash of the person's password is
 * their data too, and crackable offline.
 */
const ERASED_PASSWORD = "!erased";

/**
 * Sign-in history and credential state an erasure resets (D-11): when the
 * person last signed in, their lockout and one-time-code counters, and the
 * password bookkeeping. None of it is needed to keep a retained record
 * attributable, and all of it describes the person.
 */
const SIGN_IN_STATE_CLEARED = Object.freeze({
  password: ERASED_PASSWORD,
  passwordChangedAt: null,
  mustChangePassword: false,
  lastLoginAt: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  otpRequestCount: 0,
  otpLastRequestedAt: null,
  isEmailVerified: false,
});

/**
 * Anonymize an account in place (A-154), inside the caller's transaction:
 * identity replaced, avatar reference dropped, every second factor and
 * one-time code cleared, the account deactivated, and every session revoked.
 * Before A-154 only the name, email and phone changed: the avatar photo, the
 * live sessions, the TOTP secret and recovery codes and the passkey stayed.
 *
 * @param tenantId - the subject's tenant
 * @param user - the loaded account
 * @param transaction - the erasure's transaction
 * @returns the avatar file to delete after commit, and how many sessions ended
 */
async function anonymizeUser(
  tenantId: TenantId,
  user: { id: UserId; avatarUrl: string | null },
  transaction: Transaction,
): Promise<{ avatarFile: string | null; sessionsRevoked: number }> {
  const { User } = modelsBarrel();
  // Lazily: mfa.service loads otplib, session.service the Session model.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: mfa.service loads otplib
  const { MFA_CLEARED } = require("./mfa.service") as typeof mfaServiceType;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: session.service loads the Session model
  const { revokeOtherSessions } = require("./session.service") as typeof sessionServiceType;
  const userId = user.id;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() of the stored value
  const stored = user.avatarUrl ? String(user.avatarUrl).split("/").pop() : null;
  const avatarFile = stored && stored !== AVATAR_PLACEHOLDER ? stored : null;

  await User.update(
    {
      email: `erased_${userId}@erased.local`,
      username: `erased_${userId.substring(0, 8)}`,
      firstName: "[REDACTED]",
      lastName: "[REDACTED]",
      phone: null,
      // The column is NOT NULL; the placeholder is its "no photo" value.
      avatarUrl: AVATAR_PLACEHOLDER,
      status: "erased",
      // An erased account never signs in again (auth refuses !isActive).
      isActive: false,
      ...MFA_CLEARED,
      ...AUTHENTICATORS_CLEARED,
      ...SIGN_IN_STATE_CLEARED,
    },
    { where: { id: userId, tenantId }, transaction },
  );

  const sessionsRevoked = await revokeOtherSessions(userId, null, "GDPR_ERASURE", {
    transaction,
  });

  return { avatarFile, sessionsRevoked };
}

/**
 * Soft delete user
 */
async function softDeleteUser(tenantId: TenantId, userId: UserId, transaction: Transaction): Promise<void> {
  const { User } = modelsBarrel();

  // As built: `deletedAt` is written with the status.
  const closed: Record<string, unknown> = {
    status: "deleted",
    deletedAt: new Date(),
  };
  await User.update(
    closed,
    { where: { id: userId, tenantId }, transaction },
  );
}

// ==========================================
// CONSENT MANAGEMENT
// ==========================================

/**
 * Record user consent for data processing
 * @param tenantId - Tenant ID
 * @param userId - User ID
 * @param purpose - Consent purpose
 * @param version - Consent version
 * @param ip - User IP
 */
const recordConsent = async (
  tenantId: TenantId,
  userId: UserId,
  purpose: string,
  version = "1.0",
  ip = "",
  actor: AuditActorInput | null = null,
): Promise<{ consentId: string }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }

  try {
    const { ConsentRecord } = modelsBarrel();

    const record = await db.transaction(async (transaction) => {
      const created = await ConsentRecord.create(
        {
          tenantId,
          userId,
          purpose,
          version,
          ipAddress: ip,
          consentedAt: new Date(),
          status: "granted",
        },
        { transaction },
      );
      await auditGdpr(transaction, tenantId, userId, actor, "CREATE", "ConsentRecord", created.id, {
        operation: "GDPR_CONSENT_GRANT",
        purpose,
        version,
      });
      return created;
    });

    logger.info("Consent recorded", {
      tenantId,
      userId,
      purpose,
      version,
    });

    return { consentId: record.id };
  } catch (err) {
    logger.error("Failed to record consent", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    throw new AppError(500, "Failed to record consent");
  }
};

/**
 * Withdraw user consent
 * @param tenantId - Tenant ID
 * @param userId - User ID
 * @param purpose - Consent purpose to withdraw
 */
const withdrawConsent = async (
  tenantId: TenantId,
  userId: UserId,
  purpose: string,
  actor: AuditActorInput | null = null,
): Promise<{ withdrawn: true }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }

  try {
    const { ConsentRecord } = modelsBarrel();

    await db.transaction(async (transaction) => {
      const [withdrawn] = await ConsentRecord.update(
        {
          status: "withdrawn",
          withdrawnAt: new Date(),
        },
        {
          where: { tenantId, userId, purpose, status: "granted" },
          transaction,
        },
      );
      // Recorded even when nothing was granted: the request itself is evidence.
      await auditGdpr(transaction, tenantId, userId, actor, "UPDATE", "ConsentRecord", null, {
        operation: "GDPR_CONSENT_WITHDRAW",
        purpose,
        withdrawn,
      });
    });

    logger.info("Consent withdrawn", { tenantId, userId, purpose });
    return { withdrawn: true };
  } catch (err) {
    logger.error("Failed to withdraw consent", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    throw new AppError(500, "Failed to withdraw consent");
  }
};

/**
 * Get user consent history
 */
const getConsentHistory = async (
  tenantId: TenantId,
  userId: UserId,
): Promise<ModelInstance<"ConsentRecord">[]> => {
  try {
    const { ConsentRecord } = modelsBarrel();

    const records = await ConsentRecord.findAll({
      where: { tenantId, userId },
      order: [["consentedAt", "DESC"]],
    });

    return records;
  } catch (err) {
    logger.error("Failed to get consent history", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    return [];
  }
};

/**
 * Update consent across one or more categories in a single call.
 * consent=true grants each category; consent=false withdraws each.
 * @param tenantId
 * @param userId
 * @param categories
 * @param consent
 * @param ip
 */
const updateConsent = async (
  tenantId: TenantId,
  userId: UserId,
  categories: unknown,
  consent: unknown,
  ip = "",
  actor: AuditActorInput | null = null,
): Promise<{ updated: number; consent: boolean; categories: string[] }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Consent management is disabled");
  }
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new AppError(400, "categories must be a non-empty array");
  }
  if (typeof consent !== "boolean") {
    throw new AppError(400, "consent must be a boolean");
  }

  // As built: each category is passed on as given.
  const purposes = categories as string[];
  for (const purpose of purposes) {
    if (consent) {
      await service.recordConsent(tenantId, userId, purpose, "1.0", ip, actor);
    } else {
      await service.withdrawConsent(tenantId, userId, purpose, actor);
    }
  }

  return { updated: purposes.length, consent, categories: purposes };
};

// ==========================================
// PROCESSING ACTIVITIES / RECTIFICATION / RESTRICTION
// ==========================================

/**
 * Records of processing activities (GDPR Article 30). Returns the disclosure of
 * how the platform processes the subject's personal data.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so it answers a promise
const getProcessingActivities = async (tenantId: TenantId, userId: UserId): Promise<Record<string, unknown>> => {
  return {
    // Q-43: the product name until the owner supplies the legal entity (doc 20 §14).
    controller: "Device Calibrator",
    tenantId,
    subjectId: userId,
    generatedAt: new Date().toISOString(),
    activities: [
      {
        purpose: "Account & authentication",
        legalBasis: "Contract",
        dataCategories: ["identity", "credentials", "session metadata"],
        retention: "Life of the account",
      },
      {
        purpose: "Calibration & maintenance records",
        legalBasis: "Legal obligation (ISO 17025)",
        dataCategories: ["device", "measurements", "operator identity"],
        retention: "Per data-retention policy",
      },
      {
        purpose: "Audit trail",
        legalBasis: "Legal obligation (FDA 21 CFR Part 11)",
        dataCategories: ["actor", "action", "timestamp", "ip address"],
        retention: "At least the lifetime of the underlying record",
      },
      {
        purpose: "Notifications",
        legalBasis: "Legitimate interest",
        dataCategories: ["contact details"],
        retention: "Per data-retention policy",
      },
      {
        purpose: "Billing & subscription",
        legalBasis: "Contract",
        dataCategories: ["subscription", "invoices"],
        retention: "Statutory financial retention period",
      },
    ],
  };
};

/**
 * Rectify a personal-data field (GDPR Article 16). Only a whitelist of
 * self-service profile fields may be changed here.
 *
 * A-214 (ADR-068): an EMAIL change needs fresh re-authentication — the A-114
 * rule (auth.service#reauthenticate): the current password, and on an MFA
 * account a current TOTP or recovery code, spent in this transaction. Without
 * it a stolen session could move the address, then reset the password through
 * it and own the account. A session that signed in through SSO is answered
 * 409: its address is the identity provider's (and the key SSO matches on).
 * The other fields need no re-authentication.
 *
 * @param tenantId
 * @param userId - the caller, who is the subject
 * @param field
 * @param value
 * @param actor
 * @param reauth
 */
const rectifyData = async (
  tenantId: TenantId,
  userId: UserId,
  field: string,
  value: unknown,
  actor: { ipAddress?: string | null; userAgent?: string | null } = {},
  reauth: { currentPassword?: string; code?: string; recoveryCode?: string; signInMethod?: string | null } = {},
): Promise<{ rectified: true; field: string; emailVerificationRequired?: true }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Rectification is disabled");
  }
  const ALLOWED_FIELDS = ["firstName", "lastName", "phone", "email"];
  if (!ALLOWED_FIELDS.includes(field)) {
    throw new AppError(
      400,
      `Field "${field}" cannot be rectified. Allowed: ${ALLOWED_FIELDS.join(", ")}`,
    );
  }

  const { User } = modelsBarrel();
  const isEmail = field === "email";
  const newValue = isEmail ? normalizeRectifiedEmail(value) : value;
  let emailChange: { previous: string; firstName: string; lastName: string } | null = null;
  let reauthenticatedWith: string | null = null;

  // A-153: the change and its audit row are ONE transaction (the row was
  // written after the commit, and a failure to write it was only logged). The
  // row names the FIELD, never the new value: audit_logs is permanent and
  // never purged, so writing the value there put the very personal data being
  // corrected into a record that can never be corrected or erased.
  try {
    await db.transaction(async (transaction) => {
      const changes: Record<string, unknown> = { [field]: newValue };

      if (isEmail) {
        // A-214: the whole row — re-authentication reads the password hash
        // and the MFA state.
        const user = await User.findOne({
          where: { id: userId, tenantId },
          transaction,
        });
        if (!user) {
          throw new AppError(404, "User not found");
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
        const authService = require("./auth.service") as typeof authServiceType;
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty method reads as none
        const managedBy = await authService.passwordManagedBy(user, reauth.signInMethod || null);
        if (managedBy) {
          throw new AppError(
            409,
            `You signed in through your organisation's identity provider (${managedBy.protocol.toUpperCase()}${
              managedBy.provider ? `, ${managedBy.provider}` : ""
            }). Your email address is managed there: change it with that provider, not here.`,
          );
        }
        reauthenticatedWith = await authService.reauthenticate(
          user,
          reauth,
          {
            purpose: "Changing your email address",
            transaction,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value reads as none
            ipAddress: actor.ipAddress || null,
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value reads as none
            userAgent: actor.userAgent || null,
          },
        );
        // A-180: an address the account already has is not a change — no
        // re-verification, no mail.
        // `users.email` is NOT NULL.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() of the stored value
        if (String(user.email).toLowerCase() !== newValue) {
          await assertEmailFree(User, userId, newValue as string, transaction);
          // A-180: the new address is unverified until the link sent to it
          // is followed (auth.service#activateAccount sets it back).
          changes["isEmailVerified"] = false;
          emailChange = { previous: user.email, firstName: user.firstName, lastName: user.lastName };
        }
      }

      const [count] = await User.update(changes, {
        where: { id: userId, tenantId },
        transaction,
      });
      if (count === 0) {
        throw new AppError(404, "User not found");
      }

      await auditService.logAction(
        {
          tenantId,
          userId, // self-service: the subject is the actor
          action: "UPDATE",
          resourceType: "User",
          resourceId: userId,
          changes: {
            operation: "GDPR_RECTIFICATION",
            fields: [field],
            ...(emailChange ? { emailVerificationReset: true } : {}),
            ...(reauthenticatedWith ? { reauthenticatedWith } : {}),
          },
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value reads as none
          ipAddress: actor.ipAddress || null,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value reads as none
          userAgent: actor.userAgent || null,
        },
        { transaction },
      );
    });
  } catch (err) {
    // A-180: the unique index is the last word under a race between the
    // pre-check and the write — still a 409, never a 500.
    if (err && (err as Error).name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, EMAIL_IN_USE);
    }
    throw err;
  }

  // `emailChange` is assigned inside the transaction callback above.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set asynchronously, in the callback
  if (emailChange) {
    await sendEmailChangeMail(userId, newValue as string, emailChange);
  }

  logger.info("Personal data rectified", { tenantId, userId, field });
  return {
    rectified: true,
    field,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set asynchronously, in the callback
    ...(emailChange ? { emailVerificationRequired: true as const } : {}),
  };
};

/**
 * A-180 — the 409 a rectification to a taken address answers. It explains the
 * state and what to do; it names no account and no tenant. (`users.email` is
 * unique across the platform, so "taken" can mean another tenant's account —
 * the same disclosure `POST /auth/register` and user creation already make.)
 */
const EMAIL_IN_USE =
  "This email address is already in use by another account. Choose a different address; your current address is unchanged.";

/**
 * A rectified email, trimmed and lower-cased, or a 400 when it is not an
 * address. The model's `isEmail` validator would otherwise throw a
 * SequelizeValidationError inside the transaction — a 500.
 *
 * @param value - the requested address
 * @returns the normalised address
 */
function normalizeRectifiedEmail(value: unknown): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  const { rectifiedEmailSchema } = require("../validators/gdpr.validator") as typeof GdprValidator;
  const normalised = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (!rectifiedEmailSchema.safeParse(normalised).success) {
    throw new AppError(400, "email must be a valid email address");
  }
  return normalised;
}

/**
 * Refuse (409) an address another account already holds, compared without
 * case — the check user.service makes before creating or editing a user. The
 * lookup is `unscoped` and crosses tenants on purpose: the unique index it
 * anticipates is global, and a soft-deleted account still holds its address.
 *
 * @param User - the User model
 * @param userId - the subject, excluded
 * @param email - the normalised address
 * @param transaction - the rectification's transaction
 */
async function assertEmailFree(
  User: ModelsBarrel["User"],
  userId: UserId,
  email: string,
  transaction: Transaction,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  const { where, fn, col } = require("sequelize") as Pick<typeof SequelizeTypes, "where" | "fn" | "col">;
  const taken = await User.unscoped().findOne({
    where: {
      [Op.and]: [
        where(fn("lower", col("email")), email),
        { id: { [Op.ne]: userId } },
      ],
    },
    attributes: ["id"],
    paranoid: false,
    skipTenantScope: true,
    // skipFacilityScope: the e-mail is unique across every account, so a bound subject's
    // rectification must meet every holder (P21-09; FACILITY_SCOPE_SKIPS). Only `id` is read.
    skipFacilityScope: true,
    transaction,
  });
  if (taken) {
    throw new AppError(409, EMAIL_IN_USE);
  }
}

/**
 * After the commit: a verification link to the NEW address (the activation
 * link registration sends — auth.service#activateAccount marks it verified),
 * and a notice to the PREVIOUS one, so a change the owner did not make is
 * seen. Mail is best-effort, as at registration: a queue failure is logged,
 * and the change — already committed and audited — stands.
 *
 * @param userId - the subject
 * @param email - the new address
 * @param change
 */
async function sendEmailChangeMail(
  userId: UserId,
  email: string,
  { previous, firstName, lastName }: { previous: string; firstName: string; lastName: string },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  const { generatePurposeToken } = require("../utils/jwt.util") as typeof jwtUtilType;
  const {
    queueActivationEmail,
    queueNotificationEmail,
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
  } = require("./emailQueue.service") as typeof emailQueueType;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also falls back
  const origin = (env("FRONTEND_URL") || env("HOST_URL") || "").replace(/\/+$/, "");

  try {
    // A-191: the link verifies THIS address only (activationToken.util).
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, as built: loaded at call time
    const { activationClaims } = require("../utils/activationToken.util") as typeof ActivationToken;
    const token = generatePurposeToken(activationClaims(userId, email), "activation");
    await queueActivationEmail({
      email,
      firstName,
      lastName,
      activationLink: `${origin}/activation?token=${token}`,
    });
    await queueNotificationEmail({
      email: previous,
      firstName,
      title: "Your email address was changed",
      message:
        "The email address on your account was changed. If you did not make this change, contact your administrator.",
    });
  } catch (err) {
    logger.warn("Email-change mail could not be queued", { userId, error: messageOf(err) });
  }
}

/**
 * Restrict processing (GDPR Article 18). Recorded as a DSAR of type
 * "restriction" for the compliance team to act on.
 */
const restrictProcessing = async (
  tenantId: TenantId,
  userId: UserId,
  reason: unknown,
  actor: AuditActorInput | null = null,
): Promise<{ restricted: true; requestId: string }> => {
  if (!isGdprEnabled()) {
    throw new AppError(400, "Processing restriction is disabled");
  }
  const dsar = await service.createDsar(
    tenantId,
    userId,
    "restriction",
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy reason reads as none
    { reason: reason || null },
    actor,
  );
  logger.info("Processing restriction requested", { tenantId, userId });
  return { restricted: true, requestId: dsar.dsarId };
};

// ==========================================
// PRIVACY PREFERENCES
// ==========================================
//
// A-333 (2026-10-01): `updatePrivacyPreferences` / `getPrivacyPreferences`
// were removed. They wrote and read `privacyPreferences` on User, which has no
// such attribute or column: the write was dropped, the read was always `{}`,
// and an audit row recorded a change that never happened. Nothing called
// them. A subject's per-purpose choices are the consent records above, which
// keep the grant/withdrawal history GDPR Art. 7(1) asks for.

// ==========================================
// DATA RETENTION
// ==========================================
//
// A-121 (ADR-051 Q-10, F-4): this service used to carry a second purge engine
// (`enforceDataRetention` / `purgeExpiredData`) over `data_retention_policies`.
// It had no caller, wrote no audit row, ran with no transaction, treated a
// 0-day policy as "delete everything up to now" (the opposite of the live
// engine), and could destroy a tenant's audit rows. It is removed. The one
// retention engine is `dataRetention.service` (scheduled nightly by
// retentionScheduler), and audit rows are never purged (Q-12).

// ==========================================
// DSAR (Data Subject Access Request)
// ==========================================

/**
 * Create a DSAR
 */
const createDsar = async (
  tenantId: TenantId,
  userId: UserId,
  type: string,
  details: Record<string, unknown> | null = {},
  actor: AuditActorInput | null = null,
): Promise<{ dsarId: string }> => {
  try {
    const { DsarRequest } = modelsBarrel();

    const dsar = await db.transaction(async (transaction) => {
      const dsarValues: Record<string, unknown> = {
        tenantId,
        userId,
        type, // "export", "erasure", "rectification"
        status: "pending",
        details,
        requestedAt: new Date(),
      };
      const created = await DsarRequest.create(
        // As built: the request's type and details are stored as given.
        dsarValues as CreationAttributes<ModelInstance<"DsarRequest">>,
        { transaction },
      );
      // The request type and that it was received; `details` (a free-text
      // reason) stays on the request, which the retention sweep can remove.
      await auditGdpr(transaction, tenantId, userId, actor, "CREATE", "DsarRequest", created.id, {
        operation: "GDPR_DSAR_CREATE",
        type,
        status: "pending",
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy value reads as none
        hasDetails: Object.keys(details || {}).some((k) => (details as Record<string, unknown>)[k] !== null && (details as Record<string, unknown>)[k] !== undefined),
      });
      return created;
    });

    logger.info("DSAR created", { tenantId, userId, type, dsarId: dsar.id });
    return { dsarId: dsar.id };
  } catch (err) {
    logger.error("Failed to create DSAR", {
      tenantId,
      userId,
      error: messageOf(err),
    });
    throw new AppError(500, "Failed to create DSAR");
  }
};

/**
 * Get DSAR status
 */
const getDsarStatus = async (tenantId: TenantId, dsarId: string): Promise<ModelInstance<"DsarRequest"> | null> => {
  try {
    const { DsarRequest } = modelsBarrel();

    const dsar = await DsarRequest.findOne({
      where: { tenantId, id: dsarId },
    });

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    return dsar || null;
  } catch (err) {
    logger.error("Failed to get DSAR status", { error: messageOf(err) });
    return null;
  }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Get service status
 */
const getStatus = (): { enabled: boolean; exportRetentionHours: number; consentRequired: boolean } => {
  return {
    enabled: isGdprEnabled(),
    exportRetentionHours: EXPORT_RETENTION_HOURS,
    consentRequired: CONSENT_REQUIRED,
  };
};

const service = {
  exportUserData,
  getExportDownload,
  purgeExpiredExports,
  eraseUserData,
  recordConsent,
  withdrawConsent,
  getConsentHistory,
  updateConsent,
  getProcessingActivities,
  rectifyData,
  restrictProcessing,
  createDsar,
  getDsarStatus,
  getStatus,
};

export = service;
