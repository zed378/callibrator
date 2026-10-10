import { typedApi, unwrap, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * P22-05 — the tenant's client facilities, short form (`GET /client-facilities/options`; P21-09).
 * Gated on `calibration`, `ipm` or `client-facilities` read. A list's facility filter is a
 * convenience for provider staff, never a boundary: a facility-bound reader's reads are already
 * scoped to its facility by the server, so a page does not offer it the filter.
 *
 * P22-09 (P19-04 § 4.4 – § 4.6, § 6; built by P21-09b/c) — the facility administration, on the
 * GENERATED client: the list (`q`, `status`, `kind`, `sort`; rows in `data`, paging in the
 * top-level `meta`), one facility, create, edit (only what changed), status (with a reason; leaving
 * `active` signs the facility's users out; `ended → active` is a tenant administrator's), delete
 * (tenant administrator), the facility's users; and the binding of a user
 * (`PUT /users/:userId/client-facility`: bind / re-bind / unbind with the role, a reason, every
 * session revoked; refused 409 while `FACILITY_BINDING_ENABLED` is off). Facility accounts are
 * refused every route here (403 `FACILITY_ROUTE_REFUSED`); the page does not offer them.
 */
type S = components["schemas"];
type ById = "/api/v1/client-facilities/{clientFacilityId}";

export type ClientFacilityOption = S["ClientFacilityOption"];
export type ClientFacility = S["ClientFacility"];
export type ClientFacilityUser = S["ClientFacilityUser"];
export type FacilityListQuery = QueryOf<Op<"/api/v1/client-facilities", "get">>;
export type FacilityCreateBody = JsonBody<Op<"/api/v1/client-facilities", "post">>;
export type FacilityEditBody = JsonBody<Op<ById, "patch">>;
export type FacilityStatusBody = JsonBody<Op<"/api/v1/client-facilities/{clientFacilityId}/status", "post">>;
export type BindingBody = JsonBody<Op<"/api/v1/users/{userId}/client-facility", "put">>;
export type TenantUser = S["User"];
export type RoleRow = S["RoleRow"];
export type PageMeta = S["PaginationMeta"];

const byId = (clientFacilityId: string) => ({ params: { path: { clientFacilityId } } });

export const clientFacilityService = {
  /** Every facility of the tenant (`data` is the array; no paging). */
  options: async (): Promise<ClientFacilityOption[]> =>
    (await typedApi.GET("/api/v1/client-facilities/options").then(unwrap)).data ?? [],

  list: async (query: FacilityListQuery): Promise<{ rows: ClientFacility[]; meta: PageMeta }> => {
    const answer = await typedApi.GET("/api/v1/client-facilities", { params: { query } }).then(unwrap);
    const rows = answer.data ?? [];
    return { rows, meta: answer.meta ?? { total: rows.length, page: query.page ?? 1, limit: rows.length, totalPages: 1 } };
  },

  create: async (body: FacilityCreateBody): Promise<ClientFacility> => (await typedApi.POST("/api/v1/client-facilities", { body }).then(unwrap)).data,

  edit: async (clientFacilityId: string, body: FacilityEditBody): Promise<ClientFacility> =>
    (await typedApi.PATCH("/api/v1/client-facilities/{clientFacilityId}", { ...byId(clientFacilityId), body }).then(unwrap)).data,

  /** The facility after the change, and how many of its users' sessions were revoked. */
  setStatus: async (clientFacilityId: string, body: FacilityStatusBody): Promise<{ facility: ClientFacility; sessionsRevoked: number }> =>
    (await typedApi.POST("/api/v1/client-facilities/{clientFacilityId}/status", { ...byId(clientFacilityId), body }).then(unwrap)).data,

  remove: async (clientFacilityId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/client-facilities/{clientFacilityId}", byId(clientFacilityId)).then(unwrap);
  },

  users: async (clientFacilityId: string): Promise<ClientFacilityUser[]> =>
    (await typedApi.GET("/api/v1/client-facilities/{clientFacilityId}/users", byId(clientFacilityId)).then(unwrap)).data ?? [],

  /** The tenant's users whose name, username or e-mail contains `find` (the first 20). */
  findUsers: async (find: string): Promise<TenantUser[]> =>
    (await typedApi.GET("/api/v1/users/all", { params: { query: { page: 1, limit: 20, find } } }).then(unwrap)).data ?? [],

  /** The roles a user may be given (the unbind names the role across every facility). */
  roles: async (): Promise<RoleRow[]> =>
    (await typedApi.GET("/api/v1/roles", { params: { query: { page: "1", limit: "100" } } }).then(unwrap)).data ?? [],

  bind: async (userId: string, body: BindingBody) =>
    (await typedApi.PUT("/api/v1/users/{userId}/client-facility", { params: { path: { userId } }, body }).then(unwrap)).data,
};
