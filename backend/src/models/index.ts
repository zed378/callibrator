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
//
// P9-10 (ADR-087 Amendment 11): converted from index.js in the same merge as the
// last model batch, with no change to what any consumer sees. `require("../models")`
// returns the same object — the shared Sequelize instance with every model, the
// `sequelize` / `Sequelize` / `Op` properties, and the singular and plural keys, in
// the same order — now typed: `db` from the barrel is a compile error (it has no
// such key), and every model key is its converted class. The full-barrel
// definition equality (ADR-092 check (b)) holds the whole object identical.

import { DataTypes, Op, Sequelize } from "sequelize";
// Use the shared Sequelize instance from config.
// This ensures all queries use the configured pool, SSL, timezone,
// retry logic, and logging settings instead of Sequelize defaults.
import { db } from "../config";
import type { Models } from "../types/models";
import { register as registerTenantScope } from "../utils/tenantScope.util";
import { installSecretRedaction } from "./secretAttributes";
import defineAccessRequest from "./accessRequest.model";
import defineWebauthnCredential from "./webauthnCredential.model";
import defineDeviceType from "./deviceType.model";
import defineInspectionItemDefinition from "./inspectionItemDefinition.model";
import defineInspectionTemplate from "./inspectionTemplate.model";
import defineInspectionTemplateVersion from "./inspectionTemplateVersion.model";
import defineInspectionTemplateItem from "./inspectionTemplateItem.model";
import defineInspectionTemplateProposal from "./inspectionTemplateProposal.model";
import defineUpstreamFileImport from "./upstreamFileImport.model";
import defineUpstreamSqlImport from "./upstreamSqlImport.model";
import defineApiKey from "./apiKey.model";
import defineAssetFinance from "./assetFinance.model";
import defineAttachment from "./attachment.model";
import defineAuditLog from "./auditLog.model";
import defineBatchJob from "./batchJob.model";
import defineCalibrationDevice from "./calibrationDevice.model";
import defineCalibrationRecord from "./calibrationRecord.model";
import defineCapa from "./capa.model";
import defineCategory from "./category.model";
import defineCertificate from "./certificate.model";
import defineConsentRecord from "./consentRecord.model";
import defineCustomDomain from "./customDomain.model";
import defineDocumentChunk from "./documentChunk.model";
import defineDsarRequest from "./dsarRequest.model";
import defineESignatureRecord from "./eSignatureRecord.model";
import defineInvoice from "./invoice.model";
import defineIotReading from "./iotReading.model";
import defineKanbanCard from "./kanbanCard.model";
import defineKanbanCardAssignee from "./kanbanCardAssignee.model";
import defineKanbanCardLabel from "./kanbanCardLabel.model";
import defineKanbanCardRelation from "./kanbanCardRelation.model";
import defineKanbanColumn from "./kanbanColumn.model";
import defineKanbanLabel from "./kanbanLabel.model";
import defineKanbanProject from "./kanbanProject.model";
import defineKanbanProjectMember from "./kanbanProjectMember.model";
import defineKanbanSprint from "./kanbanSprint.model";
import defineMaintenanceWorkOrder from "./maintenanceWorkOrder.model";
import defineMenuGroup from "./menuGroup.model";
import defineNonConformance from "./nonConformance.model";
import defineNotification from "./notification.model";
import defineNotificationState from "./notificationState.model";
import definePlanQuota from "./planQuota.model";
import definePost from "./post.model";
import definePostCategory from "./postCategory.model";
import defineRisk from "./risk.model";
import defineRole from "./role.model";
import defineRoleMenuPermission from "./roleMenuPermission.model";
import defineScimGroup from "./scimGroup.model";
import defineSession from "./session.model";
import defineSignatureRecord from "./signatureRecord.model";
import defineSignatureWorkflow from "./signatureWorkflow.model";
import defineSignatureWorkflowStep from "./signatureWorkflowStep.model";
import defineSopDocument from "./sopDocument.model";
import defineSopTrainingAcknowledgment from "./sopTrainingAcknowledgment.model";
import defineStock from "./stock.model";
import defineStockAdjustment from "./stockAdjustment.model";
import defineStockOpname from "./stockOpname.model";
import defineStockTransfer from "./stockTransfer.model";
import defineStorageLocation from "./storageLocation.model";
import defineSubscription from "./subscription.model";
import defineSupplierScorecard from "./supplierScorecard.model";
import defineTenant from "./tenant.model";
import defineTenantBackup from "./tenantBackup.model";
import defineTenantHierarchy from "./tenantHierarchy.model";
import defineTenantKey from "./tenantKey.model";
import defineTenantSettings from "./tenantSettings.model";
import defineTicket from "./ticket.model";
import defineTicketComment from "./ticketComment.model";
import defineTicketCounter from "./ticketCounter.model";
import defineUsageAlert from "./usageAlert.model";
import defineUsageMetric from "./usageMetric.model";
import defineUser from "./user.model";
import defineUserMenuPermission from "./userMenuPermission.model";
import defineVendor from "./vendor.model";
import defineWarehouse from "./warehouse.model";
import defineWebhook from "./webhook.model";
import defineWebhookDelivery from "./webhookDelivery.model";
import defineWorkflow from "./workflow.model";
import defineWorkflowAction from "./workflowAction.model";
import defineWorkflowInstance from "./workflowInstance.model";
import defineWorkflowStep from "./workflowStep.model";

