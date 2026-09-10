import { api } from "../client";

/**
 * Tenant hierarchy (parent tenant -> child business units).
 *
 * Backend: src/routes/api/tenantHierarchy.route.js (mounted /api/v1/tenant-hierarchy)
 *   GET    /tree                     (scoped to the caller's tenant)
 *   GET    /:tenantId/parent
 *   GET    /:tenantId/children
 *   GET    /:tenantId/descendants
 *   GET    /:tenantId/ancestors
 *   GET    /cross-tenant-roles       ?userId
 *   POST   /:parentId/children
 *   PUT    /:tenantId/parent
 *   DELETE /:tenantId/parent
 *
 * The read endpoints wrap their payload under a NAMED key
 * (data.parent / data.children / data.descendants / data.ancestors /
 * data.assignments). None of them paginate and none return data.rows or meta.
 *
 * Cross-tenant roles are READ-ONLY over HTTP — there is no create or revoke
 * route.
 */

// ---------- Types ----------

export type HierarchyNodeType = "tenant" | "sub-tenant" | "affiliated";

export interface TenantNode {
  id: string;
  name: string;
  code: string;
  type: HierarchyNodeType;
  parentId?: string;
  level: number;
  children?: TenantNode[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** A direct child as returned inside the tree (a flat summary, not a TenantNode). */
export interface TenantTreeChild {
  tenantId: string;
  code: string;
  name: string;
  status: string;
  depth: number;
}

/**
 * GET /tree — the caller's own position in the hierarchy plus its direct
 * children. Verified against the live endpoint: there is no `root` wrapper and
 * no `totalNodes`. When the tenant has no hierarchy row at all, the backend
 * returns only `{ isRoot: true, children: [] }`.
 */
export interface TenantTree {
  isRoot: boolean;
  depth?: number;
  path?: string;
  tenant?: {
    id: string;
    name: string;
    code: string;
    status: string;
    plan?: string;
  };
  children: TenantTreeChild[];
}

export interface TenantChildrenResult {
  children: TenantNode[];
  /** Derived client-side — the endpoint does not paginate. */
  total: number;
}

export interface TenantDescendantsResult {
  descendants: TenantNode[];
  /** Derived client-side. */
  total: number;
}

export interface TenantAncestorsResult {
  ancestors: TenantNode[];
  /** Derived client-side. */
  total: number;
}

export interface CrossTenantRoleAssignment {
  id: string;
  roleId: string;
  roleName: string;
  sourceTenantId: string;
  targetTenantId: string;
  userId: string;
  assignedBy: string;
  assignedAt: string;
  expiresAt?: string;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const tenantHierarchyService = {
  /**
   * GET /tree — the backend scopes this to the caller's own tenant and
   * ignores any tenantId/maxDepth params, so none are sent.
   */
  getTree: async (): Promise<TenantTree> => {
    const response = await api.get<BackendResponse<TenantTree>>(
      "/api/v1/tenant-hierarchy/tree",
    );
    return response.data;
  },

  /** GET /:tenantId/parent — payload is data.parent (null for a root). */
  getParent: async (tenantId: string): Promise<TenantNode | null> => {
    const response = await api.get<
      BackendResponse<{ parent: TenantNode | null }>
    >(`/api/v1/tenant-hierarchy/${tenantId}/parent`);
    return response.data?.parent ?? null;
  },

  /** GET /:tenantId/children — payload is data.children; not paginated. */
  getChildren: async (tenantId: string): Promise<TenantChildrenResult> => {
    const response = await api.get<BackendResponse<{ children: TenantNode[] }>>(
      `/api/v1/tenant-hierarchy/${tenantId}/children`,
    );
    const children = response.data?.children ?? [];
    return { children, total: children.length };
  },

  /** GET /:tenantId/descendants — payload is data.descendants. */
  getDescendants: async (
    tenantId: string,
  ): Promise<TenantDescendantsResult> => {
    const response = await api.get<
      BackendResponse<{ descendants: TenantNode[] }>
    >(`/api/v1/tenant-hierarchy/${tenantId}/descendants`);
    const descendants = response.data?.descendants ?? [];
    return { descendants, total: descendants.length };
  },

  /** GET /:tenantId/ancestors — payload is data.ancestors. */
  getAncestors: async (tenantId: string): Promise<TenantAncestorsResult> => {
    const response = await api.get<BackendResponse<{ ancestors: TenantNode[] }>>(
      `/api/v1/tenant-hierarchy/${tenantId}/ancestors`,
    );
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
    const response = await api.get<
      BackendResponse<{ assignments: CrossTenantRoleAssignment[] }>
    >("/api/v1/tenant-hierarchy/cross-tenant-roles", {
      params: userId ? { userId } : {},
    });
    return response.data?.assignments ?? [];
  },

  /**
   * Create a child (sub-organization) tenant under a parent.
   * POST /api/v1/tenant-hierarchy/:parentId/children
   */
  addChild: async (
    parentId: string,
    data: {
      name: string;
      code?: string;
      plan?: string;
      settings?: Record<string, unknown>;
    },
  ): Promise<{ tenantId: string; code: string; path: string; depth: number }> => {
    const response = await api.post<
      BackendResponse<{
        tenantId: string;
        code: string;
        path: string;
        depth: number;
      }>
    >(`/api/v1/tenant-hierarchy/${parentId}/children`, data);
    return response.data;
  },

  /**
   * Re-parent a tenant. PUT /api/v1/tenant-hierarchy/:tenantId/parent
   */
  updateParent: async (
    tenantId: string,
    newParentId: string,
  ): Promise<{ tenantId: string; newParentId: string }> => {
    const response = await api.put<
      BackendResponse<{ tenantId: string; newParentId: string }>
    >(`/api/v1/tenant-hierarchy/${tenantId}/parent`, { newParentId });
    return response.data;
  },

  /**
   * Detach a tenant from its parent (make it a root).
   * DELETE /api/v1/tenant-hierarchy/:tenantId/parent
   */
  removeParent: async (
    tenantId: string,
  ): Promise<{ tenantId: string; status: string }> => {
    const response = await api.delete<
      BackendResponse<{ tenantId: string; status: string }>
    >(`/api/v1/tenant-hierarchy/${tenantId}/parent`);
    return response.data;
  },
};

export default tenantHierarchyService;
