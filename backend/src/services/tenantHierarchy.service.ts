/**
 * Tenant Hierarchy Service
 *
 * Manages parent-tenant → child business unit relationships. It grants no
 * data visibility across tenants (ADR-084, Q-05).
 *
 * There is no role cascade (A-134). Roles are global, not tenant-scoped
 * (role.model: no tenantId, `name` unique across the platform), so every
 * role and its menu permissions already apply in a child tenant; there is
 * nothing to copy. The former `cascadeRoles` (HIERARCHY_CASCADE_ROLES) could
 * never run — an alias-less `include: [Role]`, a `level` attribute and a
 * `tenantId` on Role that do not exist — and its throw was logged as
 * "non-fatal". It was removed rather than fixed, and HIERARCHY_CASCADE_ROLES
 * is no longer read.
 *
 * Usage:
 *   const { createSubOrganization, getTenantTree } = require('./services/tenantHierarchy.service');
 *   await createSubOrganization(parentTenantId, { name: 'Branch A' });
 *
 * P9-13 (ADR-087, Stage C; converted under the four isolation gates): from
 * tenantHierarchy.service.js with no behaviour change. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order; the
 * formerly anonymous `exports.x = async () => …` functions are now named after
 * their key, the one accepted surface change). The functions never called each
 * other through `exports`, so they still call each other directly. `logger`,
 * `AppError`, `db` and `PLATFORM_TENANT_ID` are captured once at load, as the
 * `.js` destructured them; `auditService` is the module object. Every
 * `require("../models")` stays lazy, inside the function that uses it, and
 * `db.Sequelize.Op` / `.Transaction` are still read at call time.
 * HIERARCHY_ENABLED and HIERARCHY_MAX_DEPTH are still read once, at load.
 */

import type { Op as OpNamespace, Transaction as TransactionClass } from "sequelize";

import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { createSelfFacility } from "./clientFacility.service";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { env } from "../config/env";
import type { TenantId } from "../types/ids";
import type { ModelInstance, ModelsBarrel } from "../types/models";

const logger = loadedLogger;
const AppError = LoadedAppError;
const db = loadedDb;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;

type TenantRow = ModelInstance<"Tenant">;
type HierarchyRow = ModelInstance<"TenantHierarchy">;

/** `db.Sequelize` as the `.js` read it: the constructor carries `Op` and `Transaction` at run time; Sequelize's typings omit both statics. */
type SequelizeWithStatics = typeof db.Sequelize & {
  Op: typeof OpNamespace;
  Transaction: typeof TransactionClass;
};

/** The barrel, required when the calling function runs (never at this module's load), as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: each function loads the barrel when it runs (see the file header)
const loadModels = (): ModelsBarrel => require("../models") as ModelsBarrel;

/** A thrown value, read the way the `.js` read it (`err.name`, `err.message`). */
interface Thrown {
  name?: unknown;
  message?: unknown;
}