// Static Loading: one explicit import per model file. Dynamic discovery
// (fs.readdirSync(__dirname) + require(path.join(...))) returns nothing / fails
// to resolve inside a single-file binary's virtual filesystem (@yao-pkg/pkg,
// bun --compile), so the whole set is listed statically to stay visible to the
// bundler's static analysis. Each factory is called in the same order as the
// .js called them, and each is registered under its model name, so the
// registry's key order is the same. Typed against `Models`: a model missing from
// the map, or a map entry without its model, fails the typecheck.
/**
 * Calls a model factory exactly as the .js loop did: `defineModel(db, DataTypes)`. The
 * class-shaped factories take one parameter and ignore the second, as before.
 */
const define = <T>(
  factory: (sequelize: Sequelize, dataTypes: typeof DataTypes) => T,
): T => factory(db, DataTypes);

const models: Models = {
  ApiKey: define(defineApiKey),
  AssetFinance: define(defineAssetFinance),
  Attachment: define(defineAttachment),
  AuditLog: define(defineAuditLog),
  BatchJob: define(defineBatchJob),
  CalibrationDevice: define(defineCalibrationDevice),
  CalibrationRecord: define(defineCalibrationRecord),
  Capa: define(defineCapa),
  Category: define(defineCategory),
  Certificate: define(defineCertificate),
  ConsentRecord: define(defineConsentRecord),
  CustomDomain: define(defineCustomDomain),
  DocumentChunk: define(defineDocumentChunk),
  DsarRequest: define(defineDsarRequest),
  ESignatureRecord: define(defineESignatureRecord),
  Invoice: define(defineInvoice),
  IotReading: define(defineIotReading),
  KanbanCard: define(defineKanbanCard),
  KanbanCardAssignee: define(defineKanbanCardAssignee),
  KanbanCardLabel: define(defineKanbanCardLabel),
  KanbanCardRelation: define(defineKanbanCardRelation),
  KanbanColumn: define(defineKanbanColumn),
  KanbanLabel: define(defineKanbanLabel),
  KanbanProject: define(defineKanbanProject),
  KanbanProjectMember: define(defineKanbanProjectMember),
  KanbanSprint: define(defineKanbanSprint),
  MaintenanceWorkOrder: define(defineMaintenanceWorkOrder),
  MenuGroup: define(defineMenuGroup),
  NonConformance: define(defineNonConformance),
  Notification: define(defineNotification),
  NotificationState: define(defineNotificationState),
  PlanQuota: define(definePlanQuota),
  Post: define(definePost),
  PostCategory: define(definePostCategory),
  Risk: define(defineRisk),
  Role: define(defineRole),
  RoleMenuPermission: define(defineRoleMenuPermission),
  ScimGroup: define(defineScimGroup),
  Session: define(defineSession),
  SignatureRecord: define(defineSignatureRecord),
  SignatureWorkflow: define(defineSignatureWorkflow),
  SignatureWorkflowStep: define(defineSignatureWorkflowStep),
  SopDocument: define(defineSopDocument),
  SopTrainingAcknowledgment: define(defineSopTrainingAcknowledgment),
  Stock: define(defineStock),
  StockAdjustment: define(defineStockAdjustment),
  StockOpname: define(defineStockOpname),
  StockTransfer: define(defineStockTransfer),
  StorageLocation: define(defineStorageLocation),
  Subscription: define(defineSubscription),
  SupplierScorecard: define(defineSupplierScorecard),
  Tenant: define(defineTenant),
  TenantBackup: define(defineTenantBackup),
  TenantHierarchy: define(defineTenantHierarchy),
  TenantKey: define(defineTenantKey),
  TenantSettings: define(defineTenantSettings),
  Ticket: define(defineTicket),
  TicketComment: define(defineTicketComment),
  TicketCounter: define(defineTicketCounter),
  UsageAlert: define(defineUsageAlert),
  UsageMetric: define(defineUsageMetric),
  User: define(defineUser),
  UserMenuPermission: define(defineUserMenuPermission),
  Vendor: define(defineVendor),
  Warehouse: define(defineWarehouse),
  Webhook: define(defineWebhook),
  WebhookDelivery: define(defineWebhookDelivery),
  Workflow: define(defineWorkflow),
  WorkflowAction: define(defineWorkflowAction),
  WorkflowInstance: define(defineWorkflowInstance),
  WorkflowStep: define(defineWorkflowStep),
  // P10-05 (ADR-098 §6): last, so every existing model keeps its registration order.
  AccessRequest: define(defineAccessRequest),
  // ADR-108 Amendment 1: several passkeys per user.
  WebauthnCredential: define(defineWebauthnCredential),
  // P20-01 / P20-03 (ADR-125): the global inspection catalogue and the tenant-scoped proposals —
  // last, so every existing model keeps its registration order.
  DeviceType: define(defineDeviceType),
  InspectionItemDefinition: define(defineInspectionItemDefinition),
  InspectionTemplate: define(defineInspectionTemplate),
  InspectionTemplateVersion: define(defineInspectionTemplateVersion),
  InspectionTemplateItem: define(defineInspectionTemplateItem),
  InspectionTemplateProposal: define(defineInspectionTemplateProposal),
  // The rsync image import (upstream adoption): a platform row, not tenant-scoped — last, so every
  // existing model keeps its registration order.
  UpstreamFileImport: define(defineUpstreamFileImport),
  // The SQL-dump import (P24-06): a platform row, not tenant-scoped — last, for the same reason.
  UpstreamSqlImport: define(defineUpstreamSqlImport),
};

