import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";

/**
 * SCIM 2.0 provisioning (RFC 7644).
 *
 * The tenant is taken from the caller's JWT, so no tenantId is sent.
 * SCIM Users map onto platform users; SCIM Groups map onto roles.
 *
 * Backend: src/routes/api/scim.route.ts (mounted /api/v1/scim/v2)
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
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/scim.openapi.ts). The exported names are
 * unchanged.
 */

type V2 = "/api/v1/scim/v2";

// ---------- Types ----------

export type ScimUser = components["schemas"]["ScimUser"];
export type ScimGroup = components["schemas"]["ScimGroup"];
export type ScimMeta = ScimUser["meta"];

/** SCIM ListResponse envelope (RFC 7644 §3.4.2), as the two lists answer it in `data`. */
export type ScimListResponse<T> = Omit<DataOf<Op<`${V2}/Users`, "get">>, "Resources"> & { Resources: T[] };

export type ScimUserInput = JsonBody<Op<`${V2}/Users`, "post">>;
export type ScimGroupInput = JsonBody<Op<`${V2}/Groups`, "post">>;
export type ScimPatchOperation = JsonBody<Op<`${V2}/Users/{id}`, "patch">>["Operations"][number];

export interface ScimListParams {
  /** 1-based, per SCIM. */
  startIndex?: number;
  count?: number;
  /** SCIM filter expression. */
  filter?: string;
}

/**
 * The list query as published: the backend reads `startIndex` / `count` raw
 * from the query string, so they are strings (a number puts the same text on
 * the wire). A key the caller left out stays out.
 */
const listQuery = ({ startIndex, count, ...rest }: ScimListParams) => ({
  ...rest,
  ...(startIndex !== undefined && { startIndex: String(startIndex) }),
  ...(count !== undefined && { count: String(count) }),
});

const byId = (id: string) => ({ params: { path: { id } } });

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
    const response = await typedApi
      .GET("/api/v1/scim/v2/Users", { params: { query: listQuery(params) } })
      .then(unwrap);
    // Defensive, as built: a body without `data` reads as an empty list.
    return response.data ?? emptyList<ScimUser>();
  },

  /** GET /Users/:id */
  getUserById: async (id: string): Promise<ScimUser> =>
    (await typedApi.GET("/api/v1/scim/v2/Users/{id}", byId(id)).then(unwrap)).data,

  /** POST /Users — returns 201. */
  createUser: async (input: ScimUserInput): Promise<ScimUser> =>
    (await typedApi.POST("/api/v1/scim/v2/Users", { body: input }).then(unwrap)).data,

  /** PUT /Users/:id — full replace. */
  updateUser: async (id: string, input: ScimUserInput): Promise<ScimUser> =>
    (await typedApi.PUT("/api/v1/scim/v2/Users/{id}", { ...byId(id), body: input }).then(unwrap)).data,

  /** PATCH /Users/:id — partial update via SCIM operations. */
  patchUser: async (
    id: string,
    operations: ScimPatchOperation[],
  ): Promise<ScimUser> =>
    (
      await typedApi
        .PATCH("/api/v1/scim/v2/Users/{id}", { ...byId(id), body: { Operations: operations } })
        .then(unwrap)
    ).data,

  /** DELETE /Users/:id — returns 204. */
  deleteUser: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/scim/v2/Users/{id}", byId(id));
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
    const response = await typedApi
      .GET("/api/v1/scim/v2/Groups", { params: { query: listQuery(params) } })
      .then(unwrap);
    return response.data ?? emptyList<ScimGroup>();
  },

  /** GET /Groups/:id */
  getGroupById: async (id: string): Promise<ScimGroup> =>
    (await typedApi.GET("/api/v1/scim/v2/Groups/{id}", byId(id)).then(unwrap)).data,

  /** POST /Groups — returns 201. */
  createGroup: async (input: ScimGroupInput): Promise<ScimGroup> =>
    (await typedApi.POST("/api/v1/scim/v2/Groups", { body: input }).then(unwrap)).data,

  /** PUT /Groups/:id — full replace. */
  updateGroup: async (
    id: string,
    input: ScimGroupInput,
  ): Promise<ScimGroup> =>
    (await typedApi.PUT("/api/v1/scim/v2/Groups/{id}", { ...byId(id), body: input }).then(unwrap)).data,

  /** PATCH /Groups/:id — partial update via SCIM operations. */
  patchGroup: async (
    id: string,
    operations: ScimPatchOperation[],
  ): Promise<ScimGroup> =>
    (
      await typedApi
        .PATCH("/api/v1/scim/v2/Groups/{id}", { ...byId(id), body: { Operations: operations } })
        .then(unwrap)
    ).data,

  /** DELETE /Groups/:id — returns 204. */
  deleteGroup: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/scim/v2/Groups/{id}", byId(id));
  },
};

export default scimService;
