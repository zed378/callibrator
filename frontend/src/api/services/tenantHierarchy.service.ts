import { typedApi, unwrap, type DataOf, type JsonBody, type Op } from "../typed";

/**
 * Tenant hierarchy (parent tenant -> child business units).
 *
 * Backend: src/routes/api/tenantHierarchy.route.ts (mounted /api/v1/tenant-hierarchy)
 *   GET    /tree                     (scoped to the caller's tenant)
 *   GET    /:tenantId/parent
 *   GET    /:tenantId/children
 *   GET    /:tenantId/descendants
 *   GET    /:tenantId/ancestors
 *   GET    /cross-tenant-roles       ?userId
 *   POST   /:tenantId/children   (the parent)
 *   PUT    /:tenantId/parent
 *   DELETE /:tenantId/parent
 *
 * The read endpoints wrap their payload under a NAMED key
 * (data.parent / data.children / data.descendants / data.ancestors /
 * data.assignments). None of them paginate and none return data.rows or meta.
 *
 * Cross-tenant roles are READ-ONLY over HTTP — there is no create or revoke
 * route.
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/tenantHierarchy.openapi.ts). The
 * exported names are unchanged. The hand-written `TenantNode` (id, type,
 * parentId, level, …) and cross-tenant assignment (roleName, source/target
 * tenant, …) described no answer and are gone.
 */

// ---------- Types ----------

type H = "/api/v1/tenant-hierarchy";
type ById = `${H}/{tenantId}`;

/**
 * A tenant in the hierarchy as the parent / children / ancestors reads and the
 * tree's children answer it: a flat summary.
 */
export type TenantNode = NonNullable<DataOf<Op<`${ById}/parent`, "get">>["parent"]>;

/** A direct child as returned inside the tree. */
export type TenantTreeChild = TenantNode;

type TreeAnswer = DataOf<Op<`${H}/tree`, "get">>;
type PlacedTree = Extract<TreeAnswer, { depth: number }>;

/**
 * GET /tree — the caller's own position in the hierarchy plus its direct
 * children. There is no `root` wrapper and no `totalNodes`. When the tenant
 * has no hierarchy row at all, the backend returns only
 * `{ isRoot: true, children: [] }` — so every other field is optional here.
 */
export type TenantTree = Pick<PlacedTree, "isRoot" | "children"> & Partial<Omit<PlacedTree, "isRoot" | "children">>;

export interface TenantChildrenResult {
  children: TenantNode[];
  /** Derived client-side — the endpoint does not paginate. */
  total: number;
}

export interface TenantDescendantsResult {
  /** The descendants' tenant ids. */
  descendants: DataOf<Op<`${ById}/descendants`, "get">>["descendants"];
  /** Derived client-side. */
  total: number;
}

export interface TenantAncestorsResult {
  ancestors: TenantNode[];
  /** Derived client-side. */
  total: number;
}

/** One of a user's roles in another tenant: `{ tenantId, tenantName, tenantCode, role }`. */
export type CrossTenantRoleAssignment = DataOf<Op<`${H}/cross-tenant-roles`, "get">>["assignments"][number];

type AddChildBody = JsonBody<Op<`${ById}/children`, "post">>;
/** The child's body; `plan` is the page's select value (it offers only the contract's plans). */
export type AddChildInput = Omit<AddChildBody, "plan"> & { plan?: string };

const tenant = (tenantId: string) => ({ params: { path: { tenantId } } });

// ---------- Service ----------

export const tenantHierarchyService = {
  /**
   * GET /tree — the backend scopes this to the caller's own tenant and
   * ignores any tenantId/maxDepth params, so none are sent.
   */
  getTree: async (): Promise<TenantTree> =>
    // The two answers read as one shape (the empty one has only isRoot / children).
    (await typedApi.GET("/api/v1/tenant-hierarchy/tree").then(unwrap)).data as TenantTree,

  /** GET /:tenantId/parent — payload is data.parent (null for a root). */
  getParent: async (tenantId: string): Promise<TenantNode | null> => {
    const response = await typedApi.GET("/api/v1/tenant-hierarchy/{tenantId}/parent", tenant(tenantId)).then(unwrap);
    // Defensive, as built: a body without `data` reads as no parent.
    return response.data?.parent ?? null;
  },

  /** GET /:tenantId/children — payload is data.children; not paginated. */
  getChildren: async (tenantId: string): Promise<TenantChildrenResult> => {
    const response = await typedApi.GET("/api/v1/tenant-hierarchy/{tenantId}/children", tenant(tenantId)).then(unwrap);
    const children = response.data?.children ?? [];
    return { children, total: children.length };
  },

  /** GET /:tenantId/descendants — payload is data.descendants (tenant ids). */
  getDescendants: async (
    tenantId: string,
  ): Promise<TenantDescendantsResult> => {
    const response = await typedApi
      .GET("/api/v1/tenant-hierarchy/{tenantId}/descendants", tenant(tenantId))
      .then(unwrap);
    const descendants = response.data?.descendants ?? [];
    return { descendants, total: descendants.length };
  },

  /** GET /:tenantId/ancestors — payload is data.ancestors. */
  getAncestors: async (tenantId: string): Promise<TenantAncestorsResult> => {
    const response = await typedApi.GET("/api/v1/tenant-hierarchy/{tenantId}/ancestors", tenant(tenantId)).then(unwrap);
    const ancestors = response.data?.ancestors ?? [];
    return { ancestors, total: ancestors.length };
  },

  /**
   * GET /cross-tenant-roles — payload is data.assignments; not paginated.
   * The backend returns an empty list unless `userId` is supplied.
   *
   * Read-only: there is no route to assign or revoke a cross-tenant role.
   */
  getCrossTenantRoles: async (
    userId?: string,
  ): Promise<CrossTenantRoleAssignment[]> => {
    const response = await typedApi
      .GET("/api/v1/tenant-hierarchy/cross-tenant-roles", { params: { query: userId ? { userId } : {} } })
      .then(unwrap);
    return response.data?.assignments ?? [];
  },

  /**
   * Create a child (sub-organization) tenant under a parent.
   * POST /api/v1/tenant-hierarchy/:tenantId/children (the parent)
   */
  addChild: async (
    parentId: string,
    data: AddChildInput,
  ): Promise<DataOf<Op<`${ById}/children`, "post">>> =>
    (
      await typedApi
        // The plan comes from the page's select of the contract's plans.
        .POST("/api/v1/tenant-hierarchy/{tenantId}/children", { ...tenant(parentId), body: data as AddChildBody })
        .then(unwrap)
    ).data,

  /**
   * Re-parent a tenant. PUT /api/v1/tenant-hierarchy/:tenantId/parent
   */
  updateParent: async (
    tenantId: string,
    newParentId: string,
  ): Promise<DataOf<Op<`${ById}/parent`, "put">>> =>
    (
      await typedApi
        .PUT("/api/v1/tenant-hierarchy/{tenantId}/parent", { ...tenant(tenantId), body: { newParentId } })
        .then(unwrap)
    ).data,

  /**
   * Detach a tenant from its parent (make it a root).
   * DELETE /api/v1/tenant-hierarchy/:tenantId/parent
   */
  removeParent: async (
    tenantId: string,
  ): Promise<DataOf<Op<`${ById}/parent`, "delete">>> =>
    (await typedApi.DELETE("/api/v1/tenant-hierarchy/{tenantId}/parent", tenant(tenantId)).then(unwrap)).data,
};

export default tenantHierarchyService;
