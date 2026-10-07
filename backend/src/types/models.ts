/**
 * The model map (P9-10, MEMORY/specs/P9-10-model-typing-pattern.md item 7; ADR-087
 * Amendments 7–11).
 *
 * Every one of the 71 models, as `require("../models")` holds it: each entry is
 * its factory's return type — the class, with every declared attribute. The
 * barrel (`models/index.ts`) is checked against this map, so the two cannot drift.
 * Model files take their association types from here (`ModelInstance<"X">`), not
 * from the barrel, which would be a cycle.
 */
import type defineAccessRequest from "../models/accessRequest.model";
import type defineWebauthnCredential from "../models/webauthnCredential.model";
import type defineDeviceType from "../models/deviceType.model";
import type defineUpstreamFileImport from "../models/upstreamFileImport.model";
import type defineUpstreamSqlImport from "../models/upstreamSqlImport.model";
import type defineInspectionItemDefinition from "../models/inspectionItemDefinition.model";
import type defineInspectionTemplate from "../models/inspectionTemplate.model";
import type defineInspectionTemplateVersion from "../models/inspectionTemplateVersion.model";
import type defineInspectionTemplateItem from "../models/inspectionTemplateItem.model";
import type defineInspectionTemplateProposal from "../models/inspectionTemplateProposal.model";
import type defineKanbanCard from "../models/kanbanCard.model";
import type defineKanbanCardAssignee from "../models/kanbanCardAssignee.model";
import type defineKanbanCardLabel from "../models/kanbanCardLabel.model";
import type defineKanbanCardRelation from "../models/kanbanCardRelation.model";
import type defineKanbanColumn from "../models/kanbanColumn.model";
import type defineKanbanLabel from "../models/kanbanLabel.model";
import type defineKanbanProject from "../models/kanbanProject.model";
import type defineKanbanProjectMember from "../models/kanbanProjectMember.model";
import type defineKanbanSprint from "../models/kanbanSprint.model";
import type defineStock from "../models/stock.model";
import type defineStockAdjustment from "../models/stockAdjustment.model";
import type defineStockOpname from "../models/stockOpname.model";
import type defineStockTransfer from "../models/stockTransfer.model";
import type defineStorageLocation from "../models/storageLocation.model";
import type defineWarehouse from "../models/warehouse.model";
import type defineCapa from "../models/capa.model";
import type defineNonConformance from "../models/nonConformance.model";
import type defineRisk from "../models/risk.model";
import type defineSopDocument from "../models/sopDocument.model";
import type defineSopTrainingAcknowledgment from "../models/sopTrainingAcknowledgment.model";
import type defineSupplierScorecard from "../models/supplierScorecard.model";
import type defineVendor from "../models/vendor.model";
import type defineWorkflow from "../models/workflow.model";
import type defineWorkflowAction from "../models/workflowAction.model";
import type defineWorkflowInstance from "../models/workflowInstance.model";
import type defineWorkflowStep from "../models/workflowStep.model";
import type defineAssetFinance from "../models/assetFinance.model";
import type defineBatchJob from "../models/batchJob.model";
import type defineInvoice from "../models/invoice.model";
import type defineMaintenanceWorkOrder from "../models/maintenanceWorkOrder.model";
import type defineNotification from "../models/notification.model";
import type defineNotificationState from "../models/notificationState.model";
import type definePlanQuota from "../models/planQuota.model";
import type defineSubscription from "../models/subscription.model";
import type defineUsageAlert from "../models/usageAlert.model";
import type defineUsageMetric from "../models/usageMetric.model";
import type defineAttachment from "../models/attachment.model";
import type defineCalibrationDevice from "../models/calibrationDevice.model";
import type defineCalibrationRecord from "../models/calibrationRecord.model";
import type defineCertificate from "../models/certificate.model";
import type defineDocumentChunk from "../models/documentChunk.model";
import type defineIotReading from "../models/iotReading.model";
import type defineESignatureRecord from "../models/eSignatureRecord.model";
import type defineSignatureRecord from "../models/signatureRecord.model";
import type defineSignatureWorkflow from "../models/signatureWorkflow.model";
import type defineSignatureWorkflowStep from "../models/signatureWorkflowStep.model";
import type defineCategory from "../models/category.model";
import type defineConsentRecord from "../models/consentRecord.model";
import type defineDsarRequest from "../models/dsarRequest.model";
import type definePost from "../models/post.model";
import type definePostCategory from "../models/postCategory.model";
import type defineTicket from "../models/ticket.model";
import type defineTicketComment from "../models/ticketComment.model";
import type defineTicketCounter from "../models/ticketCounter.model";
import type defineCustomDomain from "../models/customDomain.model";
import type defineScimGroup from "../models/scimGroup.model";
import type defineTenantBackup from "../models/tenantBackup.model";
import type defineWebhook from "../models/webhook.model";
import type defineWebhookDelivery from "../models/webhookDelivery.model";
import type modelsBarrel from "../models";
import type defineApiKey from "../models/apiKey.model";
import type defineAuditLog from "../models/auditLog.model";
import type defineMenuGroup from "../models/menuGroup.model";
import type defineRole from "../models/role.model";
import type defineRoleMenuPermission from "../models/roleMenuPermission.model";
import type defineSession from "../models/session.model";
import type defineTenant from "../models/tenant.model";
import type defineTenantHierarchy from "../models/tenantHierarchy.model";
import type defineTenantKey from "../models/tenantKey.model";
import type defineTenantSettings from "../models/tenantSettings.model";
import type defineUser from "../models/user.model";
import type defineUserMenuPermission from "../models/userMenuPermission.model";

