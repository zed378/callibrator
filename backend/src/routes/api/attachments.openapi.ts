/**
 * P9-18 / P9-25 (ADR-103) — the contract of `attachments.route.ts`, code-first.
 *
 * Attachments are evidence hanging off devices, calibration records and
 * certificates. Reading and attaching need `equipment` read (every seeded
 * role holds it, so technicians record their own evidence); deleting needs
 * `equipment` write (A-28; V-12 explains why the gates are not the
 * `attachments` slug). The orphan report is also TENANT_ADMIN. An upload is
 * held in quarantine until it is virus-scanned (S-17) and counts against the
 * storage quota. The token-gated download is public: the token is the
 * credential. A row of another tenant answers 404. Examples are synthetic.
 */
import { z } from "zod";
import { personDisplay } from "@callibrator/contracts/people";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { createSignedUrlSchema } from "../../validators/attachment.validator";

const timestamp = z.iso.datetime();
const FILE = "8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
const equipment = (action: string) => ({ kind: "dynamicAccess", resource: "equipment", action }) as const;
const params = z.object({ id: z.guid().meta({ description: "The attachment", example: FILE }) });

const Attachment = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    resourceType: z.string(),
    resourceId: z.guid().nullable().meta({ description: "attachments.resource_id allows NULL (an unlinked upload)" }),
    fileName: z.string(),
    originalName: z.string(),
    mimeType: z.string().nullable(),
    size: z.number().int(),
    checksum: z.string().nullable(),
    uploadedBy: z.guid().nullable(),
    uploaderDisplay: personDisplay.nullable().optional().meta({ description: "P21-09e (P19-04 § 12): how the person is shown — a name, role, organisation, or redacted; never an id or e-mail" }),
    url: z.string().meta({ description: "The gated download route (S-01): it works for a signed-in member of the tenant only" }),
    createdAt: timestamp,
  })
  .loose()
  .meta({
    id: "Attachment",
    example: {
      id: FILE,
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      resourceType: "Certificate",
      resourceId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      fileName: "f2a9c1d0.pdf",
      originalName: "calibration-report.pdf",
      mimeType: "application/pdf",
      size: 182044,
      checksum: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      uploadedBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      url: "/api/v1/attachments/8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f/download",
      createdAt: "2030-01-15T09:00:00.000Z",
    },
  });
const paging = {
  page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ example: 20 }),
};
const FILE_ANSWER = "The file itself (inline for images and PDF, otherwise a download; ETag and Range honoured)";

export default defineRouteDocs({
  router: "api/attachments.route",
  mount: "/api/v1/attachments",
  tag: "Attachments",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:id/signed",
      operationId: "downloadSignedAttachment",
      summary: "Download an attachment with a signed, expiring token (no sign-in)",
      description:
        "The token from POST /:id/signed-url is the credential: an invalid, tampered or expired one is refused (403) before any record is read. A valid token whose file was deleted or moved to another tenant, whose tenant is suspended, or whose issuer can no longer act answers 404 (A-365).",
      permission: null,
      audited: false,
      params,
      query: z.object({
        token: z.string().meta({
          description: "`<expiry>.<tenantId>.<issuer>.<signature>` (A-365); the older `<expiry>.<signature>` shape is refused",
          example: "1893456000.0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f.u1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.3f2a",
        }),
      }),
      success: { status: 200, description: FILE_ANSWER, file: { contentType: "application/octet-stream" } },
    },
    {
      method: "post",
      path: "/",
      operationId: "uploadAttachment",
      summary: "Upload a file (multipart, field `file`)",
      description:
        "25 MB at most; documents and images (SVG refused). The file stays in quarantine until it is virus-scanned, then it is recorded with its audit row. Counts against the storage quota.",
      permission: equipment("read"),
      audited: true,
      bodyMediaType: "multipart/form-data",
      body: z.object({
        file: z.string().meta({ format: "binary" }),
        resourceType: z.string().meta({ description: "What the file is evidence for", example: "Certificate" }),
        resourceId: z.guid(),
      }),
      success: { status: 201, description: "The attachment", data: Attachment },
    },
    {
      method: "get",
      path: "/",
      operationId: "listAttachments",
      summary: "List the tenant's attachments",
      permission: equipment("read"),
      audited: false,
      query: z.object({ resourceType: z.string().optional(), resourceId: z.guid().optional(), ...paging }),
      success: { status: 200, description: "A page of attachments; pagination in the top-level `meta`", list: Attachment },
    },
    {
      method: "get",
      path: "/orphans",
      operationId: "listOrphanAttachments",
      summary: "Orphan report: live attachments whose linked record is gone",
      description: "Tenant administrators, who also need `equipment` read (D-22).",
      permission: { kind: "rbac", roles: ["TENANT_ADMIN"] },
      audited: false,
      query: z.object(paging),
      success: { status: 200, description: "A page of orphans; pagination in the top-level `meta`", list: Attachment },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getAttachment",
      summary: "Get an attachment's metadata",
      permission: equipment("read"),
      audited: false,
      params,
      success: { status: 200, description: "The attachment", data: Attachment },
    },
    {
      method: "get",
      path: "/:id/download",
      operationId: "downloadAttachment",
      summary: "Download the file",
      permission: equipment("read"),
      audited: false,
      params,
      success: { status: 200, description: FILE_ANSWER, file: { contentType: "application/octet-stream" } },
    },
    {
      method: "post",
      path: "/:id/signed-url",
      operationId: "createAttachmentSignedUrl",
      summary: "Create a signed, expiring download link (for sharing without sign-in)",
      description:
        "A-365: the lifetime is an integer from 30 s to the configured cap (default 900 s, never above 3600 s); above it, 400. The link is bound to the tenant and to the principal that minted it: it stops working when the file is deleted or moved, when the tenant is suspended, or when the issuer is deactivated (404).",
      permission: equipment("read"),
      audited: false,
      params,
      body: createSignedUrlSchema,
      success: {
        status: 200,
        description: "The link",
        data: z.object({ url: z.string(), token: z.string(), expiresAt: timestamp, expiresInSec: z.number().int() }),
      },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteAttachment",
      summary: "Delete an attachment (soft delete; frees storage quota)",
      description: "Written with its audit row in one transaction.",
      permission: equipment("write"),
      audited: true,
      params,
      conflict: "The parent certificate is approved or signed: its evidence cannot be deleted.",
      success: { status: 200, description: "Deleted", data: z.object({ id: z.guid() }) },
    },
  ],
});
