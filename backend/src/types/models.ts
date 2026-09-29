/**
 * The model map (P9-10, MEMORY/specs/P9-10-model-typing-pattern.md item 7).
 *
 * What `require("../models")` holds under each model name, as a type. It
 * lives HERE, not in the barrel, until the barrel converts in the same merge
 * as the last model batch: a type imported from the `.js` barrel is inferred
 * loosely under `allowJs`, and the typecheck would accept it silently.
 *
 * A CONVERTED model's entry is its factory's return type — the class itself,
 * with every declared attribute. An UNCONVERTED model's entry is
 * `ModelStatic<Model>`: honest (it is a Sequelize model), untyped in its
 * attributes, and replaced by the real entry in the batch that converts it.
 * Only models a converted file refers to are listed; each batch adds its own.
 */
import type { Model, ModelStatic } from "sequelize";
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

/** A model not yet converted: a Sequelize model whose attributes are not typed yet. */
type Unconverted = ModelStatic<Model>;

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
  // Referred to by a converted model, not converted yet
  Role: Unconverted;
  Tenant: Unconverted;
  User: Unconverted;
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
