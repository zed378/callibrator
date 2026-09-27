/**
 * D-24 (ADR-083) — the permanent review check for an unbounded read.
 *
 * `Model.findAll` with no `limit` reads every row its predicate matches. Most
 * such reads in `src/services` are bounded by something else — the children of
 * one parent row, a fixed key list, an id list the caller holds, a GROUP BY —
 * but five of them grew with the tenant until D-24 paged them (the DSAR
 * export, the dashboard trend, the SOP fan-out, the signature history, the
 * audit-trail masking). Nothing stopped a sixth.
 *
 * This scans every service with a real parser (espree, as includeRequired.d12
 * does) and finds each `.findAll(` whose options object has no `limit`
 * (keyset and offset pages both carry one). Each is identified as
 * `<file>::<enclosing function>::<receiver>` — not by line, so an unrelated
 * edit does not move it — and must be on the REVIEWED list below, with the
 * reason it is bounded. A new unbounded `findAll` fails here until someone
 * pages it, or adds it to the list and says why it cannot grow. An entry whose
 * call is gone fails too, so the list stays true.
 *
 * `OPEN` entries are unbounded reads that grow with a tenant and are not paged
 * yet. They are listed so they cannot multiply unseen; each is a follow-up,
 * not an endorsement.
 *
 * The scanner is proven to bite on synthetic sources, so one that silently
 * finds nothing cannot pass.
 */
const fs = require("fs");
const path = require("path");

const espree = require(
  require.resolve("espree", { paths: [path.dirname(require.resolve("eslint/package.json"))] }),
);

const SRC = path.join(__dirname, "..", "..");
const SERVICES = path.join(SRC, "services");

// ------------------------------------------------------------------
// The scanner
// ------------------------------------------------------------------

const keyOf = (property) => property && property.key && (property.key.name || property.key.value);

/** A readable name for a callee's object: `Model`, `Attachment.unscoped()`, `this.x`. */
const nameOf = (node) => {
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "MemberExpression":
      return `${nameOf(node.object)}.${node.property.name || node.property.value}`;
    case "CallExpression":
      return `${nameOf(node.callee)}()`;
    case "ThisExpression":
      return "this";
    default:
      return node.type;
  }
};

/** The name a function gets from where it is defined. */
const functionName = (node, parent) => {
  if (node.id && node.id.name) {
    return node.id.name;
  }
  if (!parent) {
    return null;
  }
  if (parent.type === "VariableDeclarator") {
    return parent.id.name;
  }
  if (parent.type === "AssignmentExpression") {
    return nameOf(parent.left).replace(/^(module\.)?exports\./, "");
  }
  if (parent.type === "Property" || parent.type === "MethodDefinition") {
    return keyOf(parent);
  }
  return null;
};

/**
 * Every unbounded `findAll` in `source`, as `<function>::<receiver>`.
 * @param {string} source
 * @returns {string[]}
 */
const unboundedFindAlls = (source) => {
  const ast = espree.parse(source, { ecmaVersion: "latest", sourceType: "script" });
  const found = [];
  const names = [];
  const visit = (node, parent) => {
    let named = false;
    if (/Function/.test(node.type)) {
      const name = functionName(node, parent);
      if (name) {
        names.push(name);
        named = true;
      }
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.property.name === "findAll"
    ) {
      const [options] = node.arguments;
      const bounded =
        options && options.type === "ObjectExpression" && options.properties.some((p) => keyOf(p) === "limit");
      if (!bounded) {
        found.push(`${names[names.length - 1] || "<module>"}::${nameOf(node.callee.object)}`);
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.filter((c) => c && typeof c.type === "string").forEach((c) => visit(c, node));
      } else if (child && typeof child.type === "string") {
        visit(child, node);
      }
    }
    if (named) {
      names.pop();
    }
  };
  visit(ast, null);
  return found;
};

/** Every service file, relative to src/services, forward-slashed. */
const serviceFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith(".js")) {
        out.push(full);
      }
    }
  };
  walk(SERVICES);
  return out.sort();
};

