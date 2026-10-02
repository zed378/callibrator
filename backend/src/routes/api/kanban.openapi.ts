/**
 * P9-18 / P9-25 (ADR-103) — the contract of `kanban.route.ts`, code-first.
 *
 * Every route sits behind `router.use(auth)` and carries no menu gate: a board
 * is gated per project inside kanban.service (`assertAccess`: owner / editor /
 * viewer, granted by user or by role; the creator and a super admin are
 * owners). A caller with no access to the project gets 404, exactly like a
 * project that does not exist or belongs to another tenant; a member whose
 * level is too low gets 403. Request bodies are the contract's own schemas
 * (`@callibrator/contracts/kanban`), the same objects `validate()` enforces.
 * Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs, type Permission } from "../../docs/openapi/operation";
import {
  ACCESS_LEVELS,
  PRIORITIES,
  RELATION_TYPES,
  SPRINT_STATUSES,
  addMember,
  addRelation,
  createCard,
  createColumn,
  createLabel,
  createProject,
  createSprint,
  migrateCards,
  moveCard,
  reorderColumns,
  updateCard,
  updateColumn,
  updateLabel,
  updateMember,
  updateProject,
  updateSprint,
} from "../../validators/kanban.validator";

/** The contract's schemas, by the names the operations use. */
const v = { ACCESS_LEVELS, PRIORITIES, RELATION_TYPES, SPRINT_STATUSES, addMember, addRelation, createCard, createColumn, createLabel, createProject, createSprint, migrateCards, moveCard, reorderColumns, updateCard, updateColumn, updateLabel, updateMember, updateProject, updateSprint };

const timestamp = z.iso.datetime();
const PROJECT = "5b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CARD = "6c2f3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

// users.email is NOT NULL (user.model.ts); first and last names may be null.
const userBrief = z.object({ id: z.guid(), firstName: z.string().nullable(), lastName: z.string().nullable(), email: z.string() });

const KanbanColumn = z
  .object({ id: z.guid(), name: z.string(), position: z.number().int(), wipLimit: z.number().int().nullable(), isDone: z.boolean() })
  .meta({
    id: "KanbanColumn",
    description: "A board column. The terminal Done column is kept last and cannot be deleted.",
    example: { id: "7d3a4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f", name: "In Progress", position: 1, wipLimit: 3, isDone: false },
  });

const KanbanLabel = z
  .object({ id: z.guid(), name: z.string(), color: z.string().nullable() })
  .meta({ id: "KanbanLabel", example: { id: "8e4b5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a", name: "Bug", color: "#d14343" } });

const KanbanSprint = z
  .object({
    id: z.guid(),
    name: z.string(),
    goal: z.string().nullable(),
    status: z.enum(v.SPRINT_STATUSES),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    position: z.number().int(),
  })
  .meta({
    id: "KanbanSprint",
    example: { id: "9f5c6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b", name: "Sprint 1", goal: null, status: "active", startDate: null, endDate: null, position: 0 },
  });

const KanbanRelation = z
  .object({
    id: z.guid(),
    type: z.enum(v.RELATION_TYPES),
    card: z.object({ id: z.guid(), cardKey: z.string(), title: z.string(), columnId: z.guid() }).nullable(),
  })
  .meta({ id: "KanbanCardRelation", description: "An outgoing relation and the linked card (null when that card is gone)." });