// Association Mapping: Iterate models, execute associate method if exists.
// Object.keys over an object literal typed `Models` yields exactly its keys, in the
// order the factories registered them (the assertion states only that).
// `"associate" in model`: a model either has the function or does not have the key — never an
// undefined `associate` — so this is the .js truthiness check.
(Object.keys(models) as (keyof Models)[]).forEach((modelName) => {
  const model = models[modelName];
  if ("associate" in model) {
    model.associate(models);
  }
});

// A-331 (ADR-100 Amendment 4): credential attributes never serialise — each
// listed model's toJSON() drops them (models/secretAttributes.ts).
installSecretRedaction(models as unknown as Parameters<typeof installSecretRedaction>[0]);

// Global Export: Export collective models object for dependency injection.
// Object.assign sets the three properties in this order with ordinary assignment,
// exactly as `db.sequelize = db; db.Sequelize = Sequelize; db.Op = Op;` did.
const database = Object.assign(db, { sequelize: db, Sequelize, Op });

// ============================================================================
// APPLICATION-LEVEL RLS (ROW-LEVEL SECURITY) / TENANT ISOLATION HOOKS
// ============================================================================
// These hooks intercept every query and automatically inject the tenant ID
// from the AsyncLocalStorage context (set by auth middleware).
// This acts as a defense-in-depth layer across the entire ORM.

