/**
 * Database Models Index — Dynamic Loading Entry Point
 *
 * Architecture:
 * - All models reside in src/models/ as individual files
 * - Each model exports a function that accepts the Sequelize instance and DataTypes
 * - Static require() manifest initializes models (single-file-binary safe)
 * - Association methods on each model are called after all models are loaded
 * - Single aggregated db object is exported for dependency injection
 *
 * This pattern enforces:
 * - One model per file (1:1 ratio)
 * - No hard-coded model imports
 * - Centralized model access
 * - Automatic association resolution
 *
 * Models:
 * - Tenant: Organization/entity with plan and settings
 * - User: Individual user accounts within tenants
 * - Role: RBAC roles with CRUD permissions (read/write) on menu groups
 * - MenuGroup: Navigation menu groups that roles can access
 * - RoleMenuPermission: Maps read/write permissions on menu groups to roles
 * - Session: Persistent authentication session records
 * - Warehouse: Physical warehouse locations for a tenant
 * - StorageLocation: Specific storage locations within a warehouse
 * - Stock: Inventory levels per SKU per warehouse location
 * - StockTransfer: Inter-warehouse stock transfers
 * - StockAdjustment: Manual stock adjustments (add/remove)
 * - StockOpname: Periodic inventory counting records
 * - CalibrationDevice: Devices with calibration schedule tracking
 * - CalibrationRecord: Calibration history for devices
 * - TenantBackup: Backup operation records for tenants
 * - TenantSettings: Key-value tenant configuration settings
 * - Certificate: Calibration certificates with digital signatures
 * - Vendor: Third-party calibration labs and parts suppliers
 * - MaintenanceWorkOrder: Maintenance and repair tracking for calibration devices
 * - Notification: System and user-specific alerts and messages
 * - Subscription: Tenant subscription plans and billing cycles
 * - Invoice: Billing invoices linked to subscriptions
 * - AuditLog: Immutable audit trail for FDA 21 CFR Part 11 / ISO 17025 compliance
 * - Workflow: Custom dynamic approval workflows
 * - WorkflowStep: Sequential steps in a custom workflow
 * - WorkflowInstance: Active instances of custom workflows
 * - WorkflowAction: User actions (approvals/rejections) on workflow instances
 * - Risk: Risk assessment and mitigation records
 * - SupplierScorecard: Supplier performance tracking records
 */

const { Sequelize, DataTypes, Op } = require("sequelize");

// Use the shared Sequelize instance from config.
// This ensures all queries use the configured pool, SSL, timezone,
// retry logic, and logging settings instead of Sequelize defaults.
const { db } = require("../config");
// (tenant context is read inside utils/tenantScope.util.js)

const models = {};

// Static Loading: one explicit require() per model file. Dynamic discovery
// (fs.readdirSync(__dirname) + require(path.join(...))) returns nothing / fails
// to resolve inside a single-file binary's virtual filesystem (@yao-pkg/pkg,
// bun --compile), so the whole set is listed statically to stay visible to the
// bundler's static analysis. Load order is irrelevant — associations run after
// every model is registered (see the associate loop below).
const modelFiles = [
  require("./apiKey.model"),
  require("./assetFinance.model"),
  require("./attachment.model"),
  require("./auditLog.model"),
  require("./batchJob.model"),
  require("./calibrationDevice.model"),
  require("./calibrationRecord.model"),
  require("./capa.model"),
  require("./category.model"),
  require("./certificate.model"),
  require("./consentRecord.model"),
  require("./customDomain.model"),
  require("./dataRetentionPolicy.model"),
  require("./documentChunk.model"),
  require("./dsarRequest.model"),
  require("./eSignatureRecord.model"),
  require("./invoice.model"),
  require("./iotReading.model"),
  require("./kanbanCard.model"),
  require("./kanbanCardAssignee.model"),
  require("./kanbanCardLabel.model"),
  require("./kanbanCardRelation.model"),
  require("./kanbanColumn.model"),
  require("./kanbanLabel.model"),
  require("./kanbanProject.model"),
  require("./kanbanProjectMember.model"),
  require("./kanbanSprint.model"),
  require("./maintenanceWorkOrder.model"),
  require("./menuGroup.model"),
  require("./nonConformance.model"),
  require("./notification.model"),
  require("./notificationState.model"),
  require("./planQuota.model"),
  require("./post.model"),
  require("./postCategory.model"),
  require("./risk.model"),
  require("./role.model"),
  require("./roleMenuPermission.model"),
  require("./session.model"),
  require("./signatureRecord.model"),
  require("./signatureWorkflow.model"),
  require("./signatureWorkflowStep.model"),
  require("./sopDocument.model"),
  require("./sopTrainingAcknowledgment.model"),
  require("./stock.model"),
  require("./stockAdjustment.model"),
  require("./stockOpname.model"),
  require("./stockTransfer.model"),
  require("./storageLocation.model"),
  require("./subscription.model"),
  require("./supplierScorecard.model"),
  require("./tenant.model"),
  require("./tenantBackup.model"),
  require("./tenantHierarchy.model"),
  require("./tenantKey.model"),
  require("./tenantSettings.model"),
  require("./ticket.model"),
  require("./ticketComment.model"),
  require("./ticketCounter.model"),
  require("./usageAlert.model"),
  require("./usageMetric.model"),
  require("./user.model"),
  require("./userMenuPermission.model"),
  require("./vendor.model"),
  require("./warehouse.model"),
  require("./webhook.model"),
  require("./webhookDelivery.model"),
  require("./workflow.model"),
  require("./workflowAction.model"),
  require("./workflowInstance.model"),
  require("./workflowStep.model"),
];

