/**
 * P9-18 / P9-25 (ADR-103) — the contract of `gdpr.route.ts`, code-first.
 *
 * Every route is the data subject's own request: behind `auth`, with no menu
 * gate, about the caller's own data in their tenant. The one read across
 * subjects is an erasure request's status, which the tenant's privacy officer
 * (`gdpr` read) may read for anyone; for anyone else another member's request
 * is a 404, like one that does not exist (A-252). Every write is audited in its
 * transaction. The bodies are the contract's own schemas
 * (`@callibrator/contracts/gdpr`); P6-08 holds this module to them exactly.
 * Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs, type Permission } from "../../docs/openapi/operation";
import {
  rectifyData,
  requestErasure,
  restrictProcessing,
  updateConsent,
} from "../../validators/gdpr.validator";

/** The contract's schemas, by the names the operations use. */
const v = { rectifyData, requestErasure, restrictProcessing, updateConsent };

const timestamp = z.iso.datetime();
const OWN: Permission = { kind: "authenticated", reason: "The data subject's own request, about their own data in their tenant." };
const DISABLED = "When the tenant has GDPR features turned off, 400.";

/**
 * The erasure body as the validator enforces it. `confirm` is a booleanish
 * value piped into `true`, whose input side the generator cannot mark as
 * required (an absent value is refused by the pipe, not by the key), so the
 * document names it.
 */
const erasureBody = v.requestErasure.meta({
  override: ({ jsonSchema }) => {
    // `reason` is required, so the rendered object carries a `required` list.
    const schema = jsonSchema as { required: string[] };
    schema.required = [...new Set([...schema.required, "confirm"])];
  },
});

export default defineRouteDocs({
  router: "api/gdpr.route",
  mount: "/api/v1/gdpr",
  tag: "GDPR",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/export",
      operationId: "exportPersonalData",
      summary: "Export the caller's personal data (Article 20)",
      permission: OWN,
      audited: true,
      success: {
        status: 200,
        description: "Where to download the export, and until when",
        data: z.object({
          exportId: z.string(),
          downloadUrl: z.string().meta({ description: "`GET /api/v1/gdpr/exports/{exportId}/download` (A-360)" }),
          expiresAt: timestamp,
          fileSize: z.number().int(),
        }),
      },
    },
    {
      method: "get",
      path: "/exports/:exportId/download",
      operationId: "downloadPersonalDataExport",
      summary: "Download the caller's export archive (Article 15(3) / 20)",
      description:
        "The ZIP that `POST /export` wrote: JSON files of the caller's profile, the records that name them, their " +
        "consent, requests and sessions, and their audit trail. Only the caller's own export, in their tenant, " +
        "before its `expiresAt`; anything else (another subject's, another tenant's, expired, unknown, malformed) " +
        "is the same 404 (A-360, ADR-114). Each download writes an EXPORT audit row before the file is sent.",
      permission: OWN,
      audited: true,
      params: z.object({
        exportId: z
          .string()
          .regex(/^export-\d+-[0-9a-f]{8}$/)
          .meta({ description: "The export's id, from `POST /export`", example: "export-1790000000000-0a1b2c3d" }),
      }),
      success: { status: 200, description: "The archive", file: { contentType: "application/zip" } },
    },
    {
      method: "post",
      path: "/erasure",
      operationId: "requestErasure",
      summary: "Request erasure of the caller's personal data (Article 17)",
      description: "Recorded as a data subject request for the compliance team to action. `confirm` must be true.",
      permission: OWN,
      audited: true,
      body: erasureBody,
      success: { status: 201, description: "The request", data: z.object({ dsarId: z.guid() }) },
    },
    {
      method: "get",
      path: "/erasure/:requestId",
      operationId: "getErasureStatus",
      summary: "Get the status of an erasure request",
      description: "The caller's own request, or any in the tenant for a privacy officer (`gdpr` read); anything else is 404 (A-252).",
      permission: OWN,
      audited: false,
      params: z.object({ requestId: z.guid().meta({ description: "The erasure request", example: "4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b" }) }),
      success: {
        status: 200,
        description: "The request",
        data: z.object({ id: z.guid(), userId: z.guid(), type: z.string(), status: z.string(), createdAt: timestamp }).loose(),
      },
    },
    {
      method: "put",
      path: "/consent",
      operationId: "updateConsent",
      summary: "Grant or withdraw consent for processing categories",
      description: DISABLED,
      permission: OWN,
      audited: true,
      body: v.updateConsent,
      success: {
        status: 200,
        description: "What was recorded",
        data: z.object({ updated: z.number().int(), consent: z.boolean(), categories: z.array(z.string()) }),
      },
    },
    {
      method: "get",
      path: "/consent/history",
      operationId: "getConsentHistory",
      summary: "The caller's consent history",
      permission: OWN,
      audited: false,
      success: {
        status: 200,
        description: "Every consent record, newest first",
        // P9-25 item 11: the ConsentRecord row (consentRecord.model.ts). It has
        // no `category` or `consent`: the category is `purpose`, the decision
        // `status`.
        data: z.array(
          z
            .object({
              id: z.guid(),
              tenantId: z.guid(),
              userId: z.guid(),
              purpose: z.string().meta({ description: "The consent category (analytics, marketing, functional, necessary)" }),
              version: z.string(),
              ipAddress: z.string().nullable(),
              status: z.enum(["granted", "withdrawn"]),
              consentedAt: timestamp,
              withdrawnAt: timestamp.nullable(),
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .meta({ id: "ConsentRecord" }),
        ),
      },
    },
    {
      method: "get",
      path: "/processing",
      operationId: "getProcessingActivities",
      summary: "The processing register as it applies to the caller (Article 30)",
      permission: OWN,
      audited: false,
      // P9-25 item 11: exactly what gdpr.service#getProcessingActivities builds.
      success: {
        status: 200,
        description: "The activities",
        data: z.object({
          controller: z.string(),
          tenantId: z.guid(),
          subjectId: z.guid(),
          generatedAt: timestamp,
          activities: z.array(
            z.object({ purpose: z.string(), legalBasis: z.string(), dataCategories: z.array(z.string()), retention: z.string() }),
          ),
        }),
      },
    },
    {
      method: "put",
      path: "/rectify",
      operationId: "rectifyPersonalData",
      summary: "Correct one field of the caller's personal data (Article 16)",
      description: `An email change re-authenticates the caller (password, a second factor or a recovery code; A-214), unless an identity provider owns it. ${DISABLED}`,
      permission: OWN,
      audited: true,
      body: v.rectifyData,
      success: {
        status: 200,
        description: "What was corrected",
        data: z.object({ rectified: z.literal(true), field: z.string(), emailVerificationRequired: z.literal(true).optional() }),
      },
    },
    {
      method: "post",
      path: "/restrict",
      operationId: "restrictProcessing",
      summary: "Restrict processing of the caller's personal data (Article 18)",
      description: DISABLED,
      permission: OWN,
      audited: true,
      body: v.restrictProcessing,
      success: { status: 200, description: "The restriction request", data: z.object({ restricted: z.literal(true), requestId: z.guid() }) },
    },
  ],
});
