/**
 * Configurable approval workflows: their definitions (steps by role), the
 * instances started on a record, and the decisions recorded on them. A
 * Certificate decision is a Part 11 electronic signature (A-182, ADR-101).
 *
 * P9-16 (ADR-087, Stage C): converted from workflow.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned:
 * an instance of the `WorkflowService` class (its methods on the prototype,
 * non-enumerable, in the original order) with `RESOURCE_MENUS` and
 * `CERTIFICATE_APPROVAL_NEEDS_REAUTH` added to it as own properties, in that
 * order. Methods call each other through `this`, as the `.js` did, so a spy on
 * the exported instance still intercepts them. The models (and `sequelize`),
 * `AppError`, `Transaction`, `auditService` and the two audit helpers are
 * captured once at load, as the `.js` destructured them.
 *
 * Lazy requires stay lazy: `dynamicAccess.middleware` (it loads the role
 * services, which must not load first) and `certificate.service` (on a
 * Certificate decision only) are still required at call time. Both are still
 * JavaScript; the members this module calls are typed here, from their code.
 */
import { Transaction as LoadedTransaction, type CreationAttributes } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const {
  Workflow,
  WorkflowStep,
  WorkflowInstance,
  WorkflowAction,
  StockTransfer,
  MaintenanceWorkOrder,
  Role,
  sequelize,
} = models;
// NOTE: utils/appError exports an object — AppError must be destructured.
// (`const AppError = require(...)` made `new AppError(...)` throw
// "AppError is not a constructor".)
const AppError = LoadedAppError;
const Transaction = LoadedTransaction;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type WorkflowRow = ModelInstance<"Workflow">;
type StepRow = ModelInstance<"WorkflowStep">;
type InstanceRow = ModelInstance<"WorkflowInstance">;
type SqlTransaction = InstanceType<typeof LoadedTransaction>;

// A-145 — `changes.operation` of a workflow action's audit row.
const ACTION_OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  APPROVED: "WORKFLOW_APPROVE",
  REJECTED: "WORKFLOW_REJECT",
});

/**
 * A-183 — the menu whose `write` grant a decision on each resource type
 * requires: the same grant as the record's own approval route
 * (POST /certificates/:id/approve is `certificate` approve; stock transfers
 * are `warehouse` write; work orders `maintenance` update).
 */
const RESOURCE_MENUS: Readonly<Record<string, string>> = Object.freeze({
  Certificate: "certificate",
  StockTransfer: "warehouse",
  MaintenanceWorkOrder: "maintenance",
});

/** A-182 — a Certificate approval without the re-authentication fields. */
const CERTIFICATE_APPROVAL_NEEDS_REAUTH =
  "Approving a certificate is an electronic signature (21 CFR Part 11): re-authenticate by " +
  'sending authMethod ("password" or "mfa"), authPayload (your password or a current MFA code) ' +
  'and meaning (for example "Reviewed and approved").';

/** The principal a decision is made by (req.user). */
interface WorkflowUser {
  id: UserId;
  roleId?: string | null;
  role?: unknown;
}

/** dynamicAccess.middleware (still JavaScript): the one member this module calls. */
interface DynamicAccessGate {
  principalHasMenuPermission: (principal: unknown, menuName: unknown, permissionType: string) => Promise<boolean>;
}

/** The re-authentication a Certificate approval carries, and the request it came from. */
interface AuthOptions {
  authMethod: unknown;
  authPayload: unknown;
  meaning: unknown;
  ipAddress: unknown;
  userAgent: unknown;
}

/** certificate.service (still JavaScript, P9-14): the members a Certificate decision calls. */
interface CertificateWorkflowHooks {
  lockForWorkflowDecision: (t: SqlTransaction, tenantId: TenantId, certificateId: string, decision: "approve" | "reject") => Promise<unknown>;
  refuseSelfApprovalInWorkflow: (t: SqlTransaction, tenantId: TenantId, certificateId: string, approverId: UserId) => Promise<unknown>;
  verifyWorkflowApprovalAuth: (userId: UserId, authOptions: AuthOptions, context: Record<string, unknown>) => Promise<unknown>;
  applyWorkflowRejection: (t: SqlTransaction, certificate: unknown, details: Record<string, unknown>) => Promise<unknown>;
  applyWorkflowApproval: (t: SqlTransaction, certificate: unknown, details: Record<string, unknown>) => Promise<unknown>;
}

