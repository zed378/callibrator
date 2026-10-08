/**
 * P9-21 / P9-25 (ADR-103) — the contract of `admin.route.ts`, code-first.
 *
 * The platform operator's console. `router.use(auth)` and
 * `router.use(rbac(["SUPER_ADMIN", "SUPERADMIN"]))` gate every route: super
 * admin only, across tenants. The tenant routes (status, flags) and the SSO
 * email-domain claim (P10-04) act on a named tenant; the access-request queue
 * (P10-05 / P10-07) has no tenant at all. Bodies and filters are the mounted
 * schemas (validators/admin.validator, @callibrator/contracts/accessRequest
 * and /publicAuth); the tenant list and status bodies are read raw.
 * Examples are synthetic.
 */
import { z } from "zod";
import { updateTenantFlagsSchema } from "../../validators/admin.validator";
import {
  approveAccessRequestSchema,
  eraseAccessRequestsSchema,
  listAccessRequestsSchema,
  rejectAccessRequestSchema,
} from "../../validators/accessRequest.validator";
import { ssoEmailDomainsSchema } from "../../validators/publicAuth.validator";
import {
  ACCESS_REQUEST_STATUSES,
  DEVICE_COUNT_BANDS,
  FACILITY_TYPES,
  REQUEST_LOCALES,
} from "@callibrator/contracts/accessRequestValues";
import { storedTenantRow, TENANT_STATUSES } from "../../docs/openapi/tenantSchemas";
import { UPSTREAM_SQL_IMPORT_STATUSES } from "@callibrator/contracts/states";
import {
  UPSTREAM_SQL_IMPORT_COMPRESSIONS,
  UPSTREAM_SQL_IMPORT_DATA_CLASSES,
  UPSTREAM_SQL_IMPORT_ERROR_CODES,
  UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES,
  listUpstreamSqlImportsSchema,
  uploadUpstreamSqlImportSchema,
} from "@callibrator/contracts/upstreamSqlImport";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { acceptProposalBody, listProposalsQuery, proposalIdParams, rejectProposalBody } from "@callibrator/contracts/inspectionCatalogue";
import { TemplateProposal, TemplateProposalQueueRow } from "../../docs/openapi/inspectionCatalogueSchemas";

const superAdmin = { kind: "rbac", roles: ["SUPER_ADMIN", "SUPERADMIN"] } as const;

const proposalParams = z.object({
  proposalId: proposalIdParams.shape.proposalId.meta({ description: "The proposal's id", example: "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4" }),
});

const tenantParams = z.object({
  id: z.guid().meta({ description: "The tenant's id", example: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" }),
});
const requestParams = z.object({
  id: z.guid().meta({ description: "The access request's id", example: "0d9c8b7a-6f5e-4d3c-8b2a-19f8e7d6c5b4" }),
});

/** One request as the queue lists it (accessRequest.service#toQueueRow). */
const queueRow = z
  .object({
    id: z.guid(),
    organisationName: z.string(),
    facilityType: z.enum(FACILITY_TYPES),
    city: z.string(),
    deviceCountBand: z.enum(DEVICE_COUNT_BANDS),
    contactName: z.string(),
    contactRole: z.string().nullable(),
    workEmail: z.string(),
    whatsapp: z.string(),
    needs: z.string().nullable(),
    locale: z.enum(REQUEST_LOCALES),
    status: z.enum(ACCESS_REQUEST_STATUSES),
    createdAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    provisionedTenantId: z.guid().nullable(),
    duplicateCount: z.number().int().meta({ description: "Other requests from the same address" }),
  })
  .meta({ id: "AccessRequestQueueRow", description: "An access request, as the queue lists it" });

const queueAnswer = z.object({
  success: z.literal(true),
  status: z.literal(200),
  message: z.string(),
  data: z.array(queueRow),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    counts: z.record(z.enum(ACCESS_REQUEST_STATUSES), z.number().int()).meta({ description: "Requests per status, over the whole queue" }),
  }),
});

