/**
 * The contract of `upstreamFileImports.route.ts`, code-first (ADR-103): the rsync image import.
 *
 * Super admin only (`superAdminOnly`), JWT only (`denyApiKey`). No answer ever carries the
 * password or the private key, a file name, or a tool's raw message: a connection outcome is a
 * stable code, a summary is counts. Examples are synthetic.
 */
import { z } from "zod";
import { UPSTREAM_FILE_IMPORT_STATUSES } from "@callibrator/contracts/states";
import {
  checkConnectionSchema,
  importIdSchema,
  listImportsSchema,
  startImportSchema,
} from "../../validators/upstreamFileImport.validator";
import { QUARANTINE_REASONS, UPSTREAM_AUTH_METHODS, UPSTREAM_FILE_CLASS_NAMES } from "../../constants/upstreamFileImport";
import { CONNECTION_ERRORS } from "../../services/upstreamFileImport/connection";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "superAdminOnly" } as const;

const count = z.number().int().min(0);
const fileClass = z.enum(UPSTREAM_FILE_CLASS_NAMES);

const estimate = z
  .object({
    files: count,
    bytes: count,
    classes: z.partialRecord(fileClass, z.object({ files: count, bytes: count })),
  })
  .meta({ id: "UpstreamImportEstimate", description: "What the dry-run listing found (regular files and their bytes)" });

const summary = z
  .object({
    filesCopied: count,
    bytesCopied: count,
    ingested: count,
    bytesIngested: count,
    skippedPresent: count.meta({ description: "Same source path and SHA-256 as an earlier completed import" }),
    duplicateContent: count.meta({ description: "Identical content at another path in this import (each is still its own object)" }),
    metadataStripped: count.meta({ description: "Files whose GPS/XMP/IPTC metadata was removed losslessly" }),
    quarantined: count,
    quarantinedByReason: z.partialRecord(z.enum(QUARANTINE_REASONS), count),
    failed: count.meta({ description: "Files that could not be read or moved; left in staging for a re-run" }),
    durationMs: count,
  })
  .meta({ id: "UpstreamImportSummary", description: "Counts only — never a file name" });

const importView = z
  .object({
    id: z.guid(),
    targetTenantId: z.guid(),
    status: z.enum(UPSTREAM_FILE_IMPORT_STATUSES),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    remotePath: z.string(),
    fileClasses: z.array(fileClass),
    authMethod: z.enum(UPSTREAM_AUTH_METHODS),
    hostKeyType: z.string(),
    hostKeyFingerprint: z.string(),
    syntheticSource: z.boolean(),
    bandwidthLimitKbps: z.number().int().nullable(),
    estimate: estimate.nullable(),
    progress: z
      .object({ filesTransferred: count, bytesTransferred: count, filesProcessed: count, filesToProcess: count })
      .nullable(),
    summary: summary.nullable(),
    errorCode: z.string().nullable().meta({ description: "A stable reason code when the import failed" }),
    cancelRequested: z.boolean(),
    credentialStored: z.boolean().meta({ description: "Whether the encrypted credential still exists (only while the import can run)" }),
    secretErasedAt: z.iso.datetime().nullable(),
    batchJobId: z.guid().nullable(),
    requestedBy: z.guid().nullable(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "UpstreamFileImport", description: "One rsync image import (never its credential)" });

const hostKey = z.object({ type: z.string(), fingerprint: z.string() });

const checkAnswer = z
  .object({
    status: z.enum(["ok", "host_key_unconfirmed", ...CONNECTION_ERRORS]).meta({
      description: "`ok`: logged in and every class folder listed. `host_key_unconfirmed`: confirm one of `hostKeys`",
    }),
    hostKeys: z.array(hostKey),
    confirmedHostKey: hostKey.nullable(),
    classes: z.partialRecord(
      fileClass,
      z.object({ status: z.enum(["ok", "path_not_found", "path_not_readable"]), files: count, bytes: count }),
    ),
    estimate: estimate.nullable(),
  })
  .meta({ id: "UpstreamConnectionCheck", description: "A connection check's outcome (a failed connection is an answer, not an error)" });

const params = importIdSchema.extend({
  id: z.guid().meta({ description: "The import's id", example: "5f0c2b8e-3a4d-4c6b-9e1f-7a8b9c0d1e2f" }),
});

export default defineRouteDocs({
  router: "api/upstreamFileImports.route",
  mount: "/api/v1/admin/upstream-file-imports",
  tag: "Upstream Import",
  tagDescription:
    "The platform operator's import of the upstream application's device photos over rsync/SSH: check the source, " +
    "confirm its host key, run the copy in the background, and receive a notification when it ends.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/config",
      operationId: "upstreamImportConfig",
      summary: "The import's configuration",
      description: "Whether real upstream data may be imported (UPSTREAM_REAL_DATA_ALLOWED), how many hosts are allow-listed, and the file classes.",
      permission: superAdmin,
      audited: false,
      success: {
        status: 200,
        description: "The configuration",
        data: z.object({
          realDataAllowed: z.boolean(),
          allowListedHostCount: count,
          heicConversion: z.boolean(),
          fileClasses: z.array(z.object({ name: fileClass, folder: z.string() })),
        }),
      },
    },
    {
      method: "post",
      path: "/check-connection",
      operationId: "upstreamImportCheckConnection",
      summary: "Check a source server",
      description:
        "Without `confirmedFingerprint`: reads the server's SSH host keys (no login). With it: logs in with that key pinned, " +
        "lists each class folder with `rsync --dry-run --stats` and estimates files and bytes. At most 10 checks per 10 minutes " +
        "per operator (429). Audited without the credential. While UPSTREAM_REAL_DATA_ALLOWED is false only a synthetic source " +
        "on an allow-listed host is accepted (403).",
      permission: superAdmin,
      audited: true,
      body: checkConnectionSchema,
      success: { status: 200, description: "The outcome", data: checkAnswer },
    },
    {
      method: "get",
      path: "/",
      operationId: "upstreamImportList",
      summary: "List imports",
      description: "Newest first.",
      permission: superAdmin,
      audited: false,
      query: listImportsSchema,
      success: { status: 200, description: "A page of imports", list: importView },
    },
    {
      method: "post",
      path: "/",
      operationId: "upstreamImportStart",
      summary: "Start an import",
      description:
        "Runs the connection check again with the confirmed fingerprint; on success stores the import (the credential " +
        "KMS-encrypted, erased when the import ends) and queues a background job. Audited. When the job cannot be " +
        "queued the import is ended `failed` (`job_not_queued`) and the answer is 503.",
      permission: superAdmin,
      audited: true,
      body: startImportSchema,
      success: { status: 201, description: "The queued import", data: importView },
      conflict:
        "The check did not pass (the host key changed, the login or a class folder failed), the tenant is not active, " +
        "or an import of the same source into the same tenant is still running.",
    },
    {
      method: "get",
      path: "/:id",
      operationId: "upstreamImportGet",
      summary: "One import",
      permission: superAdmin,
      audited: false,
      params,
      success: { status: 200, description: "The import", data: importView },
    },
    {
      method: "post",
      path: "/:id/cancel",
      operationId: "upstreamImportCancel",
      summary: "Cancel an import",
      description:
        "A queued import ends at once; a running one stops at its next check (within seconds) and keeps what it copied " +
        "in staging for a later run. Audited; the requester is notified.",
      permission: superAdmin,
      audited: true,
      params,
      success: { status: 200, description: "The import", data: importView },
      conflict: "The import has already ended.",
    },
  ],
});