/** Lazy: the gate's module loads the role services, which must not load first. */
const principalHasMenuPermission = (...args: Parameters<DynamicAccessGate["principalHasMenuPermission"]>): Promise<boolean> =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded at call time (see the file header)
  (require("../middlewares/dynamicAccess.middleware") as DynamicAccessGate).principalHasMenuPermission(...args);

/** certificate.service, required when a Certificate decision needs it (never at this module's load). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: loaded at call time (see the file header)
const loadCertificateService = (): CertificateWorkflowHooks => require("./certificate.service") as CertificateWorkflowHooks;

/** A step as a workflow definition carries it (the validator shaped it). */
interface StepInput {
  stepOrder: number;
  roleId: string;
  requiredApprovals?: number | null;
}

/** A workflow definition as the controller passes it (validated; a JavaScript caller may pass anything). */
interface WorkflowInput {
  name?: string;
  resourceType?: string;
  isActive?: boolean;
  steps?: StepInput[] | null;
}

/** A decision as the controller passes it. */
interface ActionData {
  action: "APPROVED" | "REJECTED";
  comments?: string | null;
  authMethod?: unknown;
  authPayload?: unknown;
  meaning?: unknown;
  ipAddress?: unknown;
  userAgent?: unknown;
}

/** A step as an audit row records it. */
interface StepRecord {
  stepOrder: number;
  roleId: string;
  requiredApprovals: number | null | undefined;
}

/** A PENDING instance with the workflow deciding on it (findPendingInstance's include is required). */
type PendingInstance = InstanceRow & { workflow: WorkflowRow };

class WorkflowService {
  async getWorkflows(tenantId: TenantId): Promise<WorkflowRow[]> {
    return Workflow.findAll({
      where: { tenantId },
      include: [
        {
          model: WorkflowStep,
          as: "steps",
          // LEFT JOIN (A-90): Role's defaultScope would make this INNER, and a
          // step whose role was soft-deleted would silently drop out of the
          // workflow's step list.
          include: [{ model: Role, as: "role", attributes: ["id", "name"], required: false }],
        },
      ],
      order: [
        ["createdAt", "DESC"],
        [{ model: WorkflowStep, as: "steps" }, "stepOrder", "ASC"],
      ],
    });
  }

  async getWorkflowById(tenantId: TenantId, id: string): Promise<WorkflowRow> {
    const workflow = await Workflow.findOne({
      where: { id, tenantId },
      include: [
        {
          model: WorkflowStep,
          as: "steps",
          // LEFT JOIN (A-90): Role's defaultScope would make this INNER, and a
          // step whose role was soft-deleted would silently drop out of the
          // workflow's step list.
          include: [{ model: Role, as: "role", attributes: ["id", "name"], required: false }],
        },
      ],
      order: [[{ model: WorkflowStep, as: "steps" }, "stepOrder", "ASC"]],
    });

    if (!workflow) {throw new AppError(404, "Workflow not found");}
    return workflow;
  }

  /**
   * A-204 — the audit row of a workflow-definition change, written in the
   * change's transaction (logAction re-throws inside one, so a failed row
   * rolls the change back). A workflow definition decides who approves a
   * Part 11 record; changing it unattributed was the gap.
   */
  async _auditDefinition(
    t: SqlTransaction,
    tenantId: TenantId,
    actor: AuditActorInput,
    action: AuditAction,
    workflowId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await auditService.logAction(
      {
        tenantId,
        // A-282 (ADR-100): a key is system:api-key, its id in changes.
        ...auditEntryActor(actor),
        action,
        resourceType: "Workflow",
        resourceId: workflowId,
        changes: { ...changes, ...actorChanges(actor) },
      },
      { transaction: t },
    );
  }