modelFiles.forEach((defineModel) => {
  const model = defineModel(db, DataTypes);
  models[model.name] = model;
});

// Association Mapping: Iterate models, execute associate method if exists
Object.keys(models).forEach((modelName) => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Global Export: Export collective models object for dependency injection
db.sequelize = db;
db.Sequelize = Sequelize;
db.Op = Op;

// ============================================================================
// APPLICATION-LEVEL RLS (ROW-LEVEL SECURITY) / TENANT ISOLATION HOOKS
// ============================================================================
// These hooks intercept every query and automatically inject the tenant ID
// from the AsyncLocalStorage context (set by auth middleware).
// This acts as a defense-in-depth layer across the entire ORM.

// Isolation now lives in utils/tenantScope.util.js — unit-tested and
// DENY BY DEFAULT. The previous inline hooks returned early whenever the
// request had no tenantId, i.e. applied NO filter, so an authenticated
// principal without a tenant read every tenant's rows (the same fail-open
// hole the Postgres RLS policy had via its `app.current_tenant = ''` branch).
// tenantScope resolves that case to a predicate that cannot match.
require("../utils/tenantScope.util").register(db);

/**
 * Initializes native Postgres Row-Level Security (RLS) on all models with a tenantId.
 * This should be called after db.sync() in index.js.
 */
// Postgres ROW LEVEL SECURITY has been removed. It only worked on Postgres
// (blocking multi-engine support) and its policy matched every row when
// app.current_tenant was empty. Isolation is enforced above by
// utils/tenantScope.util.js, deny-by-default, on every dialect.

// Backward compatibility: export both singular and plural names
module.exports = Object.assign(db, {
  // Singular
  Tenant: models.Tenant,
  User: models.User,
  Role: models.Role,
  MenuGroup: models.MenuGroup,
  RoleMenuPermission: models.RoleMenuPermission,
  UserMenuPermission: models.UserMenuPermission,
  AssetFinance: models.AssetFinance,
  Session: models.Session,
  Warehouse: models.Warehouse,
  StorageLocation: models.StorageLocation,
  Stock: models.Stock,
  StockTransfer: models.StockTransfer,
  StockAdjustment: models.StockAdjustment,
  StockOpname: models.StockOpname,
  CalibrationDevice: models.CalibrationDevice,
  CalibrationRecord: models.CalibrationRecord,
  TenantBackup: models.TenantBackup,
  TenantSettings: models.TenantSettings,
  Certificate: models.Certificate,
  Vendor: models.Vendor,
  MaintenanceWorkOrder: models.MaintenanceWorkOrder,
  Notification: models.Notification,
  NotificationState: models.NotificationState,
  Subscription: models.Subscription,
  Invoice: models.Invoice,
  AuditLog: models.AuditLog,
  Attachment: models.Attachment,
  Webhook: models.Webhook,
  WebhookDelivery: models.WebhookDelivery,
  ApiKey: models.ApiKey,
  Workflow: models.Workflow,
  WorkflowStep: models.WorkflowStep,
  WorkflowInstance: models.WorkflowInstance,
  WorkflowAction: models.WorkflowAction,
  Post: models.Post,
  Category: models.Category,
  PostCategory: models.PostCategory,

  // Kanban. The loader registers every model file into `models`, but only the
  // keys listed here are re-exported — an unexported model reads back as
  // undefined at require time.
  KanbanProject: models.KanbanProject,
  KanbanProjectMember: models.KanbanProjectMember,
  KanbanColumn: models.KanbanColumn,
  KanbanCard: models.KanbanCard,
  KanbanLabel: models.KanbanLabel,
  KanbanCardAssignee: models.KanbanCardAssignee,
  KanbanCardLabel: models.KanbanCardLabel,
  KanbanSprint: models.KanbanSprint,
  KanbanCardRelation: models.KanbanCardRelation,
  Ticket: models.Ticket,
  TicketComment: models.TicketComment,
  TicketCounter: models.TicketCounter,

  // Plural (backward compatibility)
  Tenants: models.Tenant,
  Users: models.User,
  Roles: models.Role,
  MenuGroups: models.MenuGroup,
  RoleMenuPermissions: models.RoleMenuPermission,
  UserMenuPermissions: models.UserMenuPermission,
  AssetFinances: models.AssetFinance,
  Sessions: models.Session,
  Warehouses: models.Warehouse,
  StorageLocations: models.StorageLocation,
  Stocks: models.Stock,
  StockTransfers: models.StockTransfer,
  StockAdjustments: models.StockAdjustment,
  StockOpnames: models.StockOpname,
  CalibrationDevices: models.CalibrationDevice,
  CalibrationRecords: models.CalibrationRecord,
  TenantBackups: models.TenantBackup,
  TenantSettingses: models.TenantSettings,
  Certificates: models.Certificate,
  Vendors: models.Vendor,
  MaintenanceWorkOrders: models.MaintenanceWorkOrder,
  Notifications: models.Notification,
  Subscriptions: models.Subscription,
  Invoices: models.Invoice,
  AuditLogs: models.AuditLog,
  Attachments: models.Attachment,
  Webhooks: models.Webhook,
  WebhookDeliveries: models.WebhookDelivery,
  ApiKeys: models.ApiKey,
  Workflows: models.Workflow,
  WorkflowSteps: models.WorkflowStep,
  WorkflowInstances: models.WorkflowInstance,
  WorkflowActions: models.WorkflowAction,
  Posts: models.Post,
  Categories: models.Category,
  PostCategories: models.PostCategory,
  SupplierScorecard: models.SupplierScorecard,
  IotReading: models.IotReading,
  IotReadings: models.IotReading,
  ESignatureRecord: models.ESignatureRecord,
  ESignatureRecords: models.ESignatureRecord,
  // e-Signature workflow module (distinct from the certificate compliance log
  // above). These four were referenced by eSignature.service.js but never
  // existed, so every /esignature workflow route 500'd.
  TenantKey: models.TenantKey,
  TenantKeys: models.TenantKey,
  SignatureWorkflow: models.SignatureWorkflow,
  SignatureWorkflows: models.SignatureWorkflow,
  SignatureWorkflowStep: models.SignatureWorkflowStep,
  SignatureWorkflowSteps: models.SignatureWorkflowStep,
  SignatureRecord: models.SignatureRecord,
  SignatureRecords: models.SignatureRecord,
  // RAG knowledge base (ai.service retrieval/ingestion).
  DocumentChunk: models.DocumentChunk,
  DocumentChunks: models.DocumentChunk,
  ConsentRecord: models.ConsentRecord,
  ConsentRecords: models.ConsentRecord,
  DsarRequest: models.DsarRequest,
  DsarRequests: models.DsarRequest,
  DataRetentionPolicy: models.DataRetentionPolicy,
  DataRetentionPolicies: models.DataRetentionPolicy,
  TenantHierarchy: models.TenantHierarchy,
  TenantHierarchies: models.TenantHierarchy,
  CustomDomain: models.CustomDomain,
  CustomDomains: models.CustomDomain,
  UsageMetric: models.UsageMetric,
  UsageMetrics: models.UsageMetric,
  UsageAlert: models.UsageAlert,
  UsageAlerts: models.UsageAlert,
  PlanQuota: models.PlanQuota,
  PlanQuotas: models.PlanQuota,

  // The loader registers every model file into `models`, but only the keys
  // listed here are re-exported. These six were loaded and associated yet
  // never exported, so `require("../models").NonConformance` (and friends)
  // was undefined and every read threw
  // "Cannot read properties of undefined (reading 'findAndCountAll')" —
  // breaking GET /qms/nc, /qms/capa, /sop, /jobs and /risk at runtime.
  NonConformance: models.NonConformance,
  NonConformances: models.NonConformance,
  Capa: models.Capa,
  Capas: models.Capa,
  SopDocument: models.SopDocument,
  SopDocuments: models.SopDocument,
  SopTrainingAcknowledgment: models.SopTrainingAcknowledgment,
  SopTrainingAcknowledgments: models.SopTrainingAcknowledgment,
  BatchJob: models.BatchJob,
  BatchJobs: models.BatchJob,
  Risk: models.Risk,
  Risks: models.Risk,
});