/** `{ "<file>::<function>::<receiver>": count }` over every service. */
const scanServices = () => {
  const counts = {};
  for (const file of serviceFiles()) {
    const rel = path.relative(SERVICES, file).split(path.sep).join("/");
    for (const site of unboundedFindAlls(fs.readFileSync(file, "utf8"))) {
      const key = `${rel}::${site}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
};

// ------------------------------------------------------------------
// The reviewed list
// ------------------------------------------------------------------

const PARENT = "the children of one parent row (one record, project, workflow, role, subtree or user)";
const KEYS = "a fixed key list or key prefix of one tenant's settings";
const IDS = "an id list the caller already holds";
const GROUPED = "an aggregate: one row per GROUP BY value";
const CLOSED = "a small, administrator-made set (roles, menus, a tenant's keys, domains, webhooks, alerts, quotas)";
const SCRIPT = "an operator's seed/unseed/migration tool, not a request path";
const OPEN = "OPEN — grows with the tenant, not paged yet (ADR-083 follow-up)";

/** Each entry: [the most calls allowed under this key, why it is bounded]. */
const REVIEWED = Object.freeze({
  "ai.service.js::getAiConfig::TenantSettings": [1, KEYS],
  "attachment.service.js::restoreForResource::Attachment.unscoped()": [1, IDS],
  "attachment.service.js::restoreForResource::AuditLog": [2, PARENT],
  "attachment.service.js::softDeleteForResource::Attachment": [1, PARENT],
  "auth.service.js::getAuthUserWithTenant::TenantSettings": [1, KEYS],
  "auth.service.js::passwordManagedBy::TenantSettings": [1, KEYS],
  "calibrationDevices.service.js::bulkImportCalibrationDevices::CalibrationDevice.unscoped()": [1, OPEN],
  "calibrationScheduler.service.js::getDueDevices::CalibrationDevice": [1, OPEN],
  "calibrationScheduler.service.js::openWorkOrdersOf::MaintenanceWorkOrder": [1, IDS],
  "certificate.service.js::getCertificateStats::Certificate": [1, GROUPED],
  "content.service.js::listCategories::Category": [1, CLOSED],
  "customDomains.service.js::domainNotificationRecipients::User": [1, CLOSED],
  "customDomains.service.js::getTenantDomains::CustomDomain": [1, CLOSED],
  "dashboard.service.js::countByStatus::Model": [1, GROUPED],
  "dashboard.service.js::getDashboardMetrics::CalibrationDevice": [1, GROUPED],
  "dashboard.service.js::getDashboardMetrics::Tenant": [1, OPEN],
  "dashboard.service.js::getDashboardMetrics::User": [1, GROUPED],
  "dashboard.service.js::monthlyTrend::Model": [1, GROUPED],
  "dataRetention.service.js::maskPII::User": [1, IDS],
  "dataRetention.service.js::readRetentionPolicy::TenantSettings": [1, KEYS],
  "eSignature.service.js::completeWorkflow::SignatureWorkflowStep": [1, PARENT],
  "eSignature.service.js::getEligibleSigners::Role": [1, IDS],
  "eSignature.service.js::getEligibleSigners::User": [1, OPEN],
  "eSignature.service.js::getKeyPairs::TenantKey": [1, CLOSED],
  "eSignature.service.js::getSignerWorkflows::SignatureWorkflow": [1, IDS],
  "eSignature.service.js::getSignerWorkflows::SignatureWorkflowStep": [1, OPEN],
  "eSignature.service.js::getWorkflows::SignatureWorkflow": [1, OPEN],
  "eSignature.service.js::signDocument::SignatureWorkflowStep": [1, PARENT],
  "featureFlag.service.js::getTenantFlags::TenantSettings": [1, KEYS],
  "finance.service.js::getDepreciationReport::AssetFinance": [1, OPEN],
  "gdpr.service.js::getConsentHistory::ConsentRecord": [1, PARENT],
  "kanban.service.js::getMetrics::KanbanCard": [1, PARENT],
  "kanban.service.js::getMetrics::KanbanColumn": [1, PARENT],
  "kanban.service.js::getMetrics::KanbanLabel": [1, PARENT],
  "kanban.service.js::getMetrics::KanbanSprint": [1, PARENT],
  "kanban.service.js::getProject::KanbanCard": [1, PARENT],
  "kanban.service.js::getProject::KanbanColumn": [1, PARENT],
  "kanban.service.js::getProject::KanbanLabel": [1, PARENT],
  "kanban.service.js::getProject::KanbanProjectMember": [1, PARENT],
  "kanban.service.js::getProject::KanbanSprint": [1, PARENT],
  "kanban.service.js::listProjects::KanbanProject": [2, OPEN],
  "kanban.service.js::listProjects::KanbanProjectMember": [1, PARENT],
  "kanban.service.js::listSprints::KanbanSprint": [1, PARENT],
  "kanban.service.js::loadRelations::KanbanCardRelation": [1, PARENT],
  "kanban.service.js::migrateCards::KanbanColumn": [1, PARENT],
  "kanban.service.js::renumber::KanbanCard": [1, PARENT],
  "kanban.service.js::reorderColumns::KanbanColumn": [2, PARENT],
  "kanban.service.js::resolveAccess::KanbanProjectMember": [1, PARENT],
  "maintenance.service.js::createAutoScheduledWorkOrders::CalibrationDevice": [1, IDS],
  "maintenance.service.js::createAutoScheduledWorkOrders::MaintenanceWorkOrder": [1, IDS],
  "menuGroup.service.js::bulkAssign::MenuGroup": [1, IDS],
  "menuGroup.service.js::deleteMenuGroup::MenuGroup": [1, PARENT],
  "menuGroup.service.js::fetchActiveParentGroups::MenuGroup": [1, CLOSED],
  "menuGroup.service.js::getAvailableRoles::Role": [1, CLOSED],
  "menuGroup.service.js::getRoleMenuAssignments::RoleMenuPermission": [1, CLOSED],
  "menuGroup.service.js::listMenuGroups::RoleMenuPermission": [1, CLOSED],
  "meteredBilling.service.js::enforceQuotas::PlanQuota": [1, CLOSED],
  "meteredBilling.service.js::getPlatformAnalytics::UsageMetric": [1, GROUPED],
  "meteredBilling.service.js::getUsageAlerts::UsageAlert": [1, CLOSED],
  "migration.service.js::seedApplicationRoles::Roles": [1, SCRIPT],
  "migration.service.js::seedDefaultRoles::Roles": [1, SCRIPT],
  "migration.service.js::unseedDemoData::CalibrationDevice": [1, SCRIPT],
  "migration.service.js::unseedDemoData::KanbanProject": [1, SCRIPT],
  "migration.service.js::unseedDemoData::Post": [1, SCRIPT],
  "migration.service.js::unseedDemoData::Ticket": [1, SCRIPT],
  "migration.service.js::unseedDemoData::Vendor": [1, SCRIPT],
  "migration.service.js::unseedDemoData::Warehouse": [1, SCRIPT],
  "migration.service.js::unseedDemoData::Workflow": [1, SCRIPT],
  "notification.service.js::deleteAllNotifications::Notification": [1, OPEN],
  "notification.service.js::deleteManyNotifications::Notification": [1, IDS],
  "notification.service.js::markAllAsRead::Notification": [1, OPEN],
  "notification.service.js::setStateForMany::NotificationState": [1, IDS],
  "oidcProvider.service.js::getClients::TenantSettings": [1, KEYS],
  "reporting.service.js::getCompliance::CalibrationRecord": [1, OPEN],
  "reporting.service.js::getInventory::Stock": [1, OPEN],
  "reporting.service.js::getOverdueDevices::CalibrationDevice": [1, OPEN],
  "reporting.service.js::groupCount::Model": [1, GROUPED],
  "roles.service.js::getRoleMenus::RoleMenuPermission": [1, CLOSED],
  "roles.service.js::getRolePermissionsMatrix::RoleMenuPermission": [1, CLOSED],
  "scim.service.js::groupMembers::Users": [1, OPEN],
  "session.service.js::registerLivenessInvalidation::model.unscoped()": [1, IDS],
  "stock.service.js::exportInventoryCsv::Stock": [1, OPEN],
  "stock.service.js::getInventoryReport::Stock": [1, OPEN],
  "storage/config.service.js::getTenantConfig::TenantSettings": [1, KEYS],
  "storageMigration.service.js::migrateAll::Attachment": [1, SCRIPT],
  "tenant.service.js::fetchTenants::Users": [1, GROUPED],
  "tenant.service.js::getTenantSettings::TenantSettings": [1, KEYS],
  "tenant.service.js::updateTenantSettings::TenantSettings": [1, KEYS],
  "tenantBackup.service.js::cleanupExpiredBackups::TenantBackup": [1, OPEN],
  "tenantBackup.service.js::exportTenantData::Users": [1, OPEN],
  "tenantBackup.service.js::getBackupStats::TenantBackup": [1, GROUPED],
  "tenantHierarchy.service.js::getDescendantTenants::TenantHierarchy": [1, PARENT],
  "tenantHierarchy.service.js::getTenantTree::TenantHierarchy": [1, PARENT],
  "tenantHierarchy.service.js::getUserRolesAcrossTenants::User": [1, IDS],
  "tenantHierarchy.service.js::moveTenant::TenantHierarchy": [1, PARENT],
  "tenantLifecycle.service.js::exportTenantData::Invoice": [1, OPEN],
  "tenantLifecycle.service.js::exportTenantData::Subscription": [1, PARENT],
  "tenantLifecycle.service.js::exportTenantData::TenantSettings": [1, KEYS],
  "tenantLifecycle.service.js::exportTenantData::User": [1, OPEN],
  "ticket.service.js::getMetrics::Ticket": [1, OPEN],
  "user.service.js::fetchUsers::Users": [1, GROUPED],
  "userPermission.service.js::getUserOverrideMatrix::UserMenuPermission": [1, CLOSED],
  "userPermission.service.js::getUserPermissions::MenuGroup": [1, CLOSED],
  "userPermission.service.js::getUserPermissions::RoleMenuPermission": [1, CLOSED],
  "userPermission.service.js::getUserPermissions::UserMenuPermission": [1, CLOSED],
  "warehouse.service.js::fetchLocations::StorageLocation": [1, PARENT],
  "webhook.service.js::emitEvent::Webhook": [1, CLOSED],
  "webhookDeliveryPurge.service.js::purgeFinishedDeliveries::Tenant": [1, OPEN],
  "workflow.service.js::getPendingTasks::WorkflowInstance": [1, OPEN],
  "workflow.service.js::getWorkflows::Workflow": [1, CLOSED],
  "workflow.service.js::updateWorkflow::WorkflowStep": [1, PARENT],
});

// ------------------------------------------------------------------
// The tests
// ------------------------------------------------------------------

describe("D-24 (ADR-083) — the scanner", () => {
  it("flags a findAll with no options, with options but no limit, and with options it cannot read", () => {
    const source = `
      const a = async () => Device.findAll();
      exports.list = async (tenantId) => Device.findAll({ where: { tenantId } });
      function viaVariable(options) { return Stock.unscoped().findAll(options); }
      const obj = { method() { return Role.findAll({ order: [["name", "ASC"]] }); } };
    `;
    expect(unboundedFindAlls(source)).toEqual([
      "a::Device",
      "list::Device",
      "viaVariable::Stock.unscoped()",
      "method::Role",
    ]);
  });

  it("does not flag a findAll that carries a limit — a keyset page or an offset page", () => {
    const source = `
      const page = async (after) => Device.findAll({ where: { id: { [Op.gt]: after } }, order: [["id", "ASC"]], limit: 500 });
      const offset = async () => Device.findAll({ limit, offset: 10 });
      Device.findOne({ where: {} });
    `;
    expect(unboundedFindAlls(source)).toEqual([]);
  });

  it("names a call at module level, and a receiver it cannot name by its node type", () => {
    expect(unboundedFindAlls("models[name].findAll({});")).toEqual(["<module>::models.name"]);
    expect(unboundedFindAlls("(async () => (await load()).findAll({}))();")).toEqual(["<module>::AwaitExpression"]);
  });

  it("finds the services' own unbounded reads — it is not silently scanning nothing", () => {
    const found = scanServices();
    expect(Object.keys(found).length).toBeGreaterThan(50);
    expect(found["dashboard.service.js::monthlyTrend::Model"]).toBe(1);
  });
});

describe("D-24 (ADR-083) — every unbounded findAll in src/services is reviewed", () => {
  const found = scanServices();

  it("no service adds an unbounded findAll that is not on the reviewed list (or more calls than it allows)", () => {
    const unreviewed = Object.entries(found)
      .filter(([key, count]) => !REVIEWED[key] || count > REVIEWED[key][0])
      .map(([key, count]) => `${key} (${count})`);
    // Page it (`limit` + keyset), or add it to REVIEWED with why it cannot grow.
    expect(unreviewed).toEqual([]);
  });

  it("every reviewed entry still names a call — a removed one is taken off the list", () => {
    const stale = Object.keys(REVIEWED).filter((key) => !found[key]);
    expect(stale).toEqual([]);
  });

  it("every entry gives a reason from the fixed set", () => {
    const reasons = new Set([PARENT, KEYS, IDS, GROUPED, CLOSED, SCRIPT, OPEN]);
    for (const [key, [count, reason]] of Object.entries(REVIEWED)) {
      expect({ key, count: Number.isInteger(count) && count > 0, reason: reasons.has(reason) }).toEqual({
        key,
        count: true,
        reason: true,
      });
    }
  });

  it("the reads D-24 paged are keyset pages: each is a findAll the scanner sees, and none is unbounded", () => {
    const paged = [
      ["gdpr.service.js", "pagesOf", "Model"], // the DSAR export (ADR-070)
      ["sop.service.js", "assignTraining", "User"], // the SOP fan-out (ADR-070)
      ["dataRetention.service.js", "maskAuditTrail", "AuditLog"], // ADR-083
      ["attachmentFileSweep.service.js", "sweepBatch", "Attachment.unscoped()"], // ADR-083
      ["kanban.service.js", "deleteProject", "KanbanCard"], // ADR-083
    ];
    for (const [file, fn, receiver] of paged) {
      const source = fs.readFileSync(path.join(SERVICES, file), "utf8");
      // The call exists (so a rename cannot make this vacuous) …
      expect({ file, fn, present: new RegExp(`${receiver.replace(/[().]/g, "\\$&")}\\.findAll\\(`).test(source) }).toEqual({
        file,
        fn,
        present: true,
      });
      // … and it is not unbounded.
      expect({ file, fn, unbounded: found[`${file}::${fn}::${receiver}`] || 0 }).toEqual({ file, fn, unbounded: 0 });
    }
  });
});
