/**
 * MenuGroup validation schemas.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/menuGroup.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the menuGroup routes.
 */
import { z } from "zod";
import { booleanish, nullableText, numeric, uuid } from "./fields";

// ==========================================
// FILTER/GET ALL MENU GROUPS
// ==========================================

const filterMenuGroupSchema = z.object({
  search: nullableText(),
  isActive: booleanish().nullable().optional(),
});

// ==========================================
// GET ASSIGNMENTS
// ==========================================

const getAssignmentsSchema = z.object({
  roleId: uuid(),
});

// ==========================================
// CREATE / UPDATE MENU GROUP
// ==========================================

const slug = z.string().min(2).max(100).or(z.literal("")).nullable().optional();

const createMenuGroupSchema = z.object({
  name: z.string().min(2).max(100),
  slug,
  icon: nullableText(50),
  parentId: uuid().nullable().optional(),
  sortOrder: numeric(z.number().int().min(0)).default(0),
  isActive: booleanish().default(true),
});

const updateMenuGroupSchema = z.object({
  id: uuid(),
  name: z.string().min(2).max(100).optional(),
  slug,
  icon: nullableText(50),
  parentId: uuid().nullable().optional(),
  sortOrder: numeric(z.number().int().min(0)).optional(),
  isActive: booleanish().optional(),
});

// ==========================================
// ASSIGN / REVOKE
// ==========================================

const assignMenuGroupSchema = z.object({
  roleId: uuid(),
  menuGroupId: uuid(),
  notes: nullableText(255),
});

const bulkAssignMenuGroupsSchema = z.object({
  roleId: uuid(),
  menuGroupIds: z.array(uuid()).min(1),
  notes: nullableText(255),
});

const revokeMenuGroupSchema = z.object({
  roleId: uuid(),
  menuGroupId: uuid(),
});

const bulkRevokeMenuGroupsSchema = z.object({
  roleId: uuid(),
  menuGroupIds: z.array(uuid()).min(1),
});

// Assign/revoke an individual menu item (as a child menu group).
const assignMenuItemSchema = z.object({
  roleId: uuid(),
  menuItemId: uuid(),
  notes: nullableText(255),
});

const revokeMenuItemSchema = z.object({
  roleId: uuid(),
  menuItemId: uuid(),
});

export {
  filterMenuGroupSchema,
  getAssignmentsSchema,
  createMenuGroupSchema,
  updateMenuGroupSchema,
  assignMenuGroupSchema,
  bulkAssignMenuGroupsSchema,
  revokeMenuGroupSchema,
  bulkRevokeMenuGroupsSchema,
  assignMenuItemSchema,
  revokeMenuItemSchema,
};

// The client-side (input) and handler-side (output) types of each schema.
export type FilterMenuGroupInput = z.input<typeof filterMenuGroupSchema>;
export type FilterMenuGroupBody = z.output<typeof filterMenuGroupSchema>;
export type GetAssignmentsInput = z.input<typeof getAssignmentsSchema>;
export type GetAssignmentsBody = z.output<typeof getAssignmentsSchema>;
export type CreateMenuGroupInput = z.input<typeof createMenuGroupSchema>;
export type CreateMenuGroupBody = z.output<typeof createMenuGroupSchema>;
export type UpdateMenuGroupInput = z.input<typeof updateMenuGroupSchema>;
export type UpdateMenuGroupBody = z.output<typeof updateMenuGroupSchema>;
export type AssignMenuGroupInput = z.input<typeof assignMenuGroupSchema>;
export type AssignMenuGroupBody = z.output<typeof assignMenuGroupSchema>;
export type BulkAssignMenuGroupsInput = z.input<typeof bulkAssignMenuGroupsSchema>;
export type BulkAssignMenuGroupsBody = z.output<typeof bulkAssignMenuGroupsSchema>;
export type RevokeMenuGroupInput = z.input<typeof revokeMenuGroupSchema>;
export type RevokeMenuGroupBody = z.output<typeof revokeMenuGroupSchema>;
export type BulkRevokeMenuGroupsInput = z.input<typeof bulkRevokeMenuGroupsSchema>;
export type BulkRevokeMenuGroupsBody = z.output<typeof bulkRevokeMenuGroupsSchema>;
export type AssignMenuItemInput = z.input<typeof assignMenuItemSchema>;
export type AssignMenuItemBody = z.output<typeof assignMenuItemSchema>;
export type RevokeMenuItemInput = z.input<typeof revokeMenuItemSchema>;
export type RevokeMenuItemBody = z.output<typeof revokeMenuItemSchema>;
