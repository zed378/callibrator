// src/api/services/storage.service.ts
//
// Per-tenant object-storage configuration (bring-your-own bucket) — the
// frontend for the backend storage module (/api/v1/storage/*). A tenant can
// point its files at its own S3-compatible bucket or an NFS mount, or fall back
// to the platform default. Secrets are write-only: the API returns whether
// credentials are set (`hasCredentials`) but never the values.
import { api } from "../client";

export type StorageProvider = "default" | "s3" | "nfs" | "local";

export interface StorageSettings {
  provider: StorageProvider;
  usingPlatformDefault: boolean;
  hasCredentials?: boolean;
  // s3
  bucket?: string;
  region?: string;
  endpoint?: string | null;
  forcePathStyle?: boolean;
  prefix?: string | null;
  // nfs
  root?: string;
  fsync?: boolean;
}

export interface StorageUsage {
  bytes: number;
  objects: number;
  megabytes: number;
  provider: string;
}

export interface StorageHealth {
  ok: boolean;
  driver?: string;
  error?: string;
  bucket?: string;
  root?: string;
}

// The backend wraps the payload in { success, status, message, data }.
interface Envelope<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** Fields a tenant may submit when configuring s3/nfs storage. */
export interface UpdateStorageInput {
  provider: "s3" | "nfs";
  // s3
  bucket?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // nfs
  root?: string;
  fsync?: boolean;
}

export const storageService = {
  /** Current storage configuration (secrets redacted). */
  getSettings: async (): Promise<StorageSettings> => {
    const res = await api.get<Envelope<StorageSettings>>(
      "/api/v1/storage/settings",
    );
    return res.data;
  },

  /**
   * Configure the tenant's own storage. The backend health-checks the target
   * before saving, so a 422 means the credentials/endpoint did not work.
   */
  updateSettings: async (
    input: UpdateStorageInput,
  ): Promise<StorageSettings> => {
    const res = await api.put<Envelope<StorageSettings>>(
      "/api/v1/storage/settings",
      input,
    );
    return res.data;
  },

  /** Revert to the platform default storage. */
  clearSettings: async (): Promise<StorageSettings> => {
    const res = await api.delete<Envelope<StorageSettings>>(
      "/api/v1/storage/settings",
    );
    return res.data;
  },

  /** Health-check the currently active storage backend. */
  testConnection: async (): Promise<StorageHealth> => {
    const res = await api.post<Envelope<StorageHealth>>(
      "/api/v1/storage/settings/test",
      {},
    );
    return res.data;
  },

  /** Bytes / object count the tenant is currently storing. */
  getUsage: async (): Promise<StorageUsage> => {
    const res = await api.get<Envelope<StorageUsage>>("/api/v1/storage/usage");
    return res.data;
  },

  /**
   * GET /api/v1/storage/object?key=&token= — fetch a stored object's bytes. The
   * endpoint is public and HMAC-gated: the `token` comes from a signed URL.
   */
  getObject: async (key: string, token: string): Promise<Blob> => {
    return api.get<Blob>("/api/v1/storage/object", {
      params: { key, token },
      responseType: "blob",
    });
  },
};

export default storageService;