const domains = z.object({ domains: z.array(z.string()).meta({ example: ["hospital.example"] }) });

/** P24-06 — `:id` of an upstream SQL import run. */
const sqlImportParams = z.object({
  id: z.guid().meta({ description: "The import run's id", example: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b" }),
});

const count = z.number().int().min(0);
const codeCounts = z.record(z.string(), count);

/** One upstream table of a run: counts and codes only, never a value. */
const sqlImportTable = z.object({
  table: z.string().meta({
    description: "The upstream table's name (structure, not data); `#invalid` for a name that is not a plain identifier",
    example: "mst_faskes",
  }),
  staged: z.boolean().meta({ description: "Whether the minimisation policy stages this table (docs/UPSTREAM/07)" }),
  reason: z.string().nullable().meta({ description: "Why its rows were not loaded: the policy's, the parser's or `schema_conflict`" }),
  columns: count,
  excludedColumns: count.meta({ description: "Columns the policy never copies (credentials, internals)" }),
  rowsLoaded: count,
  rowsRejected: count,
  rowsNotExtracted: count,
  rejections: codeCounts.meta({ description: "Rejected rows by reason", example: { invalid_date: 2 } }),
  notes: codeCounts.meta({ description: "Values loaded with a note (a zero date loaded as NULL)", example: { zero_date: 5 } }),
});

/** A run as upstreamSqlImport.service#view answers it: never the file's path or name. */
const sqlImportRun = z
  .object({
    id: z.guid(),
    status: z.enum(UPSTREAM_SQL_IMPORT_STATUSES),
    dataClass: z.enum(UPSTREAM_SQL_IMPORT_DATA_CLASSES),
    compression: z.enum(UPSTREAM_SQL_IMPORT_COMPRESSIONS),
    sizeBytes: count,
    sha256: z.string().meta({ example: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" }),
    bytesRead: count,
    uncompressedBytes: count,
    progress: z.number().min(0).max(1).meta({ description: "Bytes of the file read, over its size" }),
    rowsLoaded: count,
    rowsRejected: count,
    rowsNotExtracted: count,
    tables: z.array(sqlImportTable),
    parseSummary: z
      .object({
        statements: codeCounts,
        comments: count,
        conditionalComments: count,
        delimiterRegions: count,
        truncated: z.boolean(),
        completionMarker: z.boolean(),
      })
      .nullable()
      .meta({ description: "The parser's statement counts (every statement but CREATE TABLE and INSERT is counted and discarded)" }),
    errorCode: z.enum(UPSTREAM_SQL_IMPORT_ERROR_CODES).nullable(),
    errorSummary: z.string().nullable(),
    transformStatus: z.enum(UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES).meta({ description: "Stage 2 (staging to the application's tables) is not built yet" }),
    attempt: z.number().int().min(1),
    fileRetained: z.boolean(),
    fileRetainUntil: z.iso.datetime().nullable(),
    retryable: z.boolean(),
    cancellable: z.boolean(),
    cancelRequestedAt: z.iso.datetime().nullable(),
    uploadedBy: z.object({ id: z.guid(), name: z.string().nullable() }).nullable(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    scannedAt: z.iso.datetime().nullable(),
    parseStartedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    durationMs: count.nullable(),
  })
  .meta({ id: "UpstreamSqlImportRun", description: "One upload of an upstream SQL dump and its run into staging" });

export default defineRouteDocs({
  router: "api/admin.route",
  mount: "/api/v1/admin",
  tag: "Admin",
  tagDescription: "The platform operator's console: every tenant, its status and flags, its SSO domain claim, and the access-request queue.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/tenants",
      operationId: "adminListTenants",
      summary: "List every tenant",
      description: "Newest first. `search` matches the name or code. `page` and `limit` (default 10) are used as sent.",
      permission: superAdmin,
      audited: false,
      query: z.object({
        page: z.string().optional().meta({ example: "1" }),
        limit: z.string().optional().meta({ example: "10" }),
        search: z.string().optional(),
      }),
      success: {
        status: 200,
        description: "A page of tenants (the page is inside `data`)",
        data: z.object({
          total: z.number().int(),
          page: z.number().int(),
          limit: z.number().int(),
          totalPages: z.number().int(),
          tenants: z.array(storedTenantRow),
        }),
      },
    },
    {
      method: "patch",
      path: "/tenants/:id/status",
      operationId: "adminUpdateTenantStatus",
      summary: "Set a tenant's status",
      description: "Audited under PLATFORM and the tenant; the tenant caches are invalidated after the commit.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: z.object({ status: z.enum(TENANT_STATUSES).meta({ description: "Any other value is a 400" }) }),
      success: { status: 200, description: "The tenant", data: storedTenantRow },
    },
    {
      method: "patch",
      path: "/tenants/:id/flags",
      operationId: "adminUpdateTenantFlags",
      summary: "Set a tenant's flags",
      description: "A-174: a plain object of flag keys to scalar values, never a secret-named key. Audited.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: updateTenantFlagsSchema,
      success: { status: 200, description: "The tenant", data: storedTenantRow },
    },
    {
      method: "get",
      path: "/tenants/:id/sso-domains",
      operationId: "adminGetSsoDomains",
      summary: "Get a tenant's SSO email-domain claim",
      description: "P10-04: the domains whose identifier-first sign-in discovery starts this tenant's SSO.",
      permission: superAdmin,
      audited: false,
      params: tenantParams,
      success: { status: 200, description: "The claimed domains", data: domains },
    },
    {
      method: "put",
      path: "/tenants/:id/sso-domains",
      operationId: "adminPutSsoDomains",
      summary: "Set a tenant's SSO email-domain claim",
      description: "Replaces the list; audited. A public mailbox domain is a 400.",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      body: ssoEmailDomainsSchema.omit({ id: true }),
      success: { status: 200, description: "The saved list", data: domains },
      conflict: "Another tenant has claimed one of the domains.",
    },
    {
      method: "get",
      path: "/access-requests",
      operationId: "adminListAccessRequests",
      summary: "The access-request queue",
      description: "P10-07: filtered by `status` (default `pending`), newest first.",
      permission: superAdmin,
      audited: false,
      query: listAccessRequestsSchema,
      success: { status: 200, description: "A page of requests, with per-status counts in `meta`", body: queueAnswer },
    },
    {
      method: "post",
      path: "/access-requests/erasure",
      operationId: "adminEraseAccessRequests",
      summary: "Erase a requester's access requests (DSAR)",
      description:
        "By address. Requests that never became a tenant are deleted; an approved one keeps its tenant link with its " +
        "personal fields masked. Audited.",
      permission: superAdmin,
      audited: true,
      body: eraseAccessRequestsSchema,
      success: { status: 200, description: "What was erased", data: z.object({ deleted: z.number().int(), masked: z.number().int() }) },
    },
    {
      method: "get",
      path: "/access-requests/:id",
      operationId: "adminGetAccessRequest",
      summary: "One access request",
      description: "The request, its decider, its tenant, its invitation state and the other requests from the same address.",
      permission: superAdmin,
      audited: false,
      params: requestParams,
      success: {
        status: 200,
        description: "The request",
        data: queueRow.extend({
          decisionNote: z.string().nullable(),
          decidedBy: z.object({ id: z.guid(), name: z.string().nullable() }).nullable(),
          provisionedTenant: z.object({ id: z.guid(), code: z.string().nullable(), name: z.string() }).nullable(),
          adminUserId: z.guid().nullable(),
          invitation: z.object({
            sentAt: z.iso.datetime().nullable(),
            expiresAt: z.iso.datetime().nullable(),
            acceptedAt: z.iso.datetime().nullable(),
            resendable: z.boolean(),
          }),
          duplicates: z.array(z.object({ id: z.guid(), organisationName: z.string(), status: z.enum(ACCESS_REQUEST_STATUSES), createdAt: z.iso.datetime() })),
        }),
      },
    },
    {
      method: "post",
      path: "/access-requests/:id/approve",
      operationId: "adminApproveAccessRequest",
      summary: "Approve an access request",
      description:
        "P10-05: in ONE transaction under a row lock, creates the tenant (tenant.service#createTenant), its first " +
        "administrator with no usable password, and a single-use seven-day invitation; audited. The invitation email " +
        "goes to the request's own address after the commit.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      body: approveAccessRequestSchema.omit({ id: true }),
      success: {
        status: 200,
        description: "Approved",
        data: z.object({
          request: queueRow,
          // tenantService.createTenant's row (P9-25: the fields the queue reads, named).
          tenant: z.looseObject({ id: z.guid(), code: z.string().nullable(), name: z.string() }),
          adminUser: z.object({ id: z.guid(), email: z.string() }),
          invitationSent: z.boolean(),
        }),
      },
      conflict: "The request is not pending, the tenant code or name is taken, or the address already has an account; the request stays pending.",
    },
    {
      method: "post",
      path: "/access-requests/:id/reject",
      operationId: "adminRejectAccessRequest",
      summary: "Reject an access request, or mark it spam",
      description: "A reason is required; audited.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      body: rejectAccessRequestSchema.omit({ id: true }),
      success: { status: 200, description: "The rejected request", data: queueRow },
      conflict: "The request is not pending.",
    },
    {
      method: "post",
      path: "/access-requests/:id/resend-invitation",
      operationId: "adminResendInvitation",
      summary: "Re-issue an approved request's invitation",
      description: "A new token; the old one stops working; audited.",
      permission: superAdmin,
      audited: true,
      params: requestParams,
      success: {
        status: 200,
        description: "Re-issued",
        data: z.object({ invitationSent: z.boolean(), expiresAt: z.iso.datetime() }),
      },
      conflict: "The request is not approved, or its invitation was already accepted.",
    },
    {
      method: "get",
      path: "/upstream-sql-imports/settings",
      operationId: "adminUpstreamSqlImportSettings",
      summary: "The SQL-dump import's limits and its DPIA gate",
      description:
        "P24-06: the upload cap, the decompressed cap, a failed run's file retention, whether real upstream data may be " +
        "imported (UPSTREAM_REAL_DATA_ALLOWED) and whether stage 2 exists.",
      permission: superAdmin,
      audited: false,
      success: {
        status: 200,
        description: "The settings",
        data: z.object({
          maxUploadBytes: count,
          maxUncompressedBytes: count,
          failedRetentionDays: count,
          realDataAllowed: z.boolean(),
          transformAvailable: z.boolean(),
        }),
      },
    },
    {
      method: "get",
      path: "/upstream-sql-imports",
      operationId: "adminListUpstreamSqlImports",
      summary: "The SQL-dump import runs",
      description: "P24-06: newest first, optionally by `status`. A run whose worker died is failed (`INTERRUPTED`) before the list is read.",
      permission: superAdmin,
      audited: false,
      query: listUpstreamSqlImportsSchema,
      success: { status: 200, description: "A page of runs; pagination in the top-level `meta`", list: sqlImportRun },
    },
    {
      method: "post",
      path: "/upstream-sql-imports",
      operationId: "adminUploadUpstreamSqlDump",
      summary: "Upload an upstream SQL dump (multipart, field `file`)",
      description:
        "P24-06: a mysqldump / MariaDB dump, plain or gzip, up to UPSTREAM_IMPORT_MAX_BYTES (200 MB by default). It is NEVER executed: " +
        "it is held in the upload quarantine, virus-scanned, then PARSED by a background job into the `upstream_import` staging schema " +
        "(only CREATE TABLE and INSERT are read; the minimisation policy decides which tables and columns are kept). The uploader is " +
        "notified in-app and by e-mail when it ends. `dataClass` is the uploader's declaration: `real` is refused while " +
        "UPSTREAM_REAL_DATA_ALLOWED is off. The request has UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS (15 minutes by default), not 30 s. Audited.",
      permission: superAdmin,
      audited: true,
      bodyMediaType: "multipart/form-data",
      body: uploadUpstreamSqlImportSchema.extend({ file: z.string().meta({ format: "binary" }) }),
      success: { status: 201, description: "The run, queued", data: sqlImportRun },
      conflict: "Another import is uploaded, scanning or parsing. (A file declared real while UPSTREAM_REAL_DATA_ALLOWED is off is a 403, as for the rsync image import.)",
    },
    {
      method: "get",
      path: "/upstream-sql-imports/:id",
      operationId: "adminGetUpstreamSqlImport",
      summary: "One SQL-dump import run",
      description: "P24-06: its status, progress, per-table counts and reasons, and its failure code: counts only, never a value from the dump.",
      permission: superAdmin,
      audited: false,
      params: sqlImportParams,
      success: { status: 200, description: "The run", data: sqlImportRun },
    },
    {
      method: "post",
      path: "/upstream-sql-imports/:id/cancel",
      operationId: "adminCancelUpstreamSqlImport",
      summary: "Cancel a SQL-dump import run",
      description:
        "P24-06: a queued run is cancelled at once and its file deleted; a scanning or parsing run is asked to stop (`cancelRequestedAt`), " +
        "its staging rows are rolled back and its file deleted by the worker. Asking twice answers the run unchanged. Audited.",
      permission: superAdmin,
      audited: true,
      params: sqlImportParams,
      success: { status: 200, description: "The run", data: sqlImportRun },
      conflict: "The run is loaded, failed or cancelled.",
    },
    {
      method: "post",
      path: "/upstream-sql-imports/:id/retry",
      operationId: "adminRetryUpstreamSqlImport",
      summary: "Retry a failed SQL-dump import run",
      description: "P24-06: only a failed run whose file is still kept; the re-run REPLACES the run's staging rows. Audited.",
      permission: superAdmin,
      audited: true,
      params: sqlImportParams,
      success: { status: 200, description: "The run, queued again", data: sqlImportRun },
      conflict: "The run is not failed, its file was deleted, or another import is active. (A run declared real while UPSTREAM_REAL_DATA_ALLOWED is off is a 403.)",
    },
    {
      method: "get",
      path: "/ipm/template-proposals",
      operationId: "adminListInspectionTemplateProposals",
      summary: "The catalogue proposal queue",
      description: "P21-01 (ADR-125 § 5): every tenant's proposals, oldest first, with the tenant each came from.",
      permission: superAdmin,
      audited: false,
      query: listProposalsQuery,
      success: { status: 200, description: "A page of proposals; pagination in the top-level `meta`", list: TemplateProposalQueueRow },
    },
    {
      method: "post",
      path: "/ipm/template-proposals/:proposalId/accept",
      operationId: "adminAcceptInspectionTemplateProposal",
      summary: "Accept a catalogue proposal",
      description:
        "P21-01: opens a draft on the device type's checklist (creating the checklist when it has none) or links the open one — " +
        "nothing is copied from the proposal: the operator adds each item to the draft. A new-type proposal names the type the " +
        "operator created (`deviceTypeId`). The submitter is notified; audited in the proposal's tenant. An API key is refused.",
      permission: superAdmin,
      audited: true,
      params: proposalParams,
      body: acceptProposalBody,
      conflict: "The proposal was already decided or withdrawn, or the device type / its checklist is retired.",
      success: { status: 200, description: "The proposal, with the draft it opened", data: TemplateProposal },
    },
    {
      method: "post",
      path: "/ipm/template-proposals/:proposalId/reject",
      operationId: "adminRejectInspectionTemplateProposal",
      summary: "Reject a catalogue proposal",
      description: "P21-01: with a decision note. The submitter is notified; audited in the proposal's tenant. An API key is refused.",
      permission: superAdmin,
      audited: true,
      params: proposalParams,
      body: rejectProposalBody,
      conflict: "The proposal was already decided or withdrawn.",
      success: { status: 200, description: "The proposal", data: TemplateProposal },
    },
  ],
});