/** Who acted: auditActor(req) (P9-20: typed as it returns them; type-only). */
interface HierarchyActor {
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/** The validated body of a sub-organization create. */
interface SubOrganizationInput {
  name: string;
  code?: string | null | undefined;
}

interface SubOrganizationResult {
  tenantId: string;
  code: string;
  path: string;
  depth: number;
}

interface TreeChild {
  tenantId: string;
  code: string | null | undefined;
  name: string;
  status: unknown;
  depth: number;
}

type TenantTree =
  | { isRoot: true; children: [] }
  | {
      isRoot: boolean;
      depth: number;
      path: string;
      tenant: TenantRow | undefined;
      children: TreeChild[];
    };

interface UserTenantRole {
  tenantId: unknown;
  tenantName: string | null;
  tenantCode: string | null;
  role: { id: unknown; name: unknown; level: unknown } | null;
}

interface MoveResult {
  tenantId: TenantId;
  parentId: TenantId | null;
  path: string;
  depth: number;
  descendantsMoved: number;
}

// ==========================================
// CONFIGURATION
// ==========================================

const HIERARCHY_ENABLED = env("HIERARCHY_ENABLED") === "true";
// parseInt applies ToString to its argument, so String(undefined) → NaN, as parseInt(undefined) was.
// As built: NaN and 0 fall back to 5 (`||`, never `??`).
const MAX_DEPTH = parseInt(String(env("HIERARCHY_MAX_DEPTH"))) || 5;

// ==========================================
// SUB-ORGANIZATION MANAGEMENT
// ==========================================

/**
 * A tenant subdomain derived from a code, the way tenant.service#createTenant
 * derives one: lower-cased, every character the model's pattern refuses
 * (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`) turned into `-`, trimmed, at most 63.
 *
 * @param {string} code
 * @returns {string}
 */
const subdomainFromCode = (code: unknown): string =>
  String(code)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");

/**
 * Create a sub-organization (child tenant) under a parent.
 *
 * A-187 — this never worked on the real models. `tenants.subdomain` and
 * `tenants.email` are NOT NULL and it set neither, so every call failed
 * validation and the catch reported a 500. The depth check ran AFTER both
 * rows were inserted and undid them with two more autocommits; and nothing
 * was audited.
 *
 * Now:
 *  - the child's `subdomain` is derived from its code (as createTenant does)
 *    and its `email` is the parent's — the parent organisation administers
 *    the sub-organisation until someone gives it its own contact address;
 *  - the depth limit and the parent's state are checked BEFORE any write;
 *  - the tenant, its hierarchy row and ONE audit row commit together, the row
 *    under the PLATFORM tenant (a tenant's creation is a platform operation —
 *    the route is SUPERADMIN-only, as createTenant, A-95/A-125);
 *  - a code or subdomain already in use is 409, not 500.
 *
 * @param {string} parentTenantId - Parent tenant ID
 * @param {{name: string, code?: string}} data - Sub-org data (validated)
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<{tenantId: string, code: string, path: string, depth: number}>}
 * @throws {AppError} 400 when disabled; 404 when the parent does not exist;
 *   409 when the parent is not active, has no code, the depth limit is
 *   reached, or the code/subdomain is taken
 */
const createSubOrganization = async (
  parentTenantId: TenantId,
  data: SubOrganizationInput,
  actor: HierarchyActor = {},
): Promise<SubOrganizationResult> => {
  if (!HIERARCHY_ENABLED) {
    throw new AppError(400, "Tenant hierarchy is disabled");
  }

  const { Tenant, TenantHierarchy } = loadModels();

  const parent = await Tenant.findByPk(parentTenantId);
  if (!parent) {
    throw new AppError(404, "Parent tenant not found");
  }

  // State conflicts, explained (409) — not malformed requests.
  if (parent.status !== "active") {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the status is interpolated as it is
    throw new AppError(409, `Parent tenant is ${parent.status}; a sub-organization can be created only under an active tenant`);
  }
  if (!parent.code) {
    throw new AppError(409, "Parent tenant has no code; set one before creating a sub-organization (the child's code is derived from it)");
  }
  const parentHierarchy = await TenantHierarchy.findOne({
    where: { tenantCode: parent.code },
  });
  const parentPath = parentHierarchy ? parentHierarchy.path : `/${parent.code.toLowerCase()}`;
  const depth = (parentHierarchy ? parentHierarchy.depth : 0) + 1;
  if (depth > MAX_DEPTH) {
    throw new AppError(409, `Maximum hierarchy depth (${String(MAX_DEPTH)}) reached: "${parent.name}" cannot have sub-organizations`);
  }

  let childCode = data.code;
  if (!childCode) {
    const childCount = await TenantHierarchy.count({
      where: { parentCode: parent.code },
    });
    childCode = `${parent.code}_${String(childCount + 1).padStart(3, "0")}`;
  }
  const subdomain = subdomainFromCode(childCode);
  const path = `${parentPath}/${childCode.toLowerCase()}`;

  try {
    const tenant = await db.transaction(async (transaction) => {
      const created = await Tenant.create(
        {
          name: data.name,
          code: childCode,
          subdomain,
          email: parent.email,
          status: "active",
          parentId: parentTenantId,
          plan: parent.plan,
        },
        { transaction },
      );

      await TenantHierarchy.create(
        {
          tenantId: created.id,
          tenantCode: childCode,
          parentCode: parent.code,
          path,
          depth,
        },
        { transaction },
      );

      // P20-07 (ADR-124 Am. 2 § 4): the child tenant's own client facility, audited in the child.
      const selfFacility = await createSelfFacility(created, { userId: actor.userId }, { transaction });

      await auditService.logAction(
        {
          tenantId: PLATFORM_TENANT_ID,
          userId: actor.userId,
          action: "CREATE",
          resourceType: "Tenant",
          resourceId: created.id,
          changes: {
            operation: "CREATE_SUB_ORGANIZATION",
            before: {},
            after: { name: data.name, code: childCode, subdomain, parentId: parentTenantId, path, depth },
            selfFacilityId: selfFacility.id,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        { transaction },
      );
      return created;
    });

    logger.info("Sub-organization created", {
      parentTenantId,
      childTenantId: tenant.id,
      childCode,
      path,
    });

    return { tenantId: tenant.id, code: childCode, path, depth };
  } catch (err) {
    // As built: a thrown null/undefined passes the first test and then throws
    // a TypeError reading `.message`, exactly as `err.message` did.
    const failure = err as Thrown;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: `err && err.name === …` tolerates a thrown non-object
    if (failure && failure.name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, `A tenant with code "${childCode}" or subdomain "${subdomain}" already exists`);
    }
    logger.error("Failed to create sub-organization", {
      parentTenantId,
      error: failure.message,
    });
    throw new AppError(500, "Failed to create sub-organization");
  }
};

// ==========================================
// HIERARCHY QUERIES
// ==========================================

/** A tenant that heads a tree without a tenant_hierarchies row of its own (A-329). */
interface ImplicitRoot {
  code: string;
  path: string;
  tenant: TenantRow;
}

/**
 * A-329: the implicit root for a tenant with no hierarchy row — the tenant
 * itself at `/<code lower-cased>`, depth 0, exactly where createSubOrganization
 * and moveTenant place a row-less parent's children. Null when the tenant does
 * not exist (or is soft-deleted, by the Tenant defaultScope) or has no code.
 */
const implicitRoot = async (tenantId: TenantId): Promise<ImplicitRoot | null> => {
  const { Tenant } = loadModels();
  const tenant = await Tenant.findByPk(tenantId, { attributes: ["id", "name", "code", "status", "plan"] });
  if (!tenant?.code) {
    return null;
  }
  return { code: tenant.code, path: `/${tenant.code.toLowerCase()}`, tenant };
};

/**
 * Get the full hierarchy tree for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Hierarchy tree
 */
const getTenantTree = async (tenantId: TenantId): Promise<TenantTree> => {
  const { Tenant, TenantHierarchy } = loadModels();

  try {
    // The Tenant includes in this function and in getAncestorTenants are INNER on
    // purpose (A-90): Tenant's defaultScope makes them required, and a
    // soft-deleted tenant is meant to drop out of the tree — the children
    // mapping below reads `c.tenant.id` unguarded.
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
      include: [
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code", "status", "plan"],
          required: true, // D-12: stated, not inherited from the defaultScope
        },
      ],
    });

