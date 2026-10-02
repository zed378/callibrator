// src/api/services/storage.service.ts
//
// Per-tenant object-storage configuration (bring-your-own bucket) — the
// frontend for the backend storage module (/api/v1/storage/*). A tenant can
// point its files at its own S3-compatible bucket or an NFS mount, or fall back
// to the platform default. Secrets are write-only: the API returns whether
// credentials are set (`hasCredentials`) but never the values.
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
// contract's (backend/src/routes/api/storage.openapi.ts). The exported names are
// unchanged. The object download stays on `api` (a blob, not JSON).
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

export type StorageSettings = components["schemas"]["StorageSettings"];
export type StorageProvider = StorageSettings["provider"];
export type StorageUsage = DataOf<Op<"/api/v1/storage/usage", "get">>;
export type StorageHealth = DataOf<Op<"/api/v1/storage/settings/test", "post">>;

type SettingsBody = JsonBody<Op<"/api/v1/storage/settings", "put">>;

/**
 * Fields a tenant may submit when configuring s3/nfs storage: the provider and
 * any field either provider accepts (the contract's top-level list). The form
 * sends it as drafted; one that misses its provider's required field (`bucket`,
 * `root`) is answered 400 by the validator.
 */
export type UpdateStorageInput = Pick<SettingsBody, "provider"> &
  Partial<Omit<Extract<SettingsBody, { provider: "s3" }>, "provider">>;

export const storageService = {
  /** Current storage configuration (secrets redacted). */
  getSettings: async (): Promise<StorageSettings> =>
    (await typedApi.GET("/api/v1/storage/settings").then(unwrap)).data,

  /**
   * Configure the tenant's own storage. The backend health-checks the target
   * before saving, so a 422 means the credentials/endpoint did not work.
   */
  updateSettings: async (input: UpdateStorageInput): Promise<StorageSettings> =>
    // The draft as built; the validator checks the provider's branch.
    (await typedApi.PUT("/api/v1/storage/settings", { body: input as SettingsBody }).then(unwrap)).data,

  /** Revert to the platform default storage. */
  clearSettings: async (): Promise<StorageSettings> =>
    (await typedApi.DELETE("/api/v1/storage/settings").then(unwrap)).data,

  /** Health-check the currently active storage backend. */
  testConnection: async (): Promise<StorageHealth> =>
    (
      await typedApi
        // As built: an empty JSON object, though the contract reads no body.
        .POST("/api/v1/storage/settings/test", { body: {} as never })
        .then(unwrap)
    ).data,

  /** Bytes / object count the tenant is currently storing. */
  getUsage: async (): Promise<StorageUsage> =>
    (await typedApi.GET("/api/v1/storage/usage").then(unwrap)).data,

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
