/**
 * D-17 — models with no tenant column, each a reviewed decision.
 *
 * The global tenant hooks scope a model if and only if it has a `tenantId` /
 * `tenant_id` attribute (utils/tenantScope.util.js). Nineteen models have
 * neither. For each, UNSCOPED below records WHY and what stands in for the
 * missing predicate. Three groups:
 *
 *  - "global": platform data by design — the tenant itself, the menu
 *    taxonomy, the CMS, and the RBAC tables (roles are global: D-16,
 *    tests/routes/rolesGlobal.d16.test.js holds every write SUPERADMIN-only).
 *  - "child": rows that belong to a tenant THROUGH a scoped parent (a kanban
 *    project, a workflow, a notification, a ticket, a user). The compensating
 *    control is the parent key: every read or write names the parent, which
 *    was itself loaded under the tenant scope. There is no ORM backstop — so
 *    the second half of this file is the backstop: a static check that every
 *    query on a child model carries its parent key in its `where`.
 *
 * Decision (ADR-064, D-17): the child tables do NOT gain a
 * denormalised `tenant_id` in this change. Alternatives and the bad
 * implications are in ADR-064; the short form is that eleven tables,
 * a backfill, and a create path that must stamp a tenant in background jobs
 * is a schema change to make deliberately, not as a side effect of an audit.
 *
 * A NEW model without a tenant column fails "every unscoped model is a
 * reviewed decision" until it is listed here with its reason.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const fs = require("fs");
const path = require("path");
const models = require("../../models");

const espree = require(
  require.resolve("espree", { paths: [path.dirname(require.resolve("eslint/package.json"))] }),
);

const allModels = [...new Set(Object.values(models.sequelize.models))];
const hasTenantColumn = (m) => Boolean(m.rawAttributes.tenantId || m.rawAttributes.tenant_id);

/** name → { group, parentKeys, why } */
const UNSCOPED = Object.freeze({
  Tenant: { group: "global", why: "it IS the tenant; reached by id only behind ownTenantGuard / superAdminOnly (A-01)" },
  MenuGroup: { group: "global", why: "platform navigation taxonomy; writes are SUPERADMIN-only (D-16)" },
  Role: { group: "global", why: "roles are global (D-16); every write route is SUPERADMIN-only" },
  RoleMenuPermission: { group: "global", why: "the permission matrix of a global role (D-16); SUPERADMIN-only" },
  Post: { group: "global", why: "platform CMS; slugs globally unique by design (Reference Table 2, rank 8)" },
  Category: { group: "global", why: "platform CMS taxonomy (rank 7)" },
  PostCategory: { group: "global", why: "join of two global CMS tables" },
  UserMenuPermission: {
    group: "child",
    parentKeys: ["userId"],
    why: "a per-user grant; the user is tenant-scoped and every route is SUPERADMIN-only",
  },
  KanbanColumn: { group: "child", parentKeys: ["projectId"], why: "board contents of a scoped KanbanProject" },
  KanbanLabel: { group: "child", parentKeys: ["projectId"], why: "board contents of a scoped KanbanProject" },
  KanbanSprint: { group: "child", parentKeys: ["projectId"], why: "board contents of a scoped KanbanProject" },
  KanbanProjectMember: { group: "child", parentKeys: ["projectId"], why: "membership of a scoped KanbanProject" },
  KanbanCardRelation: {
    group: "child",
    parentKeys: ["projectId", "sourceCardId", "targetCardId"],
    why: "relation between two cards of a scoped KanbanProject",
  },
  KanbanCardAssignee: { group: "child", parentKeys: ["cardId"], why: "join row of a scoped KanbanCard" },
  KanbanCardLabel: { group: "child", parentKeys: ["cardId"], why: "join row of a scoped KanbanCard" },
  WorkflowStep: { group: "child", parentKeys: ["workflowId"], why: "step of a scoped Workflow" },
  WorkflowAction: { group: "child", parentKeys: ["instanceId"], why: "decision on a scoped WorkflowInstance" },
  NotificationState: {
    group: "child",
    parentKeys: ["notificationId"],
    why: "per-user read state of a scoped Notification",
  },
  TicketComment: { group: "child", parentKeys: ["ticketId"], why: "comment thread of a scoped Ticket" },
});

/**
 * Child-model queries that do not name the parent, each reviewed. Keyed by
 * `<file> <Model>.<method>`; the value is how many such calls the file has
 * and why each is safe. A new one fails until it is reviewed here.
 */
const REVIEWED_WITHOUT_PARENT = Object.freeze({
  "services/kanban.service.js KanbanProjectMember.findAll": {
    count: 1,
    why:
      "listProjects: the caller's memberships (userId / roleId) across projects, used only as " +
      "an id filter on the tenant-SCOPED KanbanProject.findAll that follows",
  },
  "services/ticket.service.js TicketComment.findByPk": {
    count: 1,
    why:
      "addComment re-reads the comment it has just created on a ticket loaded by " +
      "loadTicket (tenant-scoped); the id is the new row's, never the caller's",
  },
  "services/migration.service.js *": {
    count: Infinity,
    why: "demo-data seed/teardown run by the platform operator, not a request path",
  },
});

const METHODS_WITH_WHERE_IN_ARG0 = new Set([
  "findOne",
  "findAll",
  "findAndCountAll",
  "count",
  "destroy",
  "max",
  "min",
  "sum",
]);