    // A-329: a root tenant has no row of its own — createSubOrganization writes
    // one for the CHILD only, and places it under `/<root code>` with
    // parentCode = the root's code. So a root with no row still has children;
    // they are found by its code, as createSubOrganization placed them.
    const root = hierarchy ? null : await implicitRoot(tenantId);
    if (!hierarchy && !root) {
      return { isRoot: true, children: [] };
    }
    const ownCode = hierarchy ? hierarchy.tenantCode : (root as ImplicitRoot).code;

    const children = await TenantHierarchy.findAll({
      where: { parentCode: ownCode },
      include: [
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code", "status", "plan"],
          required: true, // D-12: stated, not inherited from the defaultScope
        },
      ],
    });

    return {
      isRoot: hierarchy ? hierarchy.depth === 0 : true,
      depth: hierarchy ? hierarchy.depth : 0,
      path: hierarchy ? hierarchy.path : (root as ImplicitRoot).path,
      tenant: hierarchy ? hierarchy.tenant : (root as ImplicitRoot).tenant,
      children: children.map((c: HierarchyRow) => {
        // The include is INNER, so every child row carries its tenant; a row
        // without one throws here and the catch answers the root, as built.
        const childTenant = c.tenant as TenantRow;
        return {
          tenantId: childTenant.id,
          code: childTenant.code,
          name: childTenant.name,
          status: childTenant.status,
          depth: c.depth,
        };
      }),
    };
  } catch (err) {
    logger.error("Failed to get tenant tree", {
      tenantId,
      error: (err as Thrown).message,
    });
    return { isRoot: true, children: [] };
  }
};

/**
 * Get all descendant tenant IDs
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} List of descendant tenant IDs
 */
