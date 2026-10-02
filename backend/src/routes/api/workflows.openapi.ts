/**
 * P9-21 / P9-25 (ADR-103) — the contract of `workflows.route.ts`, code-first.
 *
 * Definitions are gated on `workflows` (read / write). The decision route
 * admits a caller holding write on ANY kind of record a workflow decides on
 * (certificate, warehouse, maintenance); the service then requires write on
 * the kind THIS instance decides on, after the 404 (A-183). A decision refuses
 * an API key (Q-51) and the platform tenant (A-145), and approving a
 * Certificate re-authenticates (A-182). Bodies are the schemas `validate()`
 * enforces (`validators/workflow.validator` → `@callibrator/contracts/workflow`).
 * Examples are synthetic.
 */
import { z } from "zod";
import { createWorkflowSchema, submitActionSchema, updateWorkflowSchema } from "../../validators/workflow.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const timestamp = z.iso.datetime();
const RESOURCE_TYPES = ["Certificate", "StockTransfer", "MaintenanceWorkOrder"] as const;

/** One approval step: the role that decides it, and how many approvals it needs. */
const WorkflowStep = z
  .object({
    id: z.guid(),
    workflowId: z.guid(),
    stepOrder: z.number().int(),
    roleId: z.guid(),
    requiredApprovals: z.number().int(),
    role: z.object({ id: z.guid(), name: z.string() }).nullable().optional(),
  })
  .loose()
  .meta({ id: "WorkflowStep" });

/** A workflow definition, with its steps in order. */
const Workflow = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    name: z.string(),
    resourceType: z.enum(RESOURCE_TYPES),
    isActive: z.boolean().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: z.array(WorkflowStep).optional(),
  })
  .loose()
  .meta({
    id: "Workflow",
    description: "An approval chain for one kind of record. Its steps cannot be replaced while an instance is pending.",
    example: {
      id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      name: "Certificate approval",
      resourceType: "Certificate",
      isActive: true,
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
    },
  });

/** A pending decision the caller's role may take. */
const PendingTask = z
  .object({
    id: z.guid(),
    workflowId: z.guid(),
    resourceId: z.guid(),
    status: z.string(),
    currentStepOrder: z.number().int(),
    // P9-25 item 11: workflow.service#getPendingTasks includes the workflow
    // (with its steps) and the instance's actions; the inbox reads the
    // workflow's name and resource type.
    workflow: z
      .object({ id: z.guid(), name: z.string(), resourceType: z.enum(RESOURCE_TYPES), steps: z.array(WorkflowStep) })
      .meta({ description: "The definition (never null on this list: an instance without one is filtered out, A-204)" }),
    actions: z
      .array(z.looseObject({ id: z.guid(), stepId: z.guid(), userId: z.guid().nullable(), action: z.string(), comments: z.string().nullable() }))
      .meta({ description: "The decisions already taken on this instance" }),
  })
  .loose()
  .meta({ id: "WorkflowPendingTask", description: "A PENDING workflow instance at a step the caller's role decides." });

const idParams = z.object({
  id: z.guid().meta({ description: "The workflow's id", example: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a" }),
});
const instanceParams = z.object({
  instanceId: z.guid().meta({ description: "The workflow instance's id", example: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b" }),
});
const read = { kind: "dynamicAccess", resource: "workflows", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "workflows", action: "write" } as const;

export default defineRouteDocs({
  router: "api/workflows.route",
  mount: "/api/v1/workflows",
  tag: "Workflows",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/instances/pending",
      operationId: "listPendingWorkflowTasks",
      summary: "The decisions waiting on the caller's role",
      permission: read,
      audited: false,
      success: { status: 200, description: "The pending instances", data: z.array(PendingTask) },
    },
    {
      method: "post",
      path: "/instances/:instanceId/action",
      operationId: "decideWorkflowInstance",
      summary: "Approve or reject a pending workflow step",
      description:
        "The caller must hold the step's role, and write on the kind of record the instance decides on (403 otherwise, after the 404). " +
        "Approving a Certificate is a Part 11 signature: authMethod, authPayload and meaning are required, a wrong credential is a 401 recorded as " +
        "SIGNATURE_AUTH_FAILED, and the author of the certificate may not approve it at any step (403, ADR-101). The final approval applies to the " +
        "record in the same transaction. An API key is refused (403, Q-51); the platform tenant decides nothing here (403, A-145).",
      permission: { kind: "dynamicAccess", resource: ["certificate", "warehouse", "maintenance"], action: "write" },
      audited: true,
      params: instanceParams,
      body: submitActionSchema,
      conflict: "The instance is no longer pending, or the record it decides on is not in a state the decision allows (explained).",
      success: {
        status: 200,
        description: "The instance's new status; the message says what happened",
        data: z.object({ status: z.string() }).meta({ id: "WorkflowDecision", example: { status: "APPROVED" } }),
      },
    },
    {
      method: "get",
      path: "/",
      operationId: "listWorkflows",
      summary: "List the tenant's workflow definitions",
      permission: read,
      audited: false,
      success: { status: 200, description: "The workflows, with their steps", data: z.array(Workflow) },
    },
    {
      method: "post",
      path: "/",
      operationId: "createWorkflow",
      summary: "Define a workflow",
      permission: write,
      audited: true,
      body: createWorkflowSchema,
      success: { status: 201, description: "The workflow, with its steps", data: Workflow },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getWorkflow",
      summary: "Get one workflow definition",
      permission: read,
      audited: false,
      params: idParams,
      success: { status: 200, description: "The workflow, with its steps", data: Workflow },
    },
    {
      method: "put",
      path: "/:id",
      operationId: "updateWorkflow",
      summary: "Edit a workflow definition",
      permission: write,
      audited: true,
      params: idParams,
      body: updateWorkflowSchema,
      conflict: "Its steps cannot be replaced while an instance is pending.",
      success: { status: 200, description: "The workflow", data: Workflow },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteWorkflow",
      summary: "Delete a workflow definition",
      permission: write,
      audited: true,
      params: idParams,
      conflict: "An instance of it is pending.",
      success: { status: 200, description: "Deleted", empty: true },
    },
  ],
});
