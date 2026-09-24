const {
  Workflow,
  WorkflowStep,
  WorkflowInstance,
  WorkflowAction,
  Certificate,
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
const auditService = require("./audit.service");

// A-145 — `changes.operation` of a workflow action's audit row.
const ACTION_OPERATIONS = Object.freeze({
  APPROVED: "WORKFLOW_APPROVE",
  REJECTED: "WORKFLOW_REJECT",
});

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

  async createWorkflow(tenantId, data) {
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
      await t.commit();
      return this.getWorkflowById(tenantId, workflow.id);
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  async updateWorkflow(tenantId, id, data) {
    const workflow = await this.getWorkflowById(tenantId, id);
    const t = await sequelize.transaction();

    try {
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

      if (data.steps && data.steps.length > 0) {
        await WorkflowStep.destroy({ where: { workflowId: workflow.id }, transaction: t });
        const steps = data.steps.map((step) => ({
          workflowId: workflow.id,
          stepOrder: step.stepOrder,
          roleId: step.roleId,
          requiredApprovals: step.requiredApprovals || 1,
        }));
        await WorkflowStep.bulkCreate(steps, { transaction: t });
      }

      await t.commit();
      return this.getWorkflowById(tenantId, id);
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  async deleteWorkflow(tenantId, id) {
    const workflow = await this.getWorkflowById(tenantId, id);
    await workflow.destroy();
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
   * Submit an approval or rejection for a specific workflow instance
   */
  async submitAction(tenantId, instanceId, user, actionData) {
    const { action, comments } = actionData;

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
    });

    if (!instance) throw new AppError(404, "Workflow instance not found");
    // A-145 — a closed instance is a state conflict (409), not a malformed
    // request: it names the state, and that nothing further can be recorded.
    if (instance.status !== "PENDING") {
      throw new AppError(
        409,
        `Workflow instance is already ${instance.status}; no further approval or rejection can be recorded on it.`,
      );
    }

    const currentStep = instance.workflow.steps.find(s => s.stepOrder === instance.currentStepOrder);
    if (!currentStep) throw new AppError(500, "Workflow step configuration error");

    if (currentStep.roleId !== user.roleId) {
      throw new AppError(403, "You do not have the required role to approve this step");
    }

    const hasAction = instance.actions.some(a => a.stepId === currentStep.id && a.userId === user.id);
    if (hasAction) {
      throw new AppError(409, "You have already submitted an action for this step");
    }

    const before = { status: instance.status, currentStepOrder: instance.currentStepOrder };

    const t = await sequelize.transaction();
    try {
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
        await this._updateTargetResourceStatus(tenantId, instance.workflow.resourceType, instance.resourceId, "REJECTED", t);
      } else if (action === "APPROVED") {
        // Check if enough approvals are met for the current step
        const stepApprovals = instance.actions.filter(a => a.stepId === currentStep.id && a.action === "APPROVED").length + 1; // +1 for the current action
        
        if (stepApprovals >= currentStep.requiredApprovals) {
          // Advance to next step or finalize
          const sortedSteps = instance.workflow.steps.sort((a, b) => a.stepOrder - b.stepOrder);
          const currentIndex = sortedSteps.findIndex(s => s.id === currentStep.id);
          
          if (currentIndex < sortedSteps.length - 1) {
            // Advance
            instance.currentStepOrder = sortedSteps[currentIndex + 1].stepOrder;
            await instance.save({ transaction: t });
          } else {
            // Finalize
            instance.status = "APPROVED";
            await instance.save({ transaction: t });
            await this._updateTargetResourceStatus(tenantId, instance.workflow.resourceType, instance.resourceId, "APPROVED", t, user);
          }
        }
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
            targetResourceType: instance.workflow.resourceType,
            targetResourceId: instance.resourceId,
            comments: comments || null,
            before,
            after: { status: instance.status, currentStepOrder: instance.currentStepOrder },
          },
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
    if (resourceType === "Certificate") {
      const record = await Certificate.findOne({ where: { id: resourceId, tenantId }, transaction });
      if (record) {
        if (finalStatus === "APPROVED") {
          record.status = "APPROVED";
          record.approvedById = approverUser ? approverUser.id : null;
          record.approvedAt = new Date();
        } else if (finalStatus === "REJECTED") {
          record.status = "DRAFT"; // Or REJECTED if model supports it
        }
        await record.save({ transaction });
      }
    } else if (resourceType === "StockTransfer") {
      const record = await StockTransfer.findOne({ where: { id: resourceId, tenantId }, transaction });
      if (record) {
        if (finalStatus === "APPROVED") {
          record.status = "Approved";
          record.approvedBy = approverUser ? approverUser.id : null;
          record.approvedAt = new Date();
        } else if (finalStatus === "REJECTED") {
          record.status = "Rejected";
        }
        await record.save({ transaction });
      }
    } else if (resourceType === "MaintenanceWorkOrder") {
      const record = await MaintenanceWorkOrder.findOne({ where: { id: resourceId, tenantId }, transaction });
      if (record) {
        if (finalStatus === "APPROVED") {
          record.status = "Completed";
        }
        await record.save({ transaction });
      }
    }
  }
}

module.exports = new WorkflowService();