const getDescendantTenants = async (tenantId: TenantId): Promise<TenantId[]> => {
  const { TenantHierarchy } = loadModels();

  try {
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
    });

    // A-329: a root with no row of its own is `/<code>`, as createSubOrganization
    // placed its children.
    const root = hierarchy ? null : await implicitRoot(tenantId);
    if (!hierarchy && !root) {
      return [];
    }
    const ownPath = hierarchy ? hierarchy.path : (root as ImplicitRoot).path;

    const descendants = await TenantHierarchy.findAll({
      where: {
        path: {
          // A-329: escaped — a code's `_` (every generated child code has one)
          // was a LIKE wildcard, so `/acme/acme_001/%` also matched `/acme/acmez001/…`.
          [(db.Sequelize as SequelizeWithStatics).Op.like]: subtreePattern(ownPath),
        },
      },
      attributes: ["tenantId"],
    });

    return descendants.map((d: HierarchyRow) => d.tenantId);
  } catch (err) {
    logger.error("Failed to get descendants", {
      tenantId,
      error: (err as Thrown).message,
    });
    return [];
  }
};

/**
 * Get ancestor tenants (parent, grandparent, etc.)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} List of ancestor tenant objects
 */
const getAncestorTenants = async (tenantId: TenantId): Promise<TreeChild[]> => {
  const { TenantHierarchy, Tenant } = loadModels();

  try {
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
    });

    if (!hierarchy) {
      return [];
    }

    const pathParts = hierarchy.path.split("/").filter((p) => p);
    const ancestors: TreeChild[] = [];

    for (let i = 0; i < pathParts.length - 1; i++) {
      const partialPath = "/" + pathParts.slice(0, i + 1).join("/");
      const ancestor = await TenantHierarchy.findOne({
        where: { path: partialPath },
        // INNER on purpose (A-90): a soft-deleted ancestor is skipped.
        include: [
          {
            model: Tenant,
            as: "tenant",
            attributes: ["id", "name", "code", "status"],
            required: true, // D-12: stated, not inherited from the defaultScope
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `ancestor && ancestor.tenant`
      if (ancestor && ancestor.tenant) {
        ancestors.push({
          tenantId: ancestor.tenant.id,
          code: ancestor.tenant.code,
          name: ancestor.tenant.name,
          status: ancestor.tenant.status,
          depth: ancestor.depth,
        });
      }
    }

    return ancestors;
  } catch (err) {
    logger.error("Failed to get ancestors", {
      tenantId,
      error: (err as Thrown).message,
    });
    return [];
  }
};

// ==========================================
// DATA VISIBILITY — there is none (ADR-084, Q-05)
// ==========================================
//
// The hierarchy is structure, not access. A parent tenant never sees a child
// tenant's data, a child never sees its parent's or a sibling's, and no role
// in one tenant reaches another's rows because the tenants are linked here.
// The global tenant hooks know exactly one tenant per principal and nothing in
// this file widens that.
//
// getDataVisibilityScope / buildTenantFilter / HIERARCHY_SCOPE were removed
// under ADR-084. Nothing called them, and they encoded the opposite decision:
// a "subtree" scope (the parent reads every descendant) and an "all" scope
// (any member reads the whole family, parent and siblings included), the
// latter found by `code LIKE '<root>_%'`, which also matched an unrelated
// tenant whose code merely starts with the root's. A future group report is
// aggregates only, consented by each child, and needs its own ADR.

// ==========================================
// PERMISSIONS & ROLES
// ==========================================

// A-255 (ADR-065): assignRoleToUserAcrossHierarchy was removed with its
// unrouted handler. It wrote users.role_id with no audit row and no privilege
// check (ROLE_LEVELS), and passed the USER id where the (since removed,
// ADR-084) getDataVisibilityScope expected a TENANT id, so it matched no hierarchy and updated nothing.

/**
 * Get user's roles across all tenants
 * @param {string} userId - User ID
 * @returns {Promise<Array>} User's roles per tenant
 */
const getUserRolesAcrossTenants = async (userId: string): Promise<UserTenantRole[]> => {
  const { User, Role, Tenant } = loadModels();

  try {
    // A-110: the associations are `role` and `tenant` (user.model). The
    // former "Role"/"Tenant" aliases made every call throw an eager-loading
    // error, which the catch below turned into [] — the endpoint answered
    // "no roles" for every user and nothing ever reported why.
    //
    // LEFT JOINs (A-90): Role and Tenant have a defaultScope `where`, so an
    // include without `required: false` is INNER and drops the user whose role
    // or tenant was soft-deleted. The mapping reads a missing one as null.
    //
    // The Role attribute is `roleLevel` (column role_level): "level" is not a
    // column, and asking for it would fail in PostgreSQL the moment the alias
    // fix let the query run. The answer keeps its `level` key.
    //
    // Only the columns the answer needs: the default selected every user
    // column, password hash and MFA secret included.
    const users = await User.findAll({
      where: { id: userId },
      attributes: ["id", "tenantId"],
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["id", "name", "roleLevel"],
          required: false,
        },
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code"],
          required: false,
        },
      ],
    });

    return users.map((u) => ({
      tenantId: u.tenantId,
      tenantName: u.tenant?.name ?? null,
      tenantCode: u.tenant?.code ?? null,
      role: u.role
        ? { id: u.role.id, name: u.role.name, level: u.role.roleLevel }
        : null,
    }));
  } catch (err) {
    // A failure is a failure, not an empty result: log it and answer 500, as
    // this file's other role operations did (the removed assignRoleToUserAcrossHierarchy).
    logger.error("Failed to get user roles", {
      userId,
      error: (err as Thrown).message,
    });
    throw new AppError(500, "Failed to get user roles");
  }
};