  /**
   * A-204 — the step definition, as recorded in an audit row. Every caller
   * passes steps whose requiredApprovals is set (defaulted on write; NOT NULL
   * in the table).
   */
  _stepsOf(steps: readonly StepRecord[]): StepRecord[] {
    return steps.map((s) => ({
      stepOrder: s.stepOrder,
      roleId: s.roleId,
      requiredApprovals: s.requiredApprovals,
    }));
  }

  /**
   * A-204 — lock a workflow for a definition change, in the change's
   * transaction: 404 when it is not in the tenant.
   */
  async _lockDefinition(t: SqlTransaction, tenantId: TenantId, id: string): Promise<WorkflowRow> {
    // No include: FOR UPDATE with a LEFT JOIN is refused by PostgreSQL on
    // the nullable side, and a hasMany include puts the root in a subquery.
    const workflow = await Workflow.findOne({
      where: { id, tenantId },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!workflow) {throw new AppError(404, "Workflow not found");}
    return workflow;
  }

  async createWorkflow(tenantId: TenantId, data: WorkflowInput, actor: AuditActorInput = {}): Promise<WorkflowRow> {
    const t = await sequelize.transaction();
    try {
      // Check if a workflow for this resourceType already exists (only one active per resource)
      if (data.isActive !== false) {
        await Workflow.update(
          { isActive: false },
          { where: { tenantId, resourceType: data.resourceType as WorkflowRow["resourceType"], isActive: true }, transaction: t },
        );
      }

      const workflowValues = {
        tenantId,
        name: data.name,
        resourceType: data.resourceType,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: only undefined defaults (a null is kept) (ADR-038 rule 3)
        isActive: data.isActive !== undefined ? data.isActive : true,
      };
      const workflow = await Workflow.create(workflowValues as CreationAttributes<WorkflowRow>, { transaction: t });

      const steps = (data.steps as StepInput[]).map((step) => ({
        workflowId: workflow.id,
        stepOrder: step.stepOrder,
        roleId: step.roleId,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: 0 and null default to 1 (ADR-038 rule 3)
        requiredApprovals: step.requiredApprovals || 1,
      }));

      await WorkflowStep.bulkCreate(steps, { transaction: t });
      await this._auditDefinition(t, tenantId, actor, "CREATE", workflow.id, {
        before: {},
        after: {
          name: workflow.name,
          resourceType: workflow.resourceType,
          isActive: workflow.isActive,
          steps: this._stepsOf(steps),
        },
      });
      await t.commit();
      // eslint-disable-next-line @typescript-eslint/return-await -- as built: returned un-awaited, so a failed re-read is not caught (and rolled back) below (ADR-038 rule 3)
      return this.getWorkflowById(tenantId, workflow.id);
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  /**
   * Update a workflow's name, active flag or steps.
   *
   * A-204 — read and locked inside the transaction, and audited in it.
   * Replacing the steps of a workflow that has ever been started is refused
   * (409): its instances' approvals (workflow_actions) reference those steps
   * and would be deleted with them (ON DELETE CASCADE), and a pending
   * instance would be left on a step that no longer exists. Deactivate it and
   * create a new workflow instead.
   */
  async updateWorkflow(tenantId: TenantId, id: string, data: WorkflowInput, actor: AuditActorInput = {}): Promise<WorkflowRow> {
    const t = await sequelize.transaction();

    try {
      const workflow = await this._lockDefinition(t, tenantId, id);
      const before: Record<string, unknown> = { name: workflow.name, isActive: workflow.isActive };
      const replaceSteps = Boolean(data.steps && data.steps.length > 0);

      if (replaceSteps) {
        const instances = await WorkflowInstance.count({
          where: { workflowId: workflow.id },
          paranoid: false,
          transaction: t,
        });
        if (instances > 0) {
          throw new AppError(
            409,
            `This workflow has been started ${String(instances)} time(s); its steps are the record its approvals ` +
              "were made against and cannot be replaced. Deactivate it and create a new workflow instead.",
          );
        }
      }

      if (data.name !== undefined) {workflow.name = data.name;}

      if (data.isActive !== undefined && data.isActive !== workflow.isActive) {
        if (data.isActive) {
          await Workflow.update(
            { isActive: false },
            { where: { tenantId, resourceType: workflow.resourceType, isActive: true }, transaction: t },
          );
        }
        workflow.isActive = data.isActive;
      }

      await workflow.save({ transaction: t });

      const after: Record<string, unknown> = { name: workflow.name, isActive: workflow.isActive };
      if (replaceSteps) {
        const current: StepRow[] = await WorkflowStep.findAll({
          where: { workflowId: workflow.id },
          order: [["stepOrder", "ASC"]],
          transaction: t,
        });
        before["steps"] = this._stepsOf(current);
        await WorkflowStep.destroy({ where: { workflowId: workflow.id }, transaction: t });
        const steps = (data.steps as StepInput[]).map((step) => ({
          workflowId: workflow.id,
          stepOrder: step.stepOrder,
          roleId: step.roleId,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: 0 and null default to 1 (ADR-038 rule 3)
          requiredApprovals: step.requiredApprovals || 1,
        }));
        await WorkflowStep.bulkCreate(steps, { transaction: t });
        after["steps"] = this._stepsOf(steps);
      }

      await this._auditDefinition(t, tenantId, actor, "UPDATE", workflow.id, { before, after });
      await t.commit();
      // eslint-disable-next-line @typescript-eslint/return-await -- as built: returned un-awaited, so a failed re-read is not caught (and rolled back) below (ADR-038 rule 3)
      return this.getWorkflowById(tenantId, id);
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  /**
   * Soft-delete a workflow.
   *
   * A-204 — refused (409) while any of its instances is PENDING: a pending
   * instance reads its steps through the workflow, and with the workflow
   * deleted it could be neither approved nor listed. Audited in the delete's
   * transaction.
   */
  async deleteWorkflow(tenantId: TenantId, id: string, actor: AuditActorInput = {}): Promise<void> {
    const t = await sequelize.transaction();
    try {
      const workflow = await this._lockDefinition(t, tenantId, id);
      const pending = await WorkflowInstance.count({
        where: { workflowId: workflow.id, status: "PENDING" },
        transaction: t,
      });
      if (pending > 0) {
        throw new AppError(
          409,
          `This workflow has ${String(pending)} pending approval(s) and cannot be deleted while they are open. ` +
            "Deactivate it instead: pending approvals finish, and no new ones start.",
        );
      }
      await workflow.destroy({ transaction: t });
      await this._auditDefinition(t, tenantId, actor, "DELETE", workflow.id, {
        before: { name: workflow.name, resourceType: workflow.resourceType, isActive: workflow.isActive },
        after: { deleted: true },
      });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  /**
   * Initializes a workflow instance for a given resource.
   * If no active workflow is found for the resource type, returns null (fallback to hardcoded).
   */
  async startWorkflow(
    tenantId: TenantId,
    resourceType: string,
    resourceId: string,
    transaction: SqlTransaction | null = null,
  ): Promise<InstanceRow | null> {
    // Fail-soft: this hook intercepts domain operations (stock transfers,
    // certificates). If the workflow engine cannot even determine whether a
    // workflow exists (model unavailable, lookup error), the domain operation
    // must not be aborted — behave as "no workflow configured".
    let workflow: WorkflowRow | null;
    try {
      workflow = await Workflow.findOne({
        where: { tenantId, resourceType: resourceType as WorkflowRow["resourceType"], isActive: true },
        include: [{ model: WorkflowStep, as: "steps" }],
        order: [[{ model: WorkflowStep, as: "steps" }, "stepOrder", "ASC"]],
        transaction,
      });
    } catch (err) {
      // A-190 — inside a caller's transaction the lookup is part of an atomic
      // create (createCertificate): on PostgreSQL the failed statement has
      // already aborted that transaction, and "no workflow" would be a guess.
      // The error goes to the caller, which rolls the whole create back.
      if (transaction) {
        throw err;
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the logger is required here, inside the fail-soft path
        const { logger } = require("../middlewares/activityLog.middleware") as { logger: { warn: (message: string) => unknown } };
        logger.warn(`Workflow lookup failed (${resourceType}): ${String((err as { message?: unknown }).message)}`);
      } catch {
        /* logging is best-effort */
      }
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the .js expression, kept (ADR-038 rule 3)
    if (!workflow || !workflow.steps || workflow.steps.length === 0) {
      return null;
    }

    const instance = await WorkflowInstance.create(
      {
        tenantId,
        workflowId: workflow.id,
        resourceId,
        status: "PENDING",
        currentStepOrder: (workflow.steps[0] as StepRow).stepOrder,
      },
      { transaction },
    );

    return instance;
  }

  /**
   * A-202 / A-203 — the PENDING workflow instance deciding on a resource, or
   * null. While one exists the resource is decided THROUGH it: a direct
   * approval of the certificate, or a manual move of the stock transfer, is
   * refused (409) by its service.
   *
   * @param tenantId
   * @param resourceType - "Certificate" | "StockTransfer" | ...
   * @param resourceId
   * @param transaction
   * @returns the instance, with `workflow` (id, name)
   */
  async findPendingInstance(
    tenantId: TenantId,
    resourceType: string,
    resourceId: string,
    transaction: SqlTransaction | null = null,
  ): Promise<PendingInstance | null> {
    return WorkflowInstance.findOne({
      where: { tenantId, resourceId, status: "PENDING" },
      include: [
        {
          model: Workflow,
          as: "workflow",
          attributes: ["id", "name", "resourceType"],
          // required: true on purpose — the resource type IS the filter (a
          // resource id is only unique within its type).
          where: { resourceType },
          required: true,
        },
      ],
      order: [["createdAt", "DESC"]],
      transaction,
    }) as Promise<PendingInstance | null>;
  }

  /**
   * Fetch all workflow instances waiting for approval by a specific user (based on their role)
   */
  async getPendingTasks(tenantId: TenantId, user: WorkflowUser): Promise<InstanceRow[]> {
    // A user can approve if the current step requires their role
    const instances = await WorkflowInstance.findAll({
      where: { tenantId, status: "PENDING" },
      include: [
        {
          model: Workflow,
          as: "workflow",
          attributes: ["id", "name", "resourceType"],
          include: [
            {
              model: WorkflowStep,
              as: "steps",
            },
          ],
        },
        {
          model: WorkflowAction,
          as: "actions",
        },
      ],
    });

    // Filter in JS for complex logic:
    // 1. Current step requires user.roleId
    // 2. User has not already approved this step
    const pendingTasks = instances.filter(instance => {
      // A-204 — an instance whose workflow was deleted before deletion was
      // refused for pending instances has no steps to act on; it must not take
      // the whole inbox down with a TypeError.
      if (!instance.workflow) {return false;}
      const currentStep = (instance.workflow.steps as StepRow[]).find(s => s.stepOrder === instance.currentStepOrder);
      if (!currentStep) {return false;}
      if (currentStep.roleId !== user.roleId) {return false;}

      const hasActionInCurrentStep = (instance.actions as ModelInstance<"WorkflowAction">[]).some(
        action => action.stepId === currentStep.id && action.userId === user.id,
      );
      return !hasActionInCurrentStep;
    });

    return pendingTasks;
  }

  /**
   * Submit an approval or rejection for a specific workflow instance.
   *
   * A-183 — everything the decision depends on is read INSIDE its
   * transaction, after the instance row is locked (SELECT ... FOR UPDATE):
   * the instance's status and step, whether the caller already acted on the
   * step, and the step's approval count. They used to be read before the
   * transaction with no lock, so two concurrent approvals by the same user
   * both passed "already acted", and two approvers completing a step could
   * both count the other as missing (a double count, or a step that never
   * advanced). Every decision on one instance now serialises on its row.
   *
   * A-183 — the caller must hold write access to the record being decided:
   * `certificate` for a Certificate, `warehouse` for a StockTransfer,
   * `maintenance` for a MaintenanceWorkOrder — the same grant the record's
   * own approval route requires. 403 inside the tenant (checked after the
   * 404, so another tenant's instance stays indistinguishable from none).
   *
   * A-182 — a Certificate is a Part 11 record:
   *  - approving one is an electronic signature, so every APPROVED action on
   *    a Certificate workflow re-authenticates the caller (authMethod,
   *    authPayload, meaning), as POST /certificates/:id/approve does (A-62,
   *    ADR-047). The FINAL approval goes through the certificate's own state
   *    machine (only `pending_approval` can be approved, else 409) and writes
   *    its approver, ESignatureRecord and audit row;
   *  - a rejection returns only a `draft` or `pending_approval` certificate
   *    to `draft`; an approved, signed or revoked one answers 409 with the
   *    state explanation. It used to reset a certificate to DRAFT from any
   *    state.
   *
   * @param tenantId
   * @param instanceId
   * @param user - req.user (id, roleId, role)
   * @param actionData - action, comments; for a Certificate approval
   *   also authMethod, authPayload, meaning; ipAddress and userAgent from the
   *   request
   */
  async submitAction(
    tenantId: TenantId,
    instanceId: string,
    user: WorkflowUser,
    actionData: ActionData,
  ): Promise<{ message: string; status: InstanceRow["status"] }> {
    const { action, comments } = actionData;

    const t = await sequelize.transaction();
    try {
      const locked = await WorkflowInstance.findOne({
        where: { id: instanceId, tenantId },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!locked) {throw new AppError(404, "Workflow instance not found");}

      // Read again with the definition and the actions, under the lock: no
      // other decision on this instance can commit until this one does.
      // (FOR UPDATE is not combined with these LEFT JOINs: PostgreSQL refuses
      // it on the nullable side of an outer join.)
      const instance = (await WorkflowInstance.findOne({
        where: { id: instanceId, tenantId },
        include: [
          {
            model: Workflow,
            as: "workflow",
            include: [{ model: WorkflowStep, as: "steps" }],
          },
          {
            model: WorkflowAction,
            as: "actions",
          },
        ],
        transaction: t,
      })) as InstanceRow;

      // A-145 — a closed instance is a state conflict (409), not a malformed
      // request: it names the state, and that nothing further can be recorded.
      if (instance.status !== "PENDING") {
        throw new AppError(
          409,
          `Workflow instance is already ${instance.status}; no further approval or rejection can be recorded on it.`,
        );
      }

      // Read in the order the .js read them: the status first (a closed
      // instance is a 409 even when its workflow is gone), then the workflow.
      const workflowOf = instance.workflow as WorkflowRow;
      const { resourceType } = workflowOf;
      const stepsOf = workflowOf.steps as StepRow[];
      const currentStep = stepsOf.find(s => s.stepOrder === instance.currentStepOrder);
      if (!currentStep) {throw new AppError(500, "Workflow step configuration error");}

      if (currentStep.roleId !== user.roleId) {
        throw new AppError(403, "You do not have the required role to approve this step");
      }

      const menu = RESOURCE_MENUS[resourceType];
      if (!(await principalHasMenuPermission(user, menu, "write"))) {
        throw new AppError(
          403,
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the menu is interpolated as looked up (ADR-038 rule 3)
          `Deciding on a ${resourceType} requires write access to "${menu}", the permission its own approval requires.`,
        );
      }

      const actionsOf = instance.actions as ModelInstance<"WorkflowAction">[];
      const hasAction = actionsOf.some(a => a.stepId === currentStep.id && a.userId === user.id);
      if (hasAction) {
        throw new AppError(409, "You have already submitted an action for this step");
      }

      const sortedSteps = [...stepsOf].sort((a, b) => a.stepOrder - b.stepOrder);
      const currentIndex = sortedSteps.findIndex(s => s.id === currentStep.id);
      // Counted under the lock (A-183), +1 for this action.
      const stepApprovals =
        actionsOf.filter(a => a.stepId === currentStep.id && a.action === "APPROVED").length + 1;
      const stepComplete = action === "APPROVED" && stepApprovals >= currentStep.requiredApprovals;
      const finalApproval = stepComplete && currentIndex === sortedSteps.length - 1;

      // A-182 — the certificate is checked and locked, and the approver
      // re-authenticated, BEFORE anything is written; a refused decision
      // consumes no one-time MFA code.
      let certificate: unknown = null;
      const authOptions: AuthOptions = {
        authMethod: actionData.authMethod,
        authPayload: actionData.authPayload,
        meaning: actionData.meaning,
        ipAddress: actionData.ipAddress,
        userAgent: actionData.userAgent,
      };
      if (resourceType === "Certificate") {
        const certificateService = loadCertificateService();
        if (action === "REJECTED") {
          certificate = await certificateService.lockForWorkflowDecision(t, tenantId, instance.resourceId, "reject");
        } else {
          if (!authOptions.authMethod || !authOptions.authPayload || !authOptions.meaning) {
            throw new AppError(400, CERTIFICATE_APPROVAL_NEEDS_REAUTH);
          }
          // ADR-101 — separation of duties at EVERY approving step: the
          // certificate's author may not review it. Before re-authentication,
          // so a refusal consumes no one-time MFA code and records nothing.
          await certificateService.refuseSelfApprovalInWorkflow(t, tenantId, instance.resourceId, user.id);
          if (finalApproval) {
            certificate = await certificateService.lockForWorkflowDecision(t, tenantId, instance.resourceId, "approve");
          }
          await certificateService.verifyWorkflowApprovalAuth(user.id, authOptions, {
            tenantId,
            resourceType: "Certificate",
            resourceId: instance.resourceId,
            operation: "workflow-approve",
          });
        }
      }

      const before = { status: instance.status, currentStepOrder: instance.currentStepOrder };

      await WorkflowAction.create(
        {
          instanceId: instance.id,
          stepId: currentStep.id,
          userId: user.id,
          action,
          comments: comments as string | null,
        },
        { transaction: t },
      );

      if (action === "REJECTED") {
        instance.status = "REJECTED";
        await instance.save({ transaction: t });
        if (certificate) {
          await loadCertificateService().applyWorkflowRejection(t, certificate, {
            tenantId,
            userId: user.id,
            workflowInstanceId: instance.id,
            comments,
          });
        } else {
          await this._updateTargetResourceStatus(tenantId, resourceType, instance.resourceId, "REJECTED", t, user);
        }
      } else if (finalApproval) {
        instance.status = "APPROVED";
        await instance.save({ transaction: t });
        if (certificate) {
          await loadCertificateService().applyWorkflowApproval(t, certificate, {
            tenantId,
            approverId: user.id,
            authOptions,
            workflowInstanceId: instance.id,
          });
        } else {
          await this._updateTargetResourceStatus(tenantId, resourceType, instance.resourceId, "APPROVED", t, user);
        }
      } else if (stepComplete) {
        // Advance to the next step.
        instance.currentStepOrder = (sortedSteps[currentIndex + 1] as StepRow).stepOrder;
        await instance.save({ transaction: t });
      }

      // A-145 — an approval or rejection is a Part 11 act (the route carries
      // denyPlatformAuthoring). Its audit row commits with it, or neither does:
      // logAction re-throws inside a transaction, and the catch below rolls
      // the action back.
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty value is recorded as null */
      await auditService.logAction(
        {
          tenantId,
          userId: user.id,
          // A rejection has no ENUM member of its own: the nearest action,
          // with the decision named in `changes` (constants/auditActions.js).
          action: action === "APPROVED" ? "APPROVE" : "UPDATE",
          resourceType: "WorkflowInstance",
          resourceId: instance.id,
          changes: {
            operation: ACTION_OPERATIONS[action] || "WORKFLOW_ACTION",
            decision: action,
            stepId: currentStep.id,
            stepOrder: currentStep.stepOrder,
            targetResourceType: resourceType,
            targetResourceId: instance.resourceId,
            comments: comments || null,
            // A-182 — never the credential; only that one was checked.
            ...(resourceType === "Certificate" && action === "APPROVED"
              ? { meaning: authOptions.meaning, reauthenticated: authOptions.authMethod }
              : {}),
            before,
            after: { status: instance.status, currentStepOrder: instance.currentStepOrder },
          },
          ipAddress: (authOptions.ipAddress || null) as string | null,
          userAgent: (authOptions.userAgent || null) as string | null,
        },
        { transaction: t },
      );
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

      await t.commit();
      return { message: "Action submitted successfully", status: instance.status };
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  async _updateTargetResourceStatus(
    tenantId: TenantId,
    resourceType: string,
    resourceId: string,
    finalStatus: "APPROVED" | "REJECTED",
    transaction: SqlTransaction,
    approverUser: WorkflowUser | null = null,
  ): Promise<void> {
    // A-182 — a Certificate never comes here: its decisions go through the
    // certificate state machine (certificate.service#applyWorkflowApproval /
    // #applyWorkflowRejection). This wrote "APPROVED" / "DRAFT" — not values
    // of the lowercase status ENUM — and `approvedById` / `approvedAt`, which
    // are not Certificate attributes (A-200).
    //
    // A-201 (ADR-065) — this wrote "Approved" / "Rejected" to a StockTransfer,
    // values its ENUM (pending, in_transit, completed, cancelled) does not
    // have: every final decision would have failed on PostgreSQL, rolling the
    // decision back. And `approvedAt` is not a StockTransfer attribute. The
    // mapping now lands on the transfer's own lifecycle:
    //   APPROVED -> in_transit (released to move; approvedBy = the approver).
    //     The stock itself moves only at "completed" (stock.service
    //     #updateTransferStatus), which counts and audits both quantities —
    //     an approval authorises a movement, it does not perform it.
    //   REJECTED -> cancelled (approvedBy = who decided, as a manual cancel records).
    // A transfer that has already left `pending` is not rewritten: 409.
    if (resourceType === "StockTransfer") {
      const record = await StockTransfer.findOne({
        where: { id: resourceId, tenantId },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!record) {
        throw new AppError(409, "The stock transfer this workflow decides on no longer exists. Nothing was recorded.");
      }
      if (record.status !== "pending") {
        throw new AppError(
          409,
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the status is interpolated as stored (ADR-038 rule 3)
          `This stock transfer is "${record.status}" and can no longer be ${
            finalStatus === "APPROVED" ? "approved" : "rejected"
          } through its workflow: only a pending transfer is decided.`,
        );
      }
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
      const before = { status: record.status, approvedBy: record.approvedBy || null };
      record.status = finalStatus === "APPROVED" ? "in_transit" : "cancelled";
      record.approvedBy = approverUser ? approverUser.id : null;
      await record.save({ transaction });
      await auditService.logAction(
        {
          tenantId,
          userId: approverUser ? approverUser.id : null,
          action: "UPDATE",
          resourceType: "StockTransfer",
          resourceId: record.id,
          changes: {
            operation: finalStatus === "APPROVED" ? "WORKFLOW_APPROVE" : "WORKFLOW_REJECT",
            before,
            after: { status: record.status, approvedBy: record.approvedBy },
          },
        },
        { transaction },
      );
    } else if (resourceType === "MaintenanceWorkOrder") {
      // A-201 — a sign-off workflow on a work order. Nothing starts one today
      // (no startWorkflow("MaintenanceWorkOrder") caller), so this is the
      // contract for when something does: APPROVED signs the work off
      // (Completed); REJECTED sends it back to the performer (InProgress).
      // A rejection used to change nothing, so a rejected work order looked
      // exactly like one still awaiting its decision.
      const record = await MaintenanceWorkOrder.findOne({ where: { id: resourceId, tenantId }, transaction });
      if (record) {
        const before = { status: record.status };
        record.status = finalStatus === "APPROVED" ? "Completed" : "InProgress";
        await record.save({ transaction });
        await auditService.logAction(
          {
            tenantId,
            userId: approverUser ? approverUser.id : null,
            action: "UPDATE",
            resourceType: "MaintenanceWorkOrder",
            resourceId: record.id,
            changes: {
              operation: finalStatus === "APPROVED" ? "WORKFLOW_APPROVE" : "WORKFLOW_REJECT",
              before,
              after: { status: record.status },
            },
          },
          { transaction },
        );
      }
    }
  }
}

/** The exported instance: the class's methods plus the two constants the `.js` added to it. */
type WorkflowServiceExport = WorkflowService & {
  RESOURCE_MENUS: typeof RESOURCE_MENUS;
  CERTIFICATE_APPROVAL_NEEDS_REAUTH: string;
};

const workflowService = new WorkflowService() as WorkflowServiceExport;
workflowService.RESOURCE_MENUS = RESOURCE_MENUS;
workflowService.CERTIFICATE_APPROVAL_NEEDS_REAUTH = CERTIFICATE_APPROVAL_NEEDS_REAUTH;

export = workflowService;