describe("D-17 — every model without a tenant column is a reviewed decision", () => {
  const unscoped = allModels.filter((m) => !hasTenantColumn(m)).map((m) => m.name).sort();

  it("the unscoped models are exactly the documented ones", () => {
    expect(unscoped).toEqual(Object.keys(UNSCOPED).sort());
  });

  it("every documented one really has no tenant column (a stale entry fails)", () => {
    for (const name of Object.keys(UNSCOPED)) {
      const model = allModels.find((m) => m.name === name);
      expect({ name, found: Boolean(model), scoped: model && hasTenantColumn(model) }).toEqual({
        name,
        found: true,
        scoped: false,
      });
    }
  });

  it("every child model's parent keys are real attributes", () => {
    for (const [name, entry] of Object.entries(UNSCOPED).filter(([, e]) => e.group === "child")) {
      const model = allModels.find((m) => m.name === name);
      for (const key of entry.parentKeys) {
        expect(`${name}.${key}: ${Boolean(model.rawAttributes[key])}`).toBe(`${name}.${key}: true`);
      }
    }
  });
});

// ── The backstop for the "child" group ───────────────────────────────────

const SRC = path.join(__dirname, "..", "..");
const CHILD = Object.fromEntries(
  Object.entries(UNSCOPED).filter(([, e]) => e.group === "child").map(([k, e]) => [k, e.parentKeys]),
);
/** barrel aliases (`WorkflowSteps`) → model name */
const aliasToModel = new Map(
  Object.entries(models)
    .filter(([, v]) => v && v.name && CHILD[v.name])
    .map(([k, v]) => [k, v.name]),
);

const keyOf = (p) =>
  p.type === "Property" ? (p.key.type === "Identifier" ? p.key.name : p.key.value) : null;

/** Does a `where` object literal name one of `keys` (top level, or inside an Op.and)? */
const namesParent = (where, keys) => {
  if (!where || where.type !== "ObjectExpression") {return false;}
  return where.properties.some((p) => {
    if (keys.includes(keyOf(p))) {return true;}
    // [Op.and]: [{ projectId }, …]
    if (p.type === "Property" && p.computed && p.value.type === "ArrayExpression") {
      return p.key.type === "MemberExpression" && p.key.property.name === "and" &&
        p.value.elements.some((e) => namesParent(e, keys));
    }
    return false;
  });
};

/** [{ line, model, method }] for child-model queries with no parent key. */
const scanSource = (source) => {
  const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script", loc: true });
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") {return;}
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed
    ) {
      const object = node.callee.object;
      const objectName =
        object.type === "Identifier" ? object.name :
          object.type === "MemberExpression" && !object.computed ? object.property.name : null;
      const model = aliasToModel.get(objectName);
      const method = node.callee.property.name;
      if (model) {
        const keys = CHILD[model];
        let ok = true;
        if (method === "findByPk") {
          ok = false; // by id alone: never names the parent
        } else if (METHODS_WITH_WHERE_IN_ARG0.has(method)) {
          const options = node.arguments[method === "max" || method === "min" || method === "sum" ? 1 : 0];
          const where = options && options.type === "ObjectExpression" &&
            options.properties.find((p) => keyOf(p) === "where");
          ok = Boolean(where) && namesParent(where.value, keys);
        } else if (method === "update") {
          const options = node.arguments[1];
          const where = options && options.type === "ObjectExpression" &&
            options.properties.find((p) => keyOf(p) === "where");
          ok = Boolean(where) && namesParent(where.value, keys);
        }
        if (!ok) {found.push({ line: node.loc.start.line, model, method });}
      }
    }
    for (const [k, child] of Object.entries(node)) {
      if (k === "loc") {continue;}
      if (Array.isArray(child)) {child.forEach(visit);}
      else if (child && typeof child.type === "string") {visit(child);}
    }
  };
  visit(ast);
  return found;
};

const sourceFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (!["tests", "migrations", "models"].includes(name)) {walk(full);}
      } else if (name.endsWith(".js")) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
};

describe("D-17 — every query on a child model names its scoped parent", () => {
  it("the scanner bites", () => {
    const found = scanSource(`
      KanbanColumn.findOne({ where: { id } });                       // 2: flagged
      KanbanColumn.findOne({ where: { id, projectId } });
      WorkflowSteps.findByPk(id);                                    // 4: flagged
      TicketComment.update({ body }, { where: { id } });             // 5: flagged
      TicketComment.update({ body }, { where: { id, ticketId } });
      KanbanCardLabel.destroy({ where: { [Op.and]: [{ cardId }] } });
      NotificationState.count({ where: { userId } });                // 8: flagged
      Vendor.findByPk(id);                                           // scoped model
    `);
    expect(found.map((f) => f.line)).toEqual([2, 4, 5, 8]);
  });

  it("no unreviewed child-model query omits the parent key", () => {
    const tally = {};
    const unreviewed = [];
    for (const file of sourceFiles()) {
      // POSIX separators: the review keys are written with "/", and on Windows
      // path.relative answers with backslashes, so every reviewed exception read as new.
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      for (const f of scanSource(fs.readFileSync(file, "utf8"))) {
        if (REVIEWED_WITHOUT_PARENT[`${rel} *`]) {continue;}
        const key = `${rel} ${f.model}.${f.method}`;
        tally[key] = (tally[key] || 0) + 1;
        if (!REVIEWED_WITHOUT_PARENT[key]) {unreviewed.push(`${rel}:${f.line} ${f.model}.${f.method}`);}
      }
    }
    expect(unreviewed).toEqual([]);
    for (const [key, entry] of Object.entries(REVIEWED_WITHOUT_PARENT)) {
      if (entry.count !== Infinity) {
        // A reviewed exception that no longer exists, or has multiplied, is re-reviewed.
        expect(`${key}: ${tally[key] || 0}`).toBe(`${key}: ${entry.count}`);
      }
    }
  });
});