// ==========================================
// MOVING A TENANT IN THE TREE (A-224)
// ==========================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A LIKE pattern matching every path strictly below `path` (codes may hold `_`, a LIKE wildcard). */
const subtreePattern = (path: string): string => `${path.replace(/[\\%_]/g, "\\$&")}/%`;

/**
 * Move a tenant under a new parent (`newParentId`), or make it a root (null).
 *
 * A-224 — the two controller handlers this replaces wrote the tenant and its
 * hierarchy row in two autocommits with no audit row; accepted a new parent
 * inside the tenant's own subtree (a cycle: the subtree detached from every
 * root and disappeared from the tree); left every descendant's materialised
 * path pointing at the old position; and answered "already a root" with a 404.
 * Now, in one transaction:
 *  - the tenant row is locked; a missing tenant or parent is 404;
 *  - a state conflict is 409, explained: itself as parent, a parent inside its
 *    own subtree (checked on the parentId chain, which does not depend on the
 *    hierarchy rows being complete), already under that parent, already a
 *    root, no code, or a move that would push the subtree past MAX_DEPTH;
 *  - the tenant's hierarchy row (created if missing) and EVERY descendant's
 *    path and depth are rewritten;
 *  - ONE audit row, under the PLATFORM tenant (a tenant's place in the tree is
 *    a platform operation, as createSubOrganization records it).
 *
 * @param {string} tenantId
 * @param {string|null} newParentId - null makes the tenant a root
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<{tenantId: string, parentId: (string|null), path: string, depth: number, descendantsMoved: number}>}
 * @throws {AppError} 400 malformed parent id; 404 tenant/parent not found; 409 as above
 */
