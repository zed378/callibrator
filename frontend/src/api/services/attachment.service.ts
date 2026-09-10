// src/api/services/attachment.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export interface Attachment {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId?: string | null;
  originalName: string;
  mimeType?: string | null;
  size: number;
  checksum?: string | null;
  uploadedBy?: string | null;
  createdAt: string;
}

export interface SignedUrl {
  url: string;
  token: string;
  expiresAt: string;
  expiresInSec: number;
}

export interface AttachmentUploadInput {
  file: File;
  resourceType?: string;
  resourceId?: string;
}

// Backend envelope: LIST endpoints put the array in `data` and `meta` at the
// top level; single-object endpoints put the object in `data`.
interface BackendAttachmentsResponse {
  success: boolean;
  status: number;
  message: string;
  data: Attachment[] | null;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendAttachmentResponse<T = Attachment> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

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
    const params: Record<string, string | number> = { page, limit };
    if (filters.resourceType) params.resourceType = filters.resourceType;
    if (filters.resourceId) params.resourceId = filters.resourceId;

    const response = await api.get<BackendAttachmentsResponse>(
      "/api/v1/attachments",
      { params },
    );

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

    const response = await api.post<BackendAttachmentResponse>(
      "/api/v1/attachments",
      formData,
    );
    return response.data;
  },

  /** GET /api/v1/attachments/:id — fetch a single attachment's metadata. */
  getById: async (id: string): Promise<Attachment> => {
    const response = await api.get<BackendAttachmentResponse>(
      `/api/v1/attachments/${id}`,
    );
    return response.data;
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
    const response = await api.post<BackendAttachmentResponse<SignedUrl>>(
      `/api/v1/attachments/${id}/signed-url`,
      expiresInSec ? { expiresInSec } : {},
    );
    return response.data;
  },

  /** Soft-delete an attachment. */
  remove: async (id: string): Promise<{ id: string }> => {
    const response = await api.delete<BackendAttachmentResponse<{ id: string }>>(
      `/api/v1/attachments/${id}`,
    );
    return response.data;
  },
};

export default attachmentService;