export interface Models {
  // Batch 1 — Kanban (ADR-087 Amendment 7)
  KanbanCard: ReturnType<typeof defineKanbanCard>;
  KanbanCardAssignee: ReturnType<typeof defineKanbanCardAssignee>;
  KanbanCardLabel: ReturnType<typeof defineKanbanCardLabel>;
  KanbanCardRelation: ReturnType<typeof defineKanbanCardRelation>;
  KanbanColumn: ReturnType<typeof defineKanbanColumn>;
  KanbanLabel: ReturnType<typeof defineKanbanLabel>;
  KanbanProject: ReturnType<typeof defineKanbanProject>;
  KanbanProjectMember: ReturnType<typeof defineKanbanProjectMember>;
  KanbanSprint: ReturnType<typeof defineKanbanSprint>;
  // Batch 2 — inventory (ADR-087 Amendment 7)
  Stock: ReturnType<typeof defineStock>;
  StockAdjustment: ReturnType<typeof defineStockAdjustment>;
  StockOpname: ReturnType<typeof defineStockOpname>;
  StockTransfer: ReturnType<typeof defineStockTransfer>;
  StorageLocation: ReturnType<typeof defineStorageLocation>;
  Warehouse: ReturnType<typeof defineWarehouse>;
  // Batch 3 — workflow, QMS, suppliers (ADR-087 Amendment 8)
  Capa: ReturnType<typeof defineCapa>;
  NonConformance: ReturnType<typeof defineNonConformance>;
  Risk: ReturnType<typeof defineRisk>;
  SopDocument: ReturnType<typeof defineSopDocument>;
  SopTrainingAcknowledgment: ReturnType<typeof defineSopTrainingAcknowledgment>;
  SupplierScorecard: ReturnType<typeof defineSupplierScorecard>;
  Vendor: ReturnType<typeof defineVendor>;
  Workflow: ReturnType<typeof defineWorkflow>;
  WorkflowAction: ReturnType<typeof defineWorkflowAction>;
  WorkflowInstance: ReturnType<typeof defineWorkflowInstance>;
  WorkflowStep: ReturnType<typeof defineWorkflowStep>;
  // Batch 4 — billing, usage, notifications, operations (ADR-087 Amendment 8)
  AssetFinance: ReturnType<typeof defineAssetFinance>;
  BatchJob: ReturnType<typeof defineBatchJob>;
  Invoice: ReturnType<typeof defineInvoice>;
  MaintenanceWorkOrder: ReturnType<typeof defineMaintenanceWorkOrder>;
  Notification: ReturnType<typeof defineNotification>;
  NotificationState: ReturnType<typeof defineNotificationState>;
  PlanQuota: ReturnType<typeof definePlanQuota>;
  Subscription: ReturnType<typeof defineSubscription>;
  UsageAlert: ReturnType<typeof defineUsageAlert>;
  UsageMetric: ReturnType<typeof defineUsageMetric>;
  // Batch 5 — calibration and certificates (ADR-087 Amendment 9)
  Attachment: ReturnType<typeof defineAttachment>;
  CalibrationDevice: ReturnType<typeof defineCalibrationDevice>;
  CalibrationRecord: ReturnType<typeof defineCalibrationRecord>;
  Certificate: ReturnType<typeof defineCertificate>;
  DocumentChunk: ReturnType<typeof defineDocumentChunk>;
  IotReading: ReturnType<typeof defineIotReading>;
  // Batch 6 — signatures (ADR-087 Amendment 9)
  ESignatureRecord: ReturnType<typeof defineESignatureRecord>;
  SignatureRecord: ReturnType<typeof defineSignatureRecord>;
  SignatureWorkflow: ReturnType<typeof defineSignatureWorkflow>;
  SignatureWorkflowStep: ReturnType<typeof defineSignatureWorkflowStep>;
  // Batch 7 — content, tickets, GDPR (ADR-087 Amendment 10)
  Category: ReturnType<typeof defineCategory>;
  ConsentRecord: ReturnType<typeof defineConsentRecord>;
  DsarRequest: ReturnType<typeof defineDsarRequest>;
  Post: ReturnType<typeof definePost>;
  PostCategory: ReturnType<typeof definePostCategory>;
  Ticket: ReturnType<typeof defineTicket>;
  TicketComment: ReturnType<typeof defineTicketComment>;
  TicketCounter: ReturnType<typeof defineTicketCounter>;
  // Batch 8 — platform (ADR-087 Amendment 10)
  CustomDomain: ReturnType<typeof defineCustomDomain>;
  ScimGroup: ReturnType<typeof defineScimGroup>;
  TenantBackup: ReturnType<typeof defineTenantBackup>;
  Webhook: ReturnType<typeof defineWebhook>;
  WebhookDelivery: ReturnType<typeof defineWebhookDelivery>;
  // Batch 9 — tenant-isolation-critical (ADR-087 Amendment 11)
  ApiKey: ReturnType<typeof defineApiKey>;
  AuditLog: ReturnType<typeof defineAuditLog>;
  MenuGroup: ReturnType<typeof defineMenuGroup>;
  Role: ReturnType<typeof defineRole>;
  RoleMenuPermission: ReturnType<typeof defineRoleMenuPermission>;
  Session: ReturnType<typeof defineSession>;
  Tenant: ReturnType<typeof defineTenant>;
  TenantHierarchy: ReturnType<typeof defineTenantHierarchy>;
  TenantKey: ReturnType<typeof defineTenantKey>;
  TenantSettings: ReturnType<typeof defineTenantSettings>;
  User: ReturnType<typeof defineUser>;
  UserMenuPermission: ReturnType<typeof defineUserMenuPermission>;
  // P10-05 (ADR-098 §6) — born TypeScript: the access-request queue
  AccessRequest: ReturnType<typeof defineAccessRequest>;
  // ADR-108 Amendment 1 — born TypeScript: a user's passkeys
  WebauthnCredential: ReturnType<typeof defineWebauthnCredential>;
  // P20-01 / P20-03 (ADR-125) — born TypeScript: the global inspection catalogue, and the
  // tenant-scoped proposals to it
  DeviceType: ReturnType<typeof defineDeviceType>;
  InspectionItemDefinition: ReturnType<typeof defineInspectionItemDefinition>;
  InspectionTemplate: ReturnType<typeof defineInspectionTemplate>;
  InspectionTemplateVersion: ReturnType<typeof defineInspectionTemplateVersion>;
  InspectionTemplateItem: ReturnType<typeof defineInspectionTemplateItem>;
  InspectionTemplateProposal: ReturnType<typeof defineInspectionTemplateProposal>;
  // The rsync image import — born TypeScript: a platform row
  UpstreamFileImport: ReturnType<typeof defineUpstreamFileImport>;
  // The SQL-dump import (P24-06) — born TypeScript: a platform row
  UpstreamSqlImport: ReturnType<typeof defineUpstreamSqlImport>;
}

/** An instance of the model registered under `K`. */
export type ModelInstance<K extends keyof Models> = InstanceType<Models[K]>;

declare const defaultScopedBrand: unique symbol;

/**
 * D-12 phantom brand (spec item 6): a converted model whose defaultScope
 * carries a `where` declares `readonly defaultScoped: DefaultScoped` among its
 * statics. A bare include of such a model is an INNER JOIN. The brand emits
 * nothing and nothing may read it at run time; includeRequired.d12 holds the
 * branded set EQUAL to the runtime default-scoped set.
 */
export interface DefaultScoped {
  readonly [defaultScopedBrand]: true;
}

/** What `require("../models")` returns: the shared Sequelize instance with every model and alias. */
export type ModelsBarrel = typeof modelsBarrel;
