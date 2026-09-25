const {
  Workflow,
  WorkflowStep,
  WorkflowInstance,
  WorkflowAction,
  StockTransfer,
  MaintenanceWorkOrder,
  User,
  Role,
  sequelize
} = require("../models");
// NOTE: utils/appError exports an object — AppError must be destructured.
// (`const AppError = require(...)` made `new AppError(...)` throw
// "AppError is not a constructor".)
const { AppError } = require("../utils/appError.util");
const { Transaction } = require("sequelize");
const auditService = require("./audit.service");

// A-145 — `changes.operation` of a workflow action's audit row.
const ACTION_OPERATIONS = Object.freeze({
  APPROVED: "WORKFLOW_APPROVE",
  REJECTED: "WORKFLOW_REJECT",
});

/**
 * A-183 — the menu whose `write` grant a decision on each resource type
 * requires: the same grant as the record's own approval route
 * (POST /certificates/:id/approve is `certificate` approve; stock transfers
 * are `warehouse` write; work orders `maintenance` update).
 */
const RESOURCE_MENUS = Object.freeze({
  Certificate: "certificate",
  StockTransfer: "warehouse",
  MaintenanceWorkOrder: "maintenance",
});

/** A-182 — a Certificate approval without the re-authentication fields. */
const CERTIFICATE_APPROVAL_NEEDS_REAUTH =
  "Approving a certificate is an electronic signature (21 CFR Part 11): re-authenticate by " +
  'sending authMethod ("password" or "mfa"), authPayload (your password or a current MFA code) ' +
  'and meaning (for example "Reviewed and approved").';

/** Lazy: the gate's module loads the role services, which must not load first. */
const principalHasMenuPermission = (...args) =>
  require("../middlewares/dynamicAccess.middleware").principalHasMenuPermission(...args);

