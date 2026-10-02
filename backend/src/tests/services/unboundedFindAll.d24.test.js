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
// ADR-087 Amendment 4: a converted (.ts) file is parsed with typescript-estree,
// which yields the same ESTree node shapes espree does (plus TS-only nodes the
// visitor walks past), so the rule reads converted files exactly as before.
const tsEstree = require("@typescript-eslint/typescript-estree");
const unboundedFindAlls = (source, file = "") => {
  const ast = /\.ts$/.test(file)
    ? tsEstree.parse(source)
    : espree.parse(source, { ecmaVersion: "latest", sourceType: "script" });
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
      } else if (/\.(js|ts)$/.test(name) && !name.endsWith(".d.ts")) {
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
    for (const site of unboundedFindAlls(fs.readFileSync(file, "utf8"), file)) {
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
  // ADR-108 Amendment 1: one user's passkeys — at most MAX_PASSKEYS_PER_USER (10).
  "webauthn.service.ts::getRegistrationOptions::WebauthnCredential": [1, PARENT],
  "webauthn.service.ts::getLoginOptions::WebauthnCredential": [1, PARENT],
  "webauthn.service.ts::getStatus::WebauthnCredential": [1, PARENT],
  "webauthn.service.ts::listPasskeys::WebauthnCredential": [1, PARENT],
  // P10-05 (ADR-098 §6): the access-request queue. The retention sweep's two
  // reads are batched (RETENTION_BATCH); these read one address's requests.
  "accessRequest.service.ts::duplicateCounts::AccessRequest": [1, IDS], // the addresses on the page being shown
  "accessRequest.service.ts::getAccessRequest::AccessRequest": [1, PARENT], // the other requests of one address
  "accessRequest.service.ts::eraseAccessRequestsByEmail::AccessRequest": [1, PARENT], // one address's requests
  // P10-04: the super admin's SSO email-domain claims — one settings key.
  "loginDiscovery.service.ts::claimantOf::TenantSettings": [1, CLOSED],
  "loginDiscovery.service.ts::setSsoEmailDomains::TenantSettings": [1, CLOSED],
  "ai.service.ts::getAiConfig::TenantSettings": [1, KEYS],
  "attachment.service.ts::restoreForResource::Attachment.unscoped()": [1, IDS],
  "attachment.service.ts::restoreForResource::AuditLog": [2, PARENT],
  "attachment.service.ts::softDeleteForResource::Attachment": [1, PARENT],
  "auth.service.ts::getAuthUserWithTenant::TenantSettings": [1, KEYS],
  "auth.service.ts::passwordManagedBy::TenantSettings": [1, KEYS],
  // P10-16 (ADR-099): the live super admins not already one-time, once per boot — a handful of
  // platform operators, never a tenant's users.
  "bootstrapCredential.service.ts::retireKnownDefaultPassword::Users": [1, CLOSED],
  "calibrationDevices.service.ts::bulkImportCalibrationDevices::CalibrationDevice.unscoped()": [1, OPEN],
  "calibrationScheduler.service.ts::getDueDevices::CalibrationDevice": [1, OPEN],
  "calibrationScheduler.service.ts::openWorkOrdersOf::MaintenanceWorkOrder": [1, IDS],
  "certificate.service.ts::getCertificateStats::Certificate": [1, GROUPED],
  "content.service.ts::listCategories::Category": [1, CLOSED], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "customDomains.service.ts::domainNotificationRecipients::User": [1, CLOSED], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "customDomains.service.ts::getTenantDomains::CustomDomain": [1, CLOSED], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "dashboard.service.ts::countByStatus::Model": [1, GROUPED],
  "dashboard.service.ts::getDashboardMetrics::CalibrationDevice": [1, GROUPED],
  "dashboard.service.ts::getDashboardMetrics::Tenant": [1, OPEN],
  "dashboard.service.ts::getDashboardMetrics::User": [1, GROUPED],
  "dashboard.service.ts::monthlyTrend::Model": [1, GROUPED],
  "dataRetention.service.ts::maskPII::User": [1, IDS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "dataRetention.service.ts::readRetentionPolicy::TenantSettings": [1, KEYS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "eSignature.service.ts::completeWorkflow::SignatureWorkflowStep": [1, PARENT],
  "eSignature.service.ts::getEligibleSigners::Role": [1, IDS],
  "eSignature.service.ts::getEligibleSigners::User": [1, OPEN],
  "eSignature.service.ts::getKeyPairs::TenantKey": [1, CLOSED],
  "eSignature.service.ts::getSignerWorkflows::SignatureWorkflow": [1, IDS],
  "eSignature.service.ts::getSignerWorkflows::SignatureWorkflowStep": [1, OPEN],
  "eSignature.service.ts::getWorkflows::SignatureWorkflow": [1, OPEN],
  "eSignature.service.ts::signDocument::SignatureWorkflowStep": [1, PARENT],
  "featureFlag.service.ts::getTenantFlags::TenantSettings": [1, KEYS], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "finance.service.ts::getDepreciationReport::AssetFinance": [1, OPEN], // P9-17: the file is TypeScript (re-keyed, ADR-087)
  "gdpr.service.ts::getConsentHistory::ConsentRecord": [1, PARENT],
  "kanban.service.ts::getMetrics::KanbanCard": [1, PARENT],
  "kanban.service.ts::getMetrics::KanbanColumn": [1, PARENT],
  "kanban.service.ts::getMetrics::KanbanLabel": [1, PARENT],
  "kanban.service.ts::getMetrics::KanbanSprint": [1, PARENT],
  "kanban.service.ts::getProject::KanbanCard": [1, PARENT],
  "kanban.service.ts::getProject::KanbanColumn": [1, PARENT],
  "kanban.service.ts::getProject::KanbanLabel": [1, PARENT],
  "kanban.service.ts::getProject::KanbanProjectMember": [1, PARENT],
  "kanban.service.ts::getProject::KanbanSprint": [1, PARENT],
  "kanban.service.ts::listProjects::KanbanProject": [2, OPEN],
  "kanban.service.ts::listProjects::KanbanProjectMember": [1, PARENT],
  "kanban.service.ts::listSprints::KanbanSprint": [1, PARENT],
  "kanban.service.ts::loadRelations::KanbanCardRelation": [1, PARENT],
  "kanban.service.ts::migrateCards::KanbanColumn": [1, PARENT],
  "kanban.service.ts::renumber::KanbanCard": [1, PARENT],
  "kanban.service.ts::reorderColumns::KanbanColumn": [2, PARENT],
  "kanban.service.ts::resolveAccess::KanbanProjectMember": [1, PARENT],
  "maintenance.service.ts::createAutoScheduledWorkOrders::CalibrationDevice": [1, IDS],
  "maintenance.service.ts::createAutoScheduledWorkOrders::MaintenanceWorkOrder": [1, IDS],
  "menuGroup.service.ts::bulkAssign::MenuGroup": [1, IDS],
  "menuGroup.service.ts::deleteMenuGroup::MenuGroup": [1, PARENT],
  "menuGroup.service.ts::fetchActiveParentGroups::MenuGroup": [1, CLOSED],
  "menuGroup.service.ts::getAvailableRoles::Role": [1, CLOSED],
  "menuGroup.service.ts::getMyPermissions::MenuGroup": [1, CLOSED], // ADR-102: the active menu slugs (the seeded tree)
  "menuGroup.service.ts::listMenuGroups::RoleMenuPermission": [1, CLOSED],
  "meteredBilling.service.ts::enforceQuotas::PlanQuota": [1, CLOSED], // P9-17: the file is TypeScript (re-keyed, ADR-087)
  "meteredBilling.service.ts::getPlatformAnalytics::UsageMetric": [1, GROUPED], // P9-17: the file is TypeScript (re-keyed, ADR-087)
  "meteredBilling.service.ts::getUsageAlerts::UsageAlert": [1, CLOSED], // P9-17: the file is TypeScript (re-keyed, ADR-087)
  "migration.service.ts::seedApplicationRoles::Roles": [1, SCRIPT],
  "migration.service.ts::seedDefaultRoles::Roles": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::CalibrationDevice": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::KanbanProject": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::Post": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::Ticket": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::Vendor": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::Warehouse": [1, SCRIPT],
  "migration.service.ts::unseedDemoData::Workflow": [1, SCRIPT],
  "notification.service.ts::deleteAllNotifications::Notification": [1, OPEN],
  "notification.service.ts::deleteManyNotifications::Notification": [1, IDS],
  "notification.service.ts::markAllAsRead::Notification": [1, OPEN],
  "notification.service.ts::setStateForMany::NotificationState": [1, IDS],
  "oidcProvider.service.ts::getClients::TenantSettings": [1, KEYS],
  "reporting.service.ts::getCompliance::CalibrationRecord": [1, OPEN], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "reporting.service.ts::getInventory::Stock": [1, OPEN], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "reporting.service.ts::getOverdueDevices::CalibrationDevice": [1, OPEN], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "reporting.service.ts::groupCount::Model": [1, GROUPED], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "roles.service.ts::getRoleMenus::RoleMenuPermission": [1, CLOSED],
  "roles.service.ts::getRolePermissionsMatrix::RoleMenuPermission": [1, CLOSED],
  "scim.service.ts::groupMembers::Users": [1, OPEN],
  "session.service.ts::registerLivenessInvalidation::model.unscoped()": [1, IDS], // P9-12: the file is TypeScript (re-keyed, ADR-087 Am. 13)
  "stock.service.ts::exportInventoryCsv::Stock": [1, OPEN], // P9-15: the file is TypeScript (re-keyed, ADR-087)
  "stock.service.ts::getInventoryReport::Stock": [1, OPEN], // P9-15: the file is TypeScript (re-keyed, ADR-087)
  "storage/config.service.ts::getTenantConfig::TenantSettings": [1, KEYS], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "storageMigration.service.ts::migrateAll::Attachment": [1, SCRIPT],
  "tenant.service.ts::fetchTenants::Users": [1, GROUPED], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenant.service.ts::getTenantSettings::TenantSettings": [1, KEYS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenant.service.ts::updateTenantSettings::TenantSettings": [1, KEYS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantBackup.service.ts::cleanupExpiredBackups::TenantBackup": [1, OPEN], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantBackup.service.ts::exportTenantData::Users": [1, OPEN], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantBackup.service.ts::getBackupStats::TenantBackup": [1, GROUPED], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantHierarchy.service.ts::getDescendantTenants::TenantHierarchy": [1, PARENT], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantHierarchy.service.ts::getTenantTree::TenantHierarchy": [1, PARENT], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantHierarchy.service.ts::getUserRolesAcrossTenants::User": [1, IDS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantHierarchy.service.ts::moveTenant::TenantHierarchy": [1, PARENT], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantLifecycle.service.ts::exportTenantData::Invoice": [1, OPEN], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantLifecycle.service.ts::exportTenantData::Subscription": [1, PARENT], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantLifecycle.service.ts::exportTenantData::TenantSettings": [1, KEYS], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "tenantLifecycle.service.ts::exportTenantData::User": [1, OPEN], // P9-13: the file is TypeScript (re-keyed, ADR-087)
  "ticket.service.ts::getMetrics::Ticket": [1, OPEN],
  "user.service.ts::fetchUsers::Users": [1, GROUPED],
  "userPermission.service.ts::getUserOverrideMatrix::UserMenuPermission": [1, CLOSED],
  "userPermission.service.ts::getUserPermissions::MenuGroup": [1, CLOSED],
  "userPermission.service.ts::getUserPermissions::RoleMenuPermission": [1, CLOSED],
  "userPermission.service.ts::getUserPermissions::UserMenuPermission": [1, CLOSED],
  "warehouse.service.ts::fetchLocations::StorageLocation": [1, PARENT], // P9-15: the file is TypeScript (re-keyed, ADR-087)
  "webhook.service.ts::emitEvent::Webhook": [1, CLOSED],
  "webhookDeliveryPurge.service.ts::purgeFinishedDeliveries::Tenant": [1, OPEN], // P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
  "workflow.service.ts::getPendingTasks::WorkflowInstance": [1, OPEN], // P9-16: the file is TypeScript (re-keyed, ADR-087)
  "workflow.service.ts::getWorkflows::Workflow": [1, CLOSED], // P9-16: the file is TypeScript (re-keyed, ADR-087)
  "workflow.service.ts::updateWorkflow::WorkflowStep": [1, PARENT], // P9-16: the file is TypeScript (re-keyed, ADR-087)
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
    expect(found["dashboard.service.ts::monthlyTrend::Model"]).toBe(1);
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
      ["gdpr.service.ts", "pagesOf", "Model"], // the DSAR export (ADR-070)
      ["sop.service.ts", "assignTraining", "User"], // the SOP fan-out (ADR-070); P9-18 leaves: the file is TypeScript (re-keyed, ADR-087)
      ["dataRetention.service.ts", "maskAuditTrail", "AuditLog"], // ADR-083; P9-13: the file is TypeScript (re-keyed, ADR-087)
      ["attachmentFileSweep.service.ts", "sweepBatch", "Attachment.unscoped()"], // ADR-083
      ["kanban.service.ts", "deleteProject", "KanbanCard"], // ADR-083
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
