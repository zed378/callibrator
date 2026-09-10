import { api } from "../client";

/**
 * SCIM 2.0 provisioning (RFC 7644).
 *
 * The tenant is taken from the caller's JWT, so no tenantId is sent.
 * SCIM Users map onto platform users; SCIM Groups map onto roles.
 *
 * Backend: src/routes/api/scim.route.js (mounted /api/v1/scim/v2)
 *   GET    /Users            ?startIndex&count&filter
 *   GET    /Users/:id
 *   POST   /Users
 *   PUT    /Users/:id
 *   PATCH  /Users/:id
 *   DELETE /Users/:id
 *   GET    /Groups           ?startIndex&count&filter
 *   GET    /Groups/:id
 *   POST   /Groups
 *   PUT    /Groups/:id
 *   PATCH  /Groups/:id
 *   DELETE /Groups/:id
 */

const BASE = "/api/v1/scim/v2";

// ---------- Types ----------

export interface ScimMeta {
  resourceType: "User" | "Group";
  created?: string;
  lastModified?: string;
}

export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  name?: { givenName?: string; familyName?: string };
  emails?: { value: string; type?: string; primary?: boolean }[];
  active: boolean;
  meta?: ScimMeta;
}

export interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members?: { value: string; display?: string }[];
  meta?: ScimMeta;
}

/** SCIM ListResponse envelope (RFC 7644 §3.4.2). */
export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimUserInput {
  userName: string;
  name?: { givenName?: string; familyName?: string };
  emails?: { value: string; type?: string; primary?: boolean }[];
  active?: boolean;
  roleId?: string;
}

export interface ScimGroupInput {
  displayName: string;
  members?: { value: string; display?: string }[];
}

export interface ScimPatchOperation {
  op: "add" | "remove" | "replace";
  path?: string;
  value?: Record<string, unknown> | unknown[] | string;
}

export interface ScimListParams {
  /** 1-based, per SCIM. */
  startIndex?: number;
  count?: number;
  /** SCIM filter expression. */
  filter?: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

const emptyList = <T,>(): ScimListResponse<T> => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults: 0,
  startIndex: 1,
  itemsPerPage: 0,
  Resources: [],
});

// ---------- Filter helpers ----------

/**
 * Build a filter for a user's email.
 *
 * Note: the backend's parser matches `email eq "..."`, not the SCIM-standard
 * `userName eq "..."` — so this deliberately emits the backend's dialect.
 */
export const emailFilter = (email: string): string => `email eq "${email}"`;

/** Build an `active eq true|false` filter. */
export const activeFilter = (active: boolean): string => `active eq ${active}`;

// ---------- Service ----------

export const scimService = {
  /** GET /Users */
  getUsers: async (
    params: ScimListParams = {},
  ): Promise<ScimListResponse<ScimUser>> => {
    const response = await api.get<BackendResponse<ScimListResponse<ScimUser>>>(
      `${BASE}/Users`,
      { params },
    );
    return response.data ?? emptyList<ScimUser>();
  },

  /** GET /Users/:id */
  getUserById: async (id: string): Promise<ScimUser> => {
    const response = await api.get<BackendResponse<ScimUser>>(
      `${BASE}/Users/${id}`,
    );
    return response.data;
  },

  /** POST /Users — returns 201. */
  createUser: async (input: ScimUserInput): Promise<ScimUser> => {
    const response = await api.post<BackendResponse<ScimUser>>(
      `${BASE}/Users`,
      input,
    );
    return response.data;
  },

  /** PUT /Users/:id — full replace. */
  updateUser: async (id: string, input: ScimUserInput): Promise<ScimUser> => {
    const response = await api.put<BackendResponse<ScimUser>>(
      `${BASE}/Users/${id}`,
      input,
    );
    return response.data;
  },

  /** PATCH /Users/:id — partial update via SCIM operations. */
  patchUser: async (
    id: string,
    operations: ScimPatchOperation[],
  ): Promise<ScimUser> => {
    const response = await api.patch<BackendResponse<ScimUser>>(
      `${BASE}/Users/${id}`,
      { Operations: operations },
    );
    return response.data;
  },

  /** DELETE /Users/:id — returns 204. */
  deleteUser: async (id: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/Users/${id}`);
  },

  /** Convenience: deactivate a user without a full replace. */
  deactivateUser: (id: string): Promise<ScimUser> =>
    scimService.patchUser(id, [
      { op: "replace", path: "active", value: "false" },
    ]),

  /** Convenience: reactivate a user. */
  activateUser: (id: string): Promise<ScimUser> =>
    scimService.patchUser(id, [
      { op: "replace", path: "active", value: "true" },
    ]),

  /** GET /Groups */
  getGroups: async (
    params: ScimListParams = {},
  ): Promise<ScimListResponse<ScimGroup>> => {
    const response = await api.get<
      BackendResponse<ScimListResponse<ScimGroup>>
    >(`${BASE}/Groups`, { params });
    return response.data ?? emptyList<ScimGroup>();
  },

  /** GET /Groups/:id */
  getGroupById: async (id: string): Promise<ScimGroup> => {
    const response = await api.get<BackendResponse<ScimGroup>>(
      `${BASE}/Groups/${id}`,
    );
    return response.data;
  },

  /** POST /Groups — returns 201. */
  createGroup: async (input: ScimGroupInput): Promise<ScimGroup> => {
    const response = await api.post<BackendResponse<ScimGroup>>(
      `${BASE}/Groups`,
      input,
    );
    return response.data;
  },

  /** PUT /Groups/:id — full replace. */
  updateGroup: async (
    id: string,
    input: ScimGroupInput,
  ): Promise<ScimGroup> => {
    const response = await api.put<BackendResponse<ScimGroup>>(
      `${BASE}/Groups/${id}`,
      input,
    );
    return response.data;
  },

  /** PATCH /Groups/:id — partial update via SCIM operations. */
  patchGroup: async (
    id: string,
    operations: ScimPatchOperation[],
  ): Promise<ScimGroup> => {
    const response = await api.patch<BackendResponse<ScimGroup>>(
      `${BASE}/Groups/${id}`,
      { Operations: operations },
    );
    return response.data;
  },

  /** DELETE /Groups/:id — returns 204. */
  deleteGroup: async (id: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/Groups/${id}`);
  },
};

export default scimService;
