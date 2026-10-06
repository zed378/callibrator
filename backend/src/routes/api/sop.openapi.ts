/**
 * P9-21 / P9-25 (ADR-103) — the contract of `sop.route.ts`, code-first.
 *
 * Every route sits behind `router.use(auth)`. Authoring and listing are gated
 * on `sop` (A-28); publishing also refuses an API key and the platform tenant
 * (A-145), and the publisher may not be the author (separation of duties).
 * Acknowledging training is deliberately auth-only: it is the caller's OWN
 * training record, and the roles that must acknowledge hold no `sop` menu.
 * The create body is validated by `createSopDocument` (W-10, 2026-10-05); the
 * other routes take no body. Examples are synthetic.
 */
import { z } from "zod";
import { createSopDocument } from "../../validators/sop.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const timestamp = z.iso.datetime();
const DOC_STATUSES = ["DRAFT", "UNDER_REVIEW", "PUBLISHED", "ARCHIVED"] as const;

/** An SOP document (the model row's JSON). */
const SopDocument = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    documentNumber: z.string(),
    title: z.string(),
    version: z.string(),
    contentUrl: z.string().nullable(),
    status: z.enum(DOC_STATUSES),
    authorId: z.guid(),
    publishedDate: timestamp.nullable(),
    requiresTraining: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    // P9-25: the list's LEFT JOIN (sop.service, A-90); null when the author is gone or outside the tenant.
    author: z
      .object({ id: z.guid(), firstName: z.string(), lastName: z.string() })
      .nullable()
      .optional()
      .meta({ description: "List only" }),
  })
  .loose()
  .meta({
    id: "SopDocument",
    description: "A controlled procedure (ISO 13485 §4.2.4). Its number is issued per tenant.",
    example: {
      id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      documentNumber: "SOP-0001",
      title: "Calibration of infusion pumps",
      version: "1.0",
      contentUrl: null,
      status: "DRAFT",
      authorId: "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
      publishedDate: null,
      requiresTraining: true,
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
    },
  });

/** A training acknowledgment (the caller's own training record, ISO 13485 §6.2). */
const TrainingAcknowledgment = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    documentId: z.guid(),
    userId: z.guid(),
    acknowledgedAt: timestamp.nullable(),
    // sopTrainingAcknowledgment.model's ENUM (P9-25).
    status: z.enum(["PENDING", "COMPLETED"]),
  })
  .loose()
  .meta({ id: "SopTrainingAcknowledgment" });

const idParams = z.object({
  id: z.guid().meta({ description: "The SOP document's id", example: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" }),
});
const NO_API_KEY = "An API key is refused (403).";
const PLATFORM = "The platform tenant authors nothing here (403, A-145).";

export default defineRouteDocs({
  router: "api/sop.route",
  mount: "/api/v1/sop",
  tag: "SOP",
  tagDescription: "Document Control and Training System",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "createSopDocument",
      summary: "Create an SOP document (draft)",
      permission: { kind: "dynamicAccess", resource: "sop", action: "write" },
      audited: true,
      body: createSopDocument,
      success: { status: 201, description: "The draft document", data: SopDocument },
    },
    {
      method: "get",
      path: "/",
      operationId: "listSopDocuments",
      summary: "List SOP documents",
      permission: { kind: "dynamicAccess", resource: "sop", action: "read" },
      audited: false,
      query: z.object({
        page: z.coerce.number().int().min(1).optional().meta({ description: "1-based page", example: 1 }),
        limit: z.coerce.number().int().min(1).optional().meta({ description: "Rows per page", example: 10 }),
        status: z.enum(DOC_STATUSES).optional(),
      }),
      success: { status: 200, description: "A page of documents; pagination in the top-level `meta`", list: SopDocument },
    },
    {
      method: "patch",
      path: "/:id/publish",
      operationId: "publishSopDocument",
      summary: "Publish an SOP and assign its training",
      description:
        `The publisher may not be the author: 403, explained (separation of duties, V-13). Training tasks are assigned to the tenant's users when the SOP requires training. ${NO_API_KEY} ${PLATFORM}`,
      permission: { kind: "dynamicAccess", resource: "sop", action: "write" },
      audited: true,
      params: idParams,
      conflict: "The SOP is already published or archived.",
      success: { status: 200, description: "The published document", data: SopDocument },
    },
    {
      method: "post",
      path: "/:id/acknowledge",
      operationId: "acknowledgeSopTraining",
      summary: "Acknowledge an SOP's training (the caller's own record)",
      description:
        `404 when no training is assigned to the caller for this SOP (another tenant's SOP reads the same). ${NO_API_KEY} ${PLATFORM}`,
      permission: {
        kind: "authenticated",
        reason:
          "Self-service: the caller acknowledges their OWN training row, and the roles that must acknowledge an SOP hold no `sop` menu (A-28).",
      },
      audited: true,
      params: idParams,
      conflict: "The caller already acknowledged this SOP: a training record is not overwritten.",
      success: { status: 200, description: "The acknowledgment", data: TrainingAcknowledgment },
    },
  ],
});
