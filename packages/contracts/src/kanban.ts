/**
 * Kanban Validators.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/kanban.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the kanban routes.
 */
import { z } from "zod";
import { booleanish, dateLike, nullableText, numeric, uuid } from "./fields";

const ACCESS_LEVELS = ["owner", "editor", "viewer"] as const;
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const SPRINT_STATUSES = ["planned", "active", "completed"] as const;
const RELATION_TYPES = ["relates_to", "duplicates", "blocks", "blocked_by", "parent_of", "child_of"] as const;

// A sprint reference accepts a uuid, the literal "backlog", or null.
const sprintRef = z.union([uuid(), z.literal("backlog"), z.null()]);

const position = numeric(z.number().int().min(0));
const title = z.string().trim().min(1).max(500);

const memberSchema = z
  .object({
    userId: uuid().optional(),
    roleId: uuid().optional(),
    accessLevel: z.enum(ACCESS_LEVELS).default("viewer"),
  })
  // Exactly one of userId / roleId.
  .refine((m) => (m.userId === undefined) !== (m.roleId === undefined), { error: "Provide exactly one of userId, roleId" });

/** Short card-key prefix, e.g. "MGT" -> MGT-1. Letters/digits only. */
const code = z
  .string()
  .trim()
  .max(12)
  .regex(/^[A-Za-z0-9]*$/, { error: "code may contain letters and digits only" })
  .nullable()
  .optional();

const createProject = z.object({
  name: z.string().trim().min(1).max(255),
  code,
  description: nullableText(5000),
  color: nullableText(20),
  // Optional initial members (beyond the creator, who becomes owner).
  members: z.array(memberSchema).default([]),
});

const updateProject = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  code,
  description: nullableText(5000),
  color: nullableText(20),
  archived: booleanish().optional(),
});

const addMember = memberSchema;

const updateMember = z.object({
  accessLevel: z.enum(ACCESS_LEVELS),
});

const createColumn = z.object({
  name: z.string().trim().min(1).max(120),
  position: position.optional(),
  wipLimit: numeric(z.number().int().min(1)).nullable().optional(),
});

const updateColumn = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  position: position.optional(),
  wipLimit: numeric(z.number().int().min(1)).nullable().optional(),
});

const reorderColumns = z.object({
  // Full ordered list of column ids.
  order: z.array(uuid()).min(1),
});

const createCard = z.object({
  columnId: uuid(),
  // Omit to land in the active sprint; "backlog"/null for the backlog.
  sprintId: sprintRef.optional(),
  title,
  description: nullableText(20000),
  priority: z.enum(PRIORITIES).nullable().optional(),
  dueDate: dateLike().nullable().optional(),
  assigneeIds: z.array(uuid()).default([]),
  labelIds: z.array(uuid()).default([]),
});

const updateCard = z.object({
  title: title.optional(),
  description: nullableText(20000),
  priority: z.enum(PRIORITIES).nullable().optional(),
  dueDate: dateLike().nullable().optional(),
  sprintId: sprintRef.optional(),
  // When present, replaces the full set.
  assigneeIds: z.array(uuid()).optional(),
  labelIds: z.array(uuid()).optional(),
});

const moveCard = z.object({
  columnId: uuid(),
  // Target index within the destination column (0-based).
  position,
});

const createLabel = z.object({
  name: z.string().trim().min(1).max(80),
  color: nullableText(20),
});

const updateLabel = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: nullableText(20),
});

const createSprint = z.object({
  name: z.string().trim().min(1).max(160),
  goal: nullableText(2000),
  status: z.enum(SPRINT_STATUSES).default("planned"),
  startDate: dateLike().nullable().optional(),
  endDate: dateLike().nullable().optional(),
  position: position.optional(),
});

const updateSprint = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  goal: nullableText(2000),
  status: z.enum(SPRINT_STATUSES).optional(),
  startDate: dateLike().nullable().optional(),
  endDate: dateLike().nullable().optional(),
  position: position.optional(),
});

const migrateCards = z
  .object({
    // Explicit card ids, OR allNotDone to sweep every non-Done card.
    cardIds: z.array(uuid()).optional(),
    allNotDone: booleanish().optional(),
    fromSprintId: sprintRef.optional(),
    targetSprintId: sprintRef,
  })
  .refine((m) => m.cardIds !== undefined || m.allNotDone !== undefined, { error: "Provide cardIds or allNotDone" });

const addRelation = z.object({
  targetCardId: uuid(),
  type: z.enum(RELATION_TYPES),
});

export {
  createProject,
  updateProject,
  addMember,
  updateMember,
  createColumn,
  updateColumn,
  reorderColumns,
  createCard,
  updateCard,
  moveCard,
  createLabel,
  updateLabel,
  createSprint,
  updateSprint,
  migrateCards,
  addRelation,
  ACCESS_LEVELS,
  PRIORITIES,
  SPRINT_STATUSES,
  RELATION_TYPES,
};

// The client-side (input) and handler-side (output) types of each schema.
export type CreateProjectInput = z.input<typeof createProject>;
export type CreateProjectBody = z.output<typeof createProject>;
export type UpdateProjectInput = z.input<typeof updateProject>;
export type UpdateProjectBody = z.output<typeof updateProject>;
export type AddMemberInput = z.input<typeof addMember>;
export type AddMemberBody = z.output<typeof addMember>;
export type UpdateMemberInput = z.input<typeof updateMember>;
export type UpdateMemberBody = z.output<typeof updateMember>;
export type CreateColumnInput = z.input<typeof createColumn>;
export type CreateColumnBody = z.output<typeof createColumn>;
export type UpdateColumnInput = z.input<typeof updateColumn>;
export type UpdateColumnBody = z.output<typeof updateColumn>;
export type ReorderColumnsInput = z.input<typeof reorderColumns>;
export type ReorderColumnsBody = z.output<typeof reorderColumns>;
export type CreateCardInput = z.input<typeof createCard>;
export type CreateCardBody = z.output<typeof createCard>;
export type UpdateCardInput = z.input<typeof updateCard>;
export type UpdateCardBody = z.output<typeof updateCard>;
export type MoveCardInput = z.input<typeof moveCard>;
export type MoveCardBody = z.output<typeof moveCard>;
export type CreateLabelInput = z.input<typeof createLabel>;
export type CreateLabelBody = z.output<typeof createLabel>;
export type UpdateLabelInput = z.input<typeof updateLabel>;
export type UpdateLabelBody = z.output<typeof updateLabel>;
export type CreateSprintInput = z.input<typeof createSprint>;
export type CreateSprintBody = z.output<typeof createSprint>;
export type UpdateSprintInput = z.input<typeof updateSprint>;
export type UpdateSprintBody = z.output<typeof updateSprint>;
export type MigrateCardsInput = z.input<typeof migrateCards>;
export type MigrateCardsBody = z.output<typeof migrateCards>;
export type AddRelationInput = z.input<typeof addRelation>;
export type AddRelationBody = z.output<typeof addRelation>;