// P9-20: `undefined` in the type as in fact (a body without newParentId); it is the 400 below.
const moveTenant = async (tenantId: TenantId, newParentId: TenantId | null | undefined, actor: HierarchyActor = {}): Promise<MoveResult> => {
  // As built: a JavaScript caller passes whatever the request body held, so the type is checked at run time.
  if (newParentId !== null && !(typeof newParentId === "string" && UUID.test(newParentId))) {
    throw new AppError(400, "newParentId must be a tenant id (UUID)");
  }
  const parentId = newParentId;
  const { Tenant, TenantHierarchy } = loadModels();
  const { Transaction, Op } = db.Sequelize as SequelizeWithStatics;
  const LOCK = Transaction.LOCK.UPDATE;

  return db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(tenantId, { transaction, lock: LOCK });
    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }
    if (!tenant.code) {
      throw new AppError(409, "This tenant has no code; set one before moving it in the hierarchy (its path is built from it)");
    }

    let newParent: TenantRow | null = null;
    if (parentId === null) {
      if (!tenant.parentId) {
        throw new AppError(409, "This tenant is already a root tenant: it has no parent to remove");
      }
    } else {
      if (parentId === tenantId) {
        throw new AppError(409, "A tenant cannot be its own parent");
      }
      if (tenant.parentId === parentId) {
        throw new AppError(409, "This tenant is already under that parent");
      }
      newParent = await Tenant.findByPk(parentId, { transaction });
      if (!newParent) {
        throw new AppError(404, "New parent tenant not found");
      }
      if (!newParent.code) {
        throw new AppError(409, "The new parent tenant has no code; set one before moving a tenant under it");
      }
      // The parentId chain upwards from the new parent must not reach the tenant.
      let cursor: TenantRow | null = newParent;
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `cursor && cursor.parentId`
      for (let hops = 0; cursor && cursor.parentId; hops += 1) {
        if (cursor.parentId === tenantId || hops > MAX_DEPTH * 4) {
          throw new AppError(
            409,
            `"${newParent.name}" is inside this tenant's own subtree: moving the tenant under it would make a cycle`,
          );
        }
        cursor = await Tenant.findByPk(cursor.parentId, { transaction });
      }
    }

    const own = await TenantHierarchy.findOne({ where: { tenantId }, transaction, lock: LOCK });
    const oldPath = own ? own.path : `/${tenant.code.toLowerCase()}`;
    const oldDepth = own ? own.depth : 0;

    let parentPath = "";
    let parentDepth = -1;
    if (newParent) {
      const parentRow = await TenantHierarchy.findOne({ where: { tenantId: newParent.id }, transaction });
      parentPath = parentRow ? parentRow.path : `/${(newParent.code as string).toLowerCase()}`;
      parentDepth = parentRow ? parentRow.depth : 0;
    }
    const newPath = `${parentPath}/${tenant.code.toLowerCase()}`;
    const newDepth = parentDepth + 1;

    const descendants = own
      ? await TenantHierarchy.findAll({
        where: { path: { [Op.like]: subtreePattern(oldPath) } },
        transaction,
        lock: LOCK,
      })
      : [];
    const deepest = descendants.reduce((max, d) => Math.max(max, d.depth - oldDepth), 0);
    if (newDepth + deepest > MAX_DEPTH) {
      throw new AppError(
        409,
        `Moving this tenant there would put its subtree ${String(newDepth + deepest)} levels deep; the maximum is ${String(MAX_DEPTH)}`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty parentId reads as null
    const before = { parentId: tenant.parentId || null, path: oldPath, depth: oldDepth };
    await tenant.update({ parentId }, { transaction });

    const placement = { parentCode: newParent ? newParent.code : null, path: newPath, depth: newDepth };
    if (own) {
      await own.update(placement, { transaction });
    } else {
      await TenantHierarchy.create({ tenantId, tenantCode: tenant.code, ...placement }, { transaction });
    }
    for (const d of descendants) {
      await d.update(
        { path: `${newPath}${d.path.slice(oldPath.length)}`, depth: d.depth - oldDepth + newDepth },
        { transaction },
      );
    }

    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: tenantId,
        changes: {
          operation: newParent ? "MOVE_TENANT" : "DETACH_TENANT",
          before,
          after: { parentId, path: newPath, depth: newDepth },
          descendantsMoved: descendants.length,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { transaction },
    );

    logger.info("Tenant moved in the hierarchy", { tenantId, newParentId: parentId, descendantsMoved: descendants.length });
    return { tenantId, parentId, path: newPath, depth: newDepth, descendantsMoved: descendants.length };
  });
};

/** A-224 — PUT /tenant-hierarchy/:tenantId/parent. */
const updateTenantParent = (tenantId: TenantId, newParentId: TenantId | null | undefined, actor?: HierarchyActor): Promise<MoveResult> =>
  moveTenant(tenantId, newParentId, actor);

/** A-224 — DELETE /tenant-hierarchy/:tenantId/parent: the tenant becomes a root. */
const removeTenantParent = (tenantId: TenantId, actor?: HierarchyActor): Promise<MoveResult> =>
  moveTenant(tenantId, null, actor);

// ==========================================
// UTILITIES
// ==========================================

/**
 * Get service status
 */
const getStatus = (): { enabled: boolean; maxDepth: number } => {
  return {
    enabled: HIERARCHY_ENABLED,
    maxDepth: MAX_DEPTH,
  };
};

const service = {
  createSubOrganization,
  getTenantTree,
  getDescendantTenants,
  getAncestorTenants,
  getUserRolesAcrossTenants,
  updateTenantParent,
  removeTenantParent,
  getStatus,
};

export = service;