class WorkflowService {
  async getWorkflows(tenantId) {
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

  async getWorkflowById(tenantId, id) {
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

    if (!workflow) throw new AppError(404, "Workflow not found");
    return workflow;
  }

  /**
   * A-204 — the audit row of a workflow-definition change, written in the
   * change's transaction (logAction re-throws inside one, so a failed row
   * rolls the change back). A workflow definition decides who approves a
   * Part 11 record; changing it unattributed was the gap.
   */
  async _auditDefinition(t, tenantId, actor, action, workflowId, changes) {
    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId || null,
        action,
        resourceType: "Workflow",
        resourceId: workflowId,
        changes,
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction: t },
    );
  }

  /**
   * A-204 — the step definition, as recorded in an audit row. Every caller
   * passes steps whose requiredApprovals is set (defaulted on write; NOT NULL
   * in the table).
   */
  _stepsOf(steps) {
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
  async _lockDefinition(t, tenantId, id) {
    // No include: FOR UPDATE with a LEFT JOIN is refused by PostgreSQL on
    // the nullable side, and a hasMany include puts the root in a subquery.
    const workflow = await Workflow.findOne({
      where: { id, tenantId },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
    });
    if (!workflow) throw new AppError(404, "Workflow not found");
    return workflow;
  }

  async createWorkflow(tenantId, data, actor = {}) {
    const t = await sequelize.transaction();
    try {
      // Check if a workflow for this resourceType already exists (only one active per resource)
      if (data.isActive !== false) {
        await Workflow.update(
          { isActive: false },
          { where: { tenantId, resourceType: data.resourceType, isActive: true }, transaction: t }
        );
      }

      const workflow = await Workflow.create(
        {
          tenantId,
          name: data.name,
          resourceType: data.resourceType,
          isActive: data.isActive !== undefined ? data.isActive : true,
        },
        { transaction: t }
      );

      const steps = data.steps.map((step) => ({
        workflowId: workflow.id,
        stepOrder: step.stepOrder,
        roleId: step.roleId,
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
  async updateWorkflow(tenantId, id, data, actor = {}) {
    const t = await sequelize.transaction();

    try {
      const workflow = await this._lockDefinition(t, tenantId, id);
      const before = { name: workflow.name, isActive: workflow.isActive };
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
            `This workflow has been started ${instances} time(s); its steps are the record its approvals ` +
              "were made against and cannot be replaced. Deactivate it and create a new workflow instead.",
          );
        }
      }

      if (data.name !== undefined) workflow.name = data.name;

      if (data.isActive !== undefined && data.isActive !== workflow.isActive) {
        if (data.isActive) {
          await Workflow.update(
            { isActive: false },
            { where: { tenantId, resourceType: workflow.resourceType, isActive: true }, transaction: t }
          );
        }
        workflow.isActive = data.isActive;
      }

      await workflow.save({ transaction: t });

      const after = { name: workflow.name, isActive: workflow.isActive };
      if (replaceSteps) {
        const current = await WorkflowStep.findAll({
          where: { workflowId: workflow.id },
          order: [["stepOrder", "ASC"]],
          transaction: t,
        });
        before.steps = this._stepsOf(current);
        await WorkflowStep.destroy({ where: { workflowId: workflow.id }, transaction: t });
        const steps = data.steps.map((step) => ({
          workflowId: workflow.id,
          stepOrder: step.stepOrder,
          roleId: step.roleId,
          requiredApprovals: step.requiredApprovals || 1,
        }));
        await WorkflowStep.bulkCreate(steps, { transaction: t });
        after.steps = this._stepsOf(steps);
      }

      await this._auditDefinition(t, tenantId, actor, "UPDATE", workflow.id, { before, after });
      await t.commit();
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
  async deleteWorkflow(tenantId, id, actor = {}) {
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
          `This workflow has ${pending} pending approval(s) and cannot be deleted while they are open. ` +
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
  async startWorkflow(tenantId, resourceType, resourceId, transaction = null) {
    // Fail-soft: this hook intercepts domain operations (stock transfers,
    // certificates). If the workflow engine cannot even determine whether a
    // workflow exists (model unavailable, lookup error), the domain operation
    // must not be aborted — behave as "no workflow configured".
    let workflow;
    try {
      workflow = await Workflow.findOne({
        where: { tenantId, resourceType, isActive: true },
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
        // eslint-disable-next-line global-require
        const { logger } = require("../middlewares/activityLog.middleware");
        logger.warn(`Workflow lookup failed (${resourceType}): ${err.message}`);
      } catch {
        /* logging is best-effort */
      }
      return null;
    }

    if (!workflow || !workflow.steps || workflow.steps.length === 0) {
      return null;
    }

    const instance = await WorkflowInstance.create(
      {
        tenantId,
        workflowId: workflow.id,
        resourceId,
        status: "PENDING",
        currentStepOrder: workflow.steps[0].stepOrder,
      },
      { transaction }
    );

    return instance;
  }

  /**
   * A-202 / A-203 — the PENDING workflow instance deciding on a resource, or
   * null. While one exists the resource is decided THROUGH it: a direct
   * approval of the certificate, or a manual move of the stock transfer, is
   * refused (409) by its service.
   *
   * @param {string} tenantId
   * @param {string} resourceType - "Certificate" | "StockTransfer" | ...
   * @param {string} resourceId
   * @param {object} [transaction]
   * @returns {Promise<object|null>} the instance, with `workflow` (id, name)
   */
  async findPendingInstance(tenantId, resourceType, resourceId, transaction = null) {
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
    });
  }

  /**
   * Fetch all workflow instances waiting for approval by a specific user (based on their role)
   */
  async getPendingTasks(tenantId, user) {
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
            }
          ]
        },
        {
          model: WorkflowAction,
          as: "actions",
        }
      ],
    });

    // Filter in JS for complex logic:
    // 1. Current step requires user.roleId
    // 2. User has not already approved this step
    const pendingTasks = instances.filter(instance => {
      // A-204 — an instance whose workflow was deleted before deletion was
      // refused for pending instances has no steps to act on; it must not take
      // the whole inbox down with a TypeError.
      if (!instance.workflow) return false;
      const currentStep = instance.workflow.steps.find(s => s.stepOrder === instance.currentStepOrder);
      if (!currentStep) return false;
      if (currentStep.roleId !== user.roleId) return false;

      const hasActionInCurrentStep = instance.actions.some(
        action => action.stepId === currentStep.id && action.userId === user.id
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
   * @param {string} tenantId
   * @param {string} instanceId
   * @param {Object} user - req.user (id, roleId, role)
   * @param {Object} actionData - action, comments; for a Certificate approval
   *   also authMethod, authPayload, meaning; ipAddress and userAgent from the
   *   request
   * @returns {Promise<{message: string, status: string}>}
   */
  async submitAction(tenantId, instanceId, user, actionData) {
    const { action, comments } = actionData;

    const t = await sequelize.transaction();
    try {
      const locked = await WorkflowInstance.findOne({
        where: { id: instanceId, tenantId },
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!locked) throw new AppError(404, "Workflow instance not found");

      // Read again with the definition and the actions, under the lock: no
      // other decision on this instance can commit until this one does.
      // (FOR UPDATE is not combined with these LEFT JOINs: PostgreSQL refuses
      // it on the nullable side of an outer join.)
      const instance = await WorkflowInstance.findOne({
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
          }
        ],
        transaction: t,
      });

      // A-145 — a closed instance is a state conflict (409), not a malformed
      // request: it names the state, and that nothing further can be recorded.
      if (instance.status !== "PENDING") {
        throw new AppError(
          409,
          `Workflow instance is already ${instance.status}; no further approval or rejection can be recorded on it.`,
        );
      }

      const { resourceType } = instance.workflow;
      const currentStep = instance.workflow.steps.find(s => s.stepOrder === instance.currentStepOrder);
      if (!currentStep) throw new AppError(500, "Workflow step configuration error");

      if (currentStep.roleId !== user.roleId) {
        throw new AppError(403, "You do not have the required role to approve this step");
      }

      const menu = RESOURCE_MENUS[resourceType];
      if (!(await principalHasMenuPermission(user, menu, "write"))) {
        throw new AppError(
          403,
          `Deciding on a ${resourceType} requires write access to "${menu}", the permission its own approval requires.`,
        );
      }

      const hasAction = instance.actions.some(a => a.stepId === currentStep.id && a.userId === user.id);
      if (hasAction) {
        throw new AppError(409, "You have already submitted an action for this step");
      }

      const sortedSteps = [...instance.workflow.steps].sort((a, b) => a.stepOrder - b.stepOrder);
      const currentIndex = sortedSteps.findIndex(s => s.id === currentStep.id);
      // Counted under the lock (A-183), +1 for this action.
      const stepApprovals =
        instance.actions.filter(a => a.stepId === currentStep.id && a.action === "APPROVED").length + 1;
      const stepComplete = action === "APPROVED" && stepApprovals >= currentStep.requiredApprovals;
      const finalApproval = stepComplete && currentIndex === sortedSteps.length - 1;

      // A-182 — the certificate is checked and locked, and the approver
      // re-authenticated, BEFORE anything is written; a refused decision
      // consumes no one-time MFA code.
      let certificate = null;
      const authOptions = {
        authMethod: actionData.authMethod,
        authPayload: actionData.authPayload,
        meaning: actionData.meaning,
        ipAddress: actionData.ipAddress,
        userAgent: actionData.userAgent,
      };
      if (resourceType === "Certificate") {
        const certificateService = require("./certificate.service");
        if (action === "REJECTED") {
          certificate = await certificateService.lockForWorkflowDecision(t, tenantId, instance.resourceId, "reject");
        } else {
          if (!authOptions.authMethod || !authOptions.authPayload || !authOptions.meaning) {
            throw new AppError(400, CERTIFICATE_APPROVAL_NEEDS_REAUTH);
          }
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
          comments,
        },
        { transaction: t }
      );

      if (action === "REJECTED") {
        instance.status = "REJECTED";
        await instance.save({ transaction: t });
        if (certificate) {
          await require("./certificate.service").applyWorkflowRejection(t, certificate, {
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
          await require("./certificate.service").applyWorkflowApproval(t, certificate, {
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
        instance.currentStepOrder = sortedSteps[currentIndex + 1].stepOrder;
        await instance.save({ transaction: t });
      }

      // A-145 — an approval or rejection is a Part 11 act (the route carries
      // denyPlatformAuthoring). Its audit row commits with it, or neither does:
      // logAction re-throws inside a transaction, and the catch below rolls
      // the action back.
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
          ipAddress: authOptions.ipAddress || null,
          userAgent: authOptions.userAgent || null,
        },
        { transaction: t },
      );

      await t.commit();
      return { message: "Action submitted successfully", status: instance.status };
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  async _updateTargetResourceStatus(tenantId, resourceType, resourceId, finalStatus, transaction, approverUser = null) {
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
          `This stock transfer is "${record.status}" and can no longer be ${
            finalStatus === "APPROVED" ? "approved" : "rejected"
          } through its workflow: only a pending transfer is decided.`,
        );
      }
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

module.exports = new WorkflowService();
module.exports.RESOURCE_MENUS = RESOURCE_MENUS;
module.exports.CERTIFICATE_APPROVAL_NEEDS_REAUTH = CERTIFICATE_APPROVAL_NEEDS_REAUTH;