// Isolation now lives in utils/tenantScope.util.ts — unit-tested and
// DENY BY DEFAULT. The previous inline hooks returned early whenever the
// request had no tenantId, i.e. applied NO filter, so an authenticated
// principal without a tenant read every tenant's rows (the same fail-open
// hole the Postgres RLS policy had via its `app.current_tenant = ''` branch).
// tenantScope resolves that case to a predicate that cannot match.
// (The module is imported above; importing it has no effect of its own — it
// only defines functions — so registering HERE, after every model is defined
// and associated, keeps the hooks' registration exactly where it was.)
// tenantScope types the Sequelize INTERNALS its hooks use (`_scope`, `_conformIncludes`, the
// aggregate path); the public typings omit them, so the real instance is passed as that view.
registerTenantScope(
  database as unknown as Parameters<typeof registerTenantScope>[0],
);

// Postgres ROW LEVEL SECURITY has been removed. It only worked on Postgres
// (blocking multi-engine support) and its policy matched every row when
// app.current_tenant was empty. Isolation is enforced above by
// utils/tenantScope.util.ts, deny-by-default, on every dialect.

// Backward compatibility: export both singular and plural names
const barrel = Object.assign(database, {
  // Singular
  Tenant: models.Tenant,
  User: models.User,
  Role: models.Role,
  MenuGroup: models.MenuGroup,
  RoleMenuPermission: models.RoleMenuPermission,
  ScimGroup: models.ScimGroup,
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
  // P10-05 (ADR-098 §6): the platform's access-request queue (not tenant-scoped).
  AccessRequest: models.AccessRequest,
  AccessRequests: models.AccessRequest,
  // ADR-108 Amendment 1: a user's passkeys (a child of the user, not tenant-scoped by column).
  WebauthnCredential: models.WebauthnCredential,
  WebauthnCredentials: models.WebauthnCredential,
  // P20-01 / P20-03 (ADR-125): the global inspection catalogue (no tenant column — the hooks
  // leave it alone; writes are the platform operator's) and the tenant-scoped proposals to it.
  DeviceType: models.DeviceType,
  DeviceTypes: models.DeviceType,
  InspectionItemDefinition: models.InspectionItemDefinition,
  InspectionItemDefinitions: models.InspectionItemDefinition,
  InspectionTemplate: models.InspectionTemplate,
  InspectionTemplates: models.InspectionTemplate,
  InspectionTemplateVersion: models.InspectionTemplateVersion,
  InspectionTemplateVersions: models.InspectionTemplateVersion,
  InspectionTemplateItem: models.InspectionTemplateItem,
  InspectionTemplateItems: models.InspectionTemplateItem,
  InspectionTemplateProposal: models.InspectionTemplateProposal,
  InspectionTemplateProposals: models.InspectionTemplateProposal,
  // The rsync image import: a platform row (targetTenantId, not tenantId — the hooks leave it alone).
  UpstreamFileImport: models.UpstreamFileImport,
  UpstreamFileImports: models.UpstreamFileImport,
  // The SQL-dump import: a platform row (notifyTenantId, not tenantId — the hooks leave it alone).
  UpstreamSqlImport: models.UpstreamSqlImport,
  UpstreamSqlImports: models.UpstreamSqlImport,
});

// A pure `export =` module, like every model file: no other export may sit beside it (a
// named type export here compiles, under tsx/esbuild, to a reference to an undefined
// module binding). The barrel's type is `ModelsBarrel` in src/types/models.ts.
export = barrel;
