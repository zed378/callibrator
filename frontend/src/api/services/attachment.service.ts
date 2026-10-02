// src/api/services/attachment.service.ts
//
// P9-25 (ADR-103 item 11): the JSON calls are on the GENERATED client and the
// types are the contract's (backend/src/routes/api/attachments.openapi.ts); the
// names are unchanged. The multipart upload and the byte downloads stay on `api`.
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type Op, type QueryOf, type components } from "../typed";
import { PaginatedResponse } from "@/types";

/**
 * An attachment. `url` is the GATED, host-relative download route
 * `/api/v1/attachments/<id>/download` (S-01, ADR-042 step 4) — never an
 * `/uploads/...` path. It works for a signed-in member of the attachment's
 * tenant (same-origin, through the API proxy), inline for images and PDF, and
 * stops working when the attachment is deleted. For someone without a session,
 * mint a signed URL.
 */
export type Attachment = components["schemas"]["Attachment"];

export type SignedUrl = DataOf<Op<"/api/v1/attachments/{id}/signed-url", "post">>;

export interface AttachmentUploadInput {
  file: File;
  resourceType?: string;
  resourceId?: string;
}

const byId = (id: string) => ({ params: { path: { id } } });

export interface AttachmentFilters {
  resourceType?: string;
  resourceId?: string;
}

export const attachmentService = {
  getAll: async (
    page = 1,
    limit = 10,
    filters: AttachmentFilters = {},
  ): Promise<PaginatedResponse<Attachment>> => {
    const params: QueryOf<Op<"/api/v1/attachments", "get">> = { page, limit };
    if (filters.resourceType) params.resourceType = filters.resourceType;
    if (filters.resourceId) params.resourceId = filters.resourceId;

    const response = await typedApi.GET("/api/v1/attachments", { params: { query: params } }).then(unwrap);

    const rows: Attachment[] = Array.isArray(response?.data)
      ? response.data
      : [];
    const meta = response?.meta;
    const total = meta?.total ?? rows.length;
    const lim = meta?.limit ?? limit;

    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? page,
        limit: lim,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  /** Upload a file (multipart). The browser sets the multipart boundary. */
  upload: async (input: AttachmentUploadInput): Promise<Attachment> => {
    const formData = new FormData();
    formData.append("file", input.file);
    if (input.resourceType) formData.append("resourceType", input.resourceType);
    if (input.resourceId) formData.append("resourceId", input.resourceId);

    const response = await api.post<{ data: Attachment }>("/api/v1/attachments", formData);
    return response.data;
  },

  /** GET /api/v1/attachments/:id — fetch a single attachment's metadata. */
  getById: async (id: string): Promise<Attachment> => {
    return (await typedApi.GET("/api/v1/attachments/{id}", byId(id)).then(unwrap)).data;
  },

  /**
   * GET /api/v1/attachments/:id/download — fetch the file bytes (session-authed
   * via the proxy). Use downloadToDevice for a one-call "save file" action.
   */
  download: async (id: string): Promise<Blob> => {
    return api.get<Blob>(`/api/v1/attachments/${id}/download`, {
      responseType: "blob",
    });
  },

  /** Fetch and save an attachment to the user's device (browser only). */
  downloadToDevice: async (id: string, filename: string): Promise<void> => {
    const blob = await attachmentService.download(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Mint a short-lived signed URL for downloading without a session. */
  getSignedUrl: async (
    id: string,
    expiresInSec?: number,
  ): Promise<SignedUrl> => {
    return (
      await typedApi
        .POST("/api/v1/attachments/{id}/signed-url", { ...byId(id), body: expiresInSec ? { expiresInSec } : {} })
        .then(unwrap)
    ).data;
  },

  /** Soft-delete an attachment. */
  remove: async (id: string): Promise<{ id: string }> => {
    return (await typedApi.DELETE("/api/v1/attachments/{id}", byId(id)).then(unwrap)).data;
  },
};

export default attachmentService;