const KanbanCard = z
  .object({
    id: z.guid(),
    projectId: z.guid(),
    columnId: z.guid(),
    sprintId: z.guid().nullable(),
    number: z.number().int(),
    cardKey: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    position: z.number().int(),
    priority: z.enum(v.PRIORITIES).nullable(),
    dueDate: z.string().nullable(),
    createdBy: z.guid().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    assignees: z.array(userBrief),
    labels: z.array(KanbanLabel),
    relations: z.array(KanbanRelation).optional().meta({ description: "Present on single-card reads only." }),
  })
  .meta({
    id: "KanbanCard",
    description: "A card. Its key is the project's code (or a prefix of its name) and a per-project number.",
    example: {
      id: CARD,
      projectId: PROJECT,
      columnId: "7d3a4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f",
      sprintId: "9f5c6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b",
      number: 12,
      cardKey: "ICU-12",
      title: "Recalibrate infusion pump bay 3",
      description: null,
      position: 0,
      priority: "high",
      dueDate: "2030-02-01",
      createdBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
      assignees: [{ id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", firstName: "Ana", lastName: "Tech", email: "ana@example.test" }],
      labels: [{ id: "8e4b5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a", name: "Bug", color: "#d14343" }],
    },
  });

const KanbanMember = z
  .object({
    id: z.guid(),
    accessLevel: z.enum(v.ACCESS_LEVELS),
    user: userBrief.nullable(),
    role: z.object({ id: z.guid(), name: z.string() }).nullable(),
  })
  .meta({ id: "KanbanProjectMember", description: "A grant on the board, to a user or to a role." });

const access = z.enum(v.ACCESS_LEVELS).nullable().meta({ description: "The caller's own level on the board." });

const KanbanProjectSummary = z
  .object({
    id: z.guid(),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    createdBy: z.guid().nullable(),
    createdAt: timestamp,
    cardCount: z.number().int(),
    myAccess: access,
  })
  .meta({
    id: "KanbanProjectSummary",
    example: {
      id: PROJECT,
      name: "ICU devices",
      description: null,
      color: "#2f6fdf",
      createdBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      createdAt: "2030-01-15T09:00:00.000Z",
      cardCount: 12,
      myAccess: "owner",
    },
  });

const KanbanBoard = z
  .object({
    id: z.guid(),
    name: z.string(),
    code: z.string().nullable(),
    description: z.string().nullable(),
    color: z.string().nullable(),
    createdBy: z.guid().nullable(),
    // A board is answered only to a caller with access (assertAccess), so its level is set.
    myAccess: z.enum(v.ACCESS_LEVELS),
    activeSprintId: z.string().meta({ description: "The sprint whose cards were loaded: a sprint id, `backlog` or `all`." }),
    columns: z.array(KanbanColumn),
    cards: z.array(KanbanCard),
    labels: z.array(KanbanLabel),
    sprints: z.array(KanbanSprint),
    members: z.array(KanbanMember),
  })
  .meta({ id: "KanbanBoard", description: "A full board: the project, its columns, one sprint's cards, labels, sprints and members." });

const KanbanSprintList = z
  .object({ sprints: z.array(KanbanSprint.extend({ cardCount: z.number().int() })), backlogCount: z.number().int() })
  .meta({ id: "KanbanSprintList" });

const count = z.object({ count: z.number().int() });
const KanbanMetrics = z
  .object({
    view: z.string(),
    summary: z.object({
      total: z.number().int(),
      done: z.number().int(),
      inProgress: z.number().int(),
      completionRate: z.number().int(),
      overdue: z.number().int(),
      unassigned: z.number().int(),
      columns: z.number().int(),
      sprints: z.number().int(),
    }),
    byColumn: z.array(count.extend({ columnId: z.guid(), name: z.string(), isDone: z.boolean(), wipLimit: z.number().int().nullable(), overWip: z.boolean() })),
    byPriority: z.array(count.extend({ priority: z.string() })),
    // The name falls back to the email (NOT NULL), so it is always a string.
    byAssignee: z.array(count.extend({ userId: z.guid(), name: z.string() })),
    byLabel: z.array(count.extend({ labelId: z.guid(), name: z.string(), color: z.string().nullable() })),
    bySprint: z.array(count.extend({ sprintId: z.guid().nullable(), name: z.string(), status: z.string().nullable() })),
  })
  .meta({ id: "KanbanMetrics", description: "Board KPIs. `bySprint` is filled only for the `all` view." });

const Deleted = z.object({ deleted: z.literal(true) }).meta({ id: "KanbanDeleted" });

const PERMISSION: Permission = {
  kind: "authenticated",
  reason:
    "Per-project access, checked by kanban.service#assertAccess on every call (viewer / editor / owner, by user or by role). No access at all answers 404, never 403.",
};

const guid = (description: string, example: string) => z.guid().meta({ description, example });
const projectId = guid("The project (board)", PROJECT);
const p = z.object({ projectId });
const memberParams = z.object({ projectId, memberId: guid("The membership", "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f") });
const columnParams = z.object({ projectId, columnId: guid("The column", "7d3a4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f") });
const sprintParams = z.object({ projectId, sprintId: guid("The sprint", "9f5c6a7b-8c9d-4e0f-8a1b-3c4d5e6f7a8b") });
const cardParams = z.object({ projectId, cardId: guid("The card", CARD) });
const labelParams = z.object({ projectId, labelId: guid("The label", "8e4b5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a") });
const relationParams = z.object({
  projectId,
  cardId: guid("The card", CARD),
  relationId: guid("The relation (the card's outgoing row)", "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a"),
});
const sprintQuery = z.object({
  sprintId: z.string().optional().meta({ description: "A sprint id, `backlog` or `all`", example: "backlog" }),
});

const OWNER = "Requires owner access to the board (403 for a lower level).";
const EDITOR = "Requires editor access to the board (403 for a viewer).";
const VIEWER = "Requires viewer access to the board.";

export default defineRouteDocs({
  router: "api/kanban.route",
  mount: "/api/v1/kanban",
  tag: "Kanban",
  tagDescription: "Project-tracker kanban boards (per-project membership, realtime, notifications)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/projects",
      operationId: "listKanbanProjects",
      summary: "List the boards the caller can access",
      description: "A super admin sees every board of the tenant; anyone else the boards they created or are granted.",
      permission: PERMISSION,
      audited: false,
      success: { status: 200, description: "The caller's boards", data: z.array(KanbanProjectSummary) },
    },
    {
      method: "post",
      path: "/projects",
      operationId: "createKanbanProject",
      summary: "Create a board",
      description: "The caller becomes its owner. The board starts with To Do / In Progress / Done and an active Sprint 1.",
      permission: PERMISSION,
      audited: true,
      body: v.createProject,
      success: { status: 201, description: "The new board", data: KanbanBoard },
    },
    {
      method: "get",
      path: "/projects/:projectId",
      operationId: "getKanbanBoard",
      summary: "Get a full board",
      description: `${VIEWER} Cards are loaded for one sprint: the active one unless \`sprintId\` says otherwise.`,
      permission: PERMISSION,
      audited: false,
      params: p,
      query: sprintQuery,
      success: { status: 200, description: "The board", data: KanbanBoard },
    },
    {
      method: "patch",
      path: "/projects/:projectId",
      operationId: "updateKanbanProject",
      summary: "Update or archive a board",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.updateProject,
      success: { status: 200, description: "The board", data: KanbanBoard },
    },
    {
      method: "delete",
      path: "/projects/:projectId",
      operationId: "deleteKanbanProject",
      summary: "Delete a board",
      description: `${OWNER} The board's card attachments are soft-deleted with it (D-22).`,
      permission: PERMISSION,
      audited: true,
      params: p,
      success: { status: 200, description: "Deleted", data: Deleted },
    },
    {
      method: "post",
      path: "/projects/:projectId/members",
      operationId: "addKanbanMember",
      summary: "Grant a user or a role access to a board",
      description: `${OWNER} A user must be a user of the board's tenant: any other id answers 404 (A-277).`,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.addMember,
      success: {
        status: 201,
        description: "The new membership and the board's members",
        data: z.object({ memberId: z.guid(), members: z.array(KanbanMember) }),
      },
    },
    {
      method: "patch",
      path: "/projects/:projectId/members/:memberId",
      operationId: "updateKanbanMember",
      summary: "Change a membership's access level",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: memberParams,
      body: v.updateMember,
      success: { status: 200, description: "The board's members", data: z.array(KanbanMember) },
    },
    {
      method: "delete",
      path: "/projects/:projectId/members/:memberId",
      operationId: "removeKanbanMember",
      summary: "Remove a membership",
      description: `${OWNER} The last owner cannot be removed (400).`,
      permission: PERMISSION,
      audited: true,
      params: memberParams,
      success: { status: 200, description: "Removed", data: z.object({ removed: z.literal(true) }) },
    },
    {
      method: "get",
      path: "/projects/:projectId/sprints",
      operationId: "listKanbanSprints",
      summary: "List a board's sprints with card counts",
      description: VIEWER,
      permission: PERMISSION,
      audited: false,
      params: p,
      success: { status: 200, description: "The sprints and the backlog's count", data: KanbanSprintList },
    },
    {
      method: "post",
      path: "/projects/:projectId/sprints",
      operationId: "createKanbanSprint",
      summary: "Create a sprint",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.createSprint,
      success: { status: 201, description: "The sprint", data: KanbanSprint },
    },
    {
      method: "post",
      path: "/projects/:projectId/sprints/migrate",
      operationId: "migrateKanbanCards",
      summary: "Move cards into a sprint or the backlog",
      description: `${EDITOR} Either explicit \`cardIds\`, or \`allNotDone\` for every card not in a Done column.`,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.migrateCards,
      success: {
        status: 200,
        description: "How many cards moved, and where",
        data: z.object({ migrated: z.number().int(), targetSprintId: z.guid().nullable() }),
      },
    },
    {
      method: "patch",
      path: "/projects/:projectId/sprints/:sprintId",
      operationId: "updateKanbanSprint",
      summary: "Update a sprint",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: sprintParams,
      body: v.updateSprint,
      success: { status: 200, description: "The sprint", data: KanbanSprint },
    },
    {
      method: "delete",
      path: "/projects/:projectId/sprints/:sprintId",
      operationId: "deleteKanbanSprint",
      summary: "Delete a sprint (its cards fall back to the backlog)",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: sprintParams,
      success: { status: 200, description: "Deleted", data: Deleted },
    },
    {
      method: "get",
      path: "/projects/:projectId/metrics",
      operationId: "getKanbanMetrics",
      summary: "Board KPIs",
      description: `${VIEWER} The whole board unless \`sprintId\` narrows it.`,
      permission: PERMISSION,
      audited: false,
      params: p,
      query: sprintQuery,
      success: { status: 200, description: "The metrics", data: KanbanMetrics },
    },
    {
      method: "post",
      path: "/projects/:projectId/columns",
      operationId: "createKanbanColumn",
      summary: "Add a column (placed before Done)",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.createColumn,
      success: { status: 201, description: "The column", data: KanbanColumn },
    },
    {
      method: "post",
      path: "/projects/:projectId/columns/reorder",
      operationId: "reorderKanbanColumns",
      summary: "Reorder the columns (Done is kept last)",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.reorderColumns,
      success: { status: 200, description: "The columns in their new order", data: z.array(KanbanColumn) },
    },
    {
      method: "patch",
      path: "/projects/:projectId/columns/:columnId",
      operationId: "updateKanbanColumn",
      summary: "Update a column",
      description: OWNER,
      permission: PERMISSION,
      audited: true,
      params: columnParams,
      body: v.updateColumn,
      success: { status: 200, description: "The column", data: KanbanColumn },
    },
    {
      method: "delete",
      path: "/projects/:projectId/columns/:columnId",
      operationId: "deleteKanbanColumn",
      summary: "Delete a column",
      description: `${OWNER} The Done column and a board's last column cannot be deleted (400).`,
      permission: PERMISSION,
      audited: true,
      params: columnParams,
      success: { status: 200, description: "Deleted", data: Deleted },
    },
    {
      method: "post",
      path: "/projects/:projectId/cards",
      operationId: "createKanbanCard",
      summary: "Create a card",
      description: `${EDITOR} Every assignee must be a user of the board's tenant: any other id answers 404 (A-277). Assignees are notified.`,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.createCard,
      success: { status: 201, description: "The card", data: KanbanCard },
    },
    {
      method: "patch",
      path: "/projects/:projectId/cards/:cardId/move",
      operationId: "moveKanbanCard",
      summary: "Move a card to a column and position",
      description: EDITOR,
      permission: PERMISSION,
      audited: true,
      params: cardParams,
      body: v.moveCard,
      success: { status: 200, description: "The card", data: KanbanCard },
    },
    {
      method: "post",
      path: "/projects/:projectId/cards/:cardId/relations",
      operationId: "addKanbanCardRelation",
      summary: "Relate two cards of the board",
      description: `${EDITOR} The inverse relation is written on the other card too.`,
      permission: PERMISSION,
      audited: true,
      params: cardParams,
      body: v.addRelation,
      success: { status: 201, description: "The card's relations", data: z.array(KanbanRelation) },
    },
    {
      method: "delete",
      path: "/projects/:projectId/cards/:cardId/relations/:relationId",
      operationId: "removeKanbanCardRelation",
      summary: "Remove a relation (and its inverse)",
      description: EDITOR,
      permission: PERMISSION,
      audited: true,
      params: relationParams,
      success: { status: 200, description: "The card's relations", data: z.array(KanbanRelation) },
    },
    {
      method: "get",
      path: "/projects/:projectId/cards/:cardId",
      operationId: "getKanbanCard",
      summary: "Get a card with its assignees, labels and relations",
      description: VIEWER,
      permission: PERMISSION,
      audited: false,
      params: cardParams,
      success: { status: 200, description: "The card", data: KanbanCard },
    },
    {
      method: "patch",
      path: "/projects/:projectId/cards/:cardId",
      operationId: "updateKanbanCard",
      summary: "Update a card",
      description: `${EDITOR} \`assigneeIds\` and \`labelIds\`, when present, replace the full set; every assignee must be a user of the board's tenant (A-277).`,
      permission: PERMISSION,
      audited: true,
      params: cardParams,
      body: v.updateCard,
      success: { status: 200, description: "The card", data: KanbanCard },
    },
    {
      method: "delete",
      path: "/projects/:projectId/cards/:cardId",
      operationId: "deleteKanbanCard",
      summary: "Delete a card",
      description: `${EDITOR} Its attachments are soft-deleted with it (D-22).`,
      permission: PERMISSION,
      audited: true,
      params: cardParams,
      success: { status: 200, description: "Deleted", data: Deleted },
    },
    {
      method: "post",
      path: "/projects/:projectId/labels",
      operationId: "createKanbanLabel",
      summary: "Create a label",
      description: EDITOR,
      permission: PERMISSION,
      audited: true,
      params: p,
      body: v.createLabel,
      success: { status: 201, description: "The label", data: KanbanLabel },
    },
    {
      method: "patch",
      path: "/projects/:projectId/labels/:labelId",
      operationId: "updateKanbanLabel",
      summary: "Update a label",
      description: EDITOR,
      permission: PERMISSION,
      audited: true,
      params: labelParams,
      body: v.updateLabel,
      success: { status: 200, description: "The label", data: KanbanLabel },
    },
    {
      method: "delete",
      path: "/projects/:projectId/labels/:labelId",
      operationId: "deleteKanbanLabel",
      summary: "Delete a label",
      description: EDITOR,
      permission: PERMISSION,
      audited: true,
      params: labelParams,
      success: { status: 200, description: "Deleted", data: Deleted },
    },
  ],
});
