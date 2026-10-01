/**
 * Kanban validator tests
 *
 * P9-11 (ADR-093): the schemas are Zod. The old `schema.validate(x)` is gone;
 * they are exercised through the shared checkInput (validators/input), which
 * answers { ok: true, value } or { ok: false, errors: [{ field, message }] }
 * and always strips unknown keys (as the old schemas' own options did).
 */
const v = require("../../validators/kanban.validator");
const { checkInput } = require("../../validators/input");

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";
const REQUIRED = "Invalid input: expected string, received undefined";
const EXACTLY_ONE = "Provide exactly one of userId, roleId";
const ACCESS_OPTIONS = 'Invalid option: expected one of "owner"|"editor"|"viewer"';

/**
 * @param {import("zod").ZodType} schema - the schema
 * @param {unknown} data - the input
 * @returns {unknown} the parsed value (fails the test on a refusal)
 */
const valid = (schema, data) => {
  const result = checkInput(data, schema);
  expect(result.errors).toBeUndefined();
  return result.value;
};

/**
 * @param {import("zod").ZodType} schema - the schema
 * @param {unknown} data - the input
 * @returns {Array<{field: string, message: string}>} the field errors (fails the test on an acceptance)
 */
const errorsOf = (schema, data) => {
  const result = checkInput(data, schema);
  expect(result.ok).toBe(false);
  return result.errors;
};

describe("Kanban Validators", () => {
  describe("createProject", () => {
    it("should validate minimal project data", () => {
      expect(valid(v.createProject, { name: "Board" })).toEqual({ name: "Board", members: [] });
    });

    it("should validate a full project payload with members", () => {
      const value = valid(v.createProject, {
        name: "Board",
        code: "MGT",
        description: "desc",
        color: "#fff",
        members: [{ userId: UUID, accessLevel: "editor" }],
      });
      expect(value.members).toEqual([{ userId: UUID, accessLevel: "editor" }]);
    });

    it("should default a member's accessLevel, and trim the code (description is not trimmed)", () => {
      const value = valid(v.createProject, {
        name: "  Board  ",
        code: "  MGT  ",
        description: "  x  ",
        members: [{ roleId: UUID }],
      });
      expect(value).toEqual({ name: "Board", code: "MGT", description: "  x  ", members: [{ roleId: UUID, accessLevel: "viewer" }] });
    });

    it("should reject missing name", () => {
      expect(errorsOf(v.createProject, {})).toEqual([{ field: "name", message: REQUIRED }]);
    });

    it("should reject a blank name", () => {
      expect(errorsOf(v.createProject, { name: "   " })).toEqual([
        { field: "name", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject a code with invalid characters", () => {
      expect(errorsOf(v.createProject, { name: "Board", code: "BAD CODE!" })).toEqual([
        { field: "code", message: "code may contain letters and digits only" },
      ]);
    });

    it("should reject a code over 12 characters", () => {
      expect(errorsOf(v.createProject, { name: "Board", code: "ABCDEFGHIJKLM" })).toEqual([
        { field: "code", message: "Too big: expected string to have <=12 characters" },
      ]);
    });

    it("should allow null/empty code, a blank code trimming to empty", () => {
      expect(valid(v.createProject, { name: "Board", code: null }).code).toBeNull();
      expect(valid(v.createProject, { name: "Board", code: "" }).code).toBe("");
      expect(valid(v.createProject, { name: "Board", code: "   " }).code).toBe("");
    });

    it("should refuse a member naming both or neither of userId / roleId, at the member's index", () => {
      expect(errorsOf(v.createProject, { name: "Board", members: [{ userId: UUID, roleId: UUID2 }] })).toEqual([
        { field: "members.0", message: EXACTLY_ONE },
      ]);
      expect(errorsOf(v.createProject, { name: "Board", members: [{}] })).toEqual([
        { field: "members.0", message: EXACTLY_ONE },
      ]);
    });
  });

  describe("updateProject", () => {
    it("should validate partial data", () => {
      expect(valid(v.updateProject, { archived: true })).toEqual({ archived: true });
    });

    it("should convert a boolean string", () => {
      expect(valid(v.updateProject, { archived: "false" })).toEqual({ archived: false });
    });

    it("should reject a bad code", () => {
      expect(errorsOf(v.updateProject, { code: "no good" })).toEqual([
        { field: "code", message: "code may contain letters and digits only" },
      ]);
    });
  });

  describe("memberSchema (addMember)", () => {
    it("should accept exactly userId", () => {
      expect(valid(v.addMember, { userId: UUID })).toEqual({ userId: UUID, accessLevel: "viewer" });
    });

    it("should accept exactly roleId", () => {
      expect(valid(v.addMember, { roleId: UUID })).toEqual({ roleId: UUID, accessLevel: "viewer" });
    });

    it("should reject both userId and roleId (xor)", () => {
      expect(errorsOf(v.addMember, { userId: UUID, roleId: UUID2 })).toEqual([{ field: "", message: EXACTLY_ONE }]);
    });

    it("should reject neither userId nor roleId (xor)", () => {
      expect(errorsOf(v.addMember, { accessLevel: "editor" })).toEqual([{ field: "", message: EXACTLY_ONE }]);
    });

    it("should default accessLevel to viewer", () => {
      expect(valid(v.addMember, { userId: UUID }).accessLevel).toBe("viewer");
    });

    it("should reject an invalid accessLevel", () => {
      expect(errorsOf(v.addMember, { userId: UUID, accessLevel: "admin" })).toEqual([
        { field: "accessLevel", message: ACCESS_OPTIONS },
      ]);
    });

    it("should reject a null userId", () => {
      expect(errorsOf(v.addMember, { userId: null })).toEqual([
        { field: "userId", message: "Invalid input: expected string, received null" },
      ]);
    });
  });

  describe("updateMember", () => {
    it("should require a valid accessLevel", () => {
      expect(valid(v.updateMember, { accessLevel: "owner" })).toEqual({ accessLevel: "owner" });
      expect(errorsOf(v.updateMember, {})).toEqual([{ field: "accessLevel", message: ACCESS_OPTIONS }]);
      expect(errorsOf(v.updateMember, { accessLevel: "nope" })).toEqual([{ field: "accessLevel", message: ACCESS_OPTIONS }]);
    });
  });

  describe("createColumn / updateColumn", () => {
    it("should validate a column", () => {
      expect(valid(v.createColumn, { name: "To Do", wipLimit: 5 })).toEqual({ name: "To Do", wipLimit: 5 });
    });
    it("should reject a missing name on create", () => {
      expect(errorsOf(v.createColumn, {})).toEqual([{ field: "name", message: REQUIRED }]);
    });
    it("should allow a null wipLimit", () => {
      expect(valid(v.createColumn, { name: "X", wipLimit: null }).wipLimit).toBeNull();
    });
    it("should convert numeric strings", () => {
      expect(valid(v.createColumn, { name: "X", position: "3", wipLimit: "2" })).toEqual({ name: "X", position: 3, wipLimit: 2 });
    });
    it("should reject a zero wipLimit", () => {
      expect(errorsOf(v.createColumn, { name: "X", wipLimit: 0 })).toEqual([
        { field: "wipLimit", message: "Too small: expected number to be >=1" },
      ]);
    });
    it("should validate a partial update", () => {
      expect(valid(v.updateColumn, { position: 2 })).toEqual({ position: 2 });
    });
    it("should reject a negative position on update", () => {
      expect(errorsOf(v.updateColumn, { position: -1 })).toEqual([
        { field: "position", message: "Too small: expected number to be >=0" },
      ]);
    });
  });

  describe("reorderColumns", () => {
    it("should validate a non-empty list of uuids", () => {
      expect(valid(v.reorderColumns, { order: [UUID, UUID2] })).toEqual({ order: [UUID, UUID2] });
    });
    it("should reject an empty list", () => {
      expect(errorsOf(v.reorderColumns, { order: [] })).toEqual([
        { field: "order", message: "Too small: expected array to have >=1 items" },
      ]);
    });
    it("should reject non-uuid entries", () => {
      expect(errorsOf(v.reorderColumns, { order: ["nope"] })).toEqual([{ field: "order.0", message: "Invalid GUID" }]);
    });
  });

  describe("createCard (sprintRef alternatives)", () => {
    it("should accept a uuid sprintId", () => {
      expect(valid(v.createCard, { columnId: UUID, title: "T", sprintId: UUID2 }).sprintId).toBe(UUID2);
    });
    it("should accept 'backlog'", () => {
      expect(valid(v.createCard, { columnId: UUID, title: "T", sprintId: "backlog" }).sprintId).toBe("backlog");
    });
    it("should accept null sprintId", () => {
      expect(valid(v.createCard, { columnId: UUID, title: "T", sprintId: null }).sprintId).toBeNull();
    });
    it("should reject an arbitrary string sprintId", () => {
      expect(errorsOf(v.createCard, { columnId: UUID, title: "T", sprintId: "whatever" })).toEqual([
        { field: "sprintId", message: "Invalid GUID" },
      ]);
    });
    it("should require columnId and title", () => {
      expect(errorsOf(v.createCard, { title: "T" })).toEqual([{ field: "columnId", message: REQUIRED }]);
      expect(errorsOf(v.createCard, { columnId: UUID })).toEqual([{ field: "title", message: REQUIRED }]);
    });
    it("should default assigneeIds/labelIds", () => {
      const value = valid(v.createCard, { columnId: UUID, title: "T" });
      expect(value.assigneeIds).toEqual([]);
      expect(value.labelIds).toEqual([]);
    });
    it("should parse a dueDate and allow null priority / empty description", () => {
      const value = valid(v.createCard, { columnId: UUID, title: "T", priority: null, dueDate: "2026-01-01", description: "" });
      expect(value.dueDate).toEqual(new Date("2026-01-01T00:00:00.000Z"));
      expect(value.priority).toBeNull();
    });
    it("should reject an unparseable dueDate", () => {
      expect(errorsOf(v.createCard, { columnId: UUID, title: "T", dueDate: "nope" })).toEqual([
        { field: "dueDate", message: "Invalid input: expected date, received string" },
      ]);
    });
    it("should reject an invalid priority", () => {
      expect(errorsOf(v.createCard, { columnId: UUID, title: "T", priority: "critical" })).toEqual([
        { field: "priority", message: 'Invalid option: expected one of "low"|"medium"|"high"|"urgent"' },
      ]);
    });
  });

  describe("updateCard", () => {
    it("should validate a partial card update", () => {
      expect(valid(v.updateCard, { title: "New" })).toEqual({ title: "New" });
    });
    it("should accept assigneeIds replacement", () => {
      expect(valid(v.updateCard, { assigneeIds: [UUID] })).toEqual({ assigneeIds: [UUID] });
    });
    it("should reject a non-uuid assignee", () => {
      expect(errorsOf(v.updateCard, { assigneeIds: ["x"] })).toEqual([{ field: "assigneeIds.0", message: "Invalid GUID" }]);
    });
  });

  describe("moveCard", () => {
    it("should require columnId and position", () => {
      expect(valid(v.moveCard, { columnId: UUID, position: 0 })).toEqual({ columnId: UUID, position: 0 });
      expect(errorsOf(v.moveCard, { columnId: UUID })).toEqual([
        { field: "position", message: "Invalid input: expected number, received undefined" },
      ]);
    });
    it("should convert a numeric-string position", () => {
      expect(valid(v.moveCard, { columnId: UUID, position: "2" }).position).toBe(2);
    });
  });

  describe("createLabel / updateLabel", () => {
    it("should validate a label", () => {
      expect(valid(v.createLabel, { name: "bug", color: "#f00" })).toEqual({ name: "bug", color: "#f00" });
    });
    it("should reject a missing name on create", () => {
      expect(errorsOf(v.createLabel, {})).toEqual([{ field: "name", message: REQUIRED }]);
    });
    it("should validate a partial label update", () => {
      expect(valid(v.updateLabel, { color: null })).toEqual({ color: null });
    });
    it("should reject an empty name on update", () => {
      expect(errorsOf(v.updateLabel, { name: "" })).toEqual([
        { field: "name", message: "Too small: expected string to have >=1 characters" },
      ]);
    });
  });

  describe("createSprint / updateSprint", () => {
    it("should validate a sprint with default status", () => {
      expect(valid(v.createSprint, { name: "S1" })).toEqual({ name: "S1", status: "planned" });
    });
    it("should parse dates and allow an empty goal", () => {
      const value = valid(v.createSprint, { name: "S1", startDate: "2026-01-01", endDate: null, goal: "", position: 1 });
      expect(value.startDate).toEqual(new Date("2026-01-01T00:00:00.000Z"));
      expect(value.endDate).toBeNull();
    });
    it("should reject an invalid status", () => {
      expect(errorsOf(v.createSprint, { name: "S1", status: "frozen" })).toEqual([
        { field: "status", message: 'Invalid option: expected one of "planned"|"active"|"completed"' },
      ]);
    });
    it("should validate a partial sprint update", () => {
      expect(valid(v.updateSprint, { status: "active" })).toEqual({ status: "active" });
    });
  });

  describe("migrateCards (.or)", () => {
    it("should accept cardIds", () => {
      expect(valid(v.migrateCards, { cardIds: [UUID], targetSprintId: "backlog" })).toEqual({
        cardIds: [UUID],
        targetSprintId: "backlog",
      });
    });
    it("should accept allNotDone", () => {
      expect(valid(v.migrateCards, { allNotDone: true, targetSprintId: UUID })).toEqual({ allNotDone: true, targetSprintId: UUID });
    });
    it("should accept allNotDone: false (present counts) and a boolean string", () => {
      expect(valid(v.migrateCards, { allNotDone: false, targetSprintId: null }).allNotDone).toBe(false);
      expect(valid(v.migrateCards, { allNotDone: "true", targetSprintId: null }).allNotDone).toBe(true);
    });
    it("should reject when neither cardIds nor allNotDone given", () => {
      expect(errorsOf(v.migrateCards, { targetSprintId: "backlog" })).toEqual([
        { field: "", message: "Provide cardIds or allNotDone" },
      ]);
    });
    it("should require targetSprintId", () => {
      expect(errorsOf(v.migrateCards, { allNotDone: true })).toEqual([{ field: "targetSprintId", message: "Invalid input" }]);
    });
    it("should accept a fromSprintId sprintRef", () => {
      expect(valid(v.migrateCards, { allNotDone: true, fromSprintId: null, targetSprintId: UUID }).fromSprintId).toBeNull();
    });
  });

  describe("addRelation", () => {
    it("should validate a relation", () => {
      expect(valid(v.addRelation, { targetCardId: UUID, type: "blocks" })).toEqual({ targetCardId: UUID, type: "blocks" });
    });
    it("should reject an invalid relation type", () => {
      expect(errorsOf(v.addRelation, { targetCardId: UUID, type: "supersedes" })).toEqual([
        {
          field: "type",
          message: 'Invalid option: expected one of "relates_to"|"duplicates"|"blocks"|"blocked_by"|"parent_of"|"child_of"',
        },
      ]);
    });
    it("should require targetCardId", () => {
      expect(errorsOf(v.addRelation, { type: "blocks" })).toEqual([{ field: "targetCardId", message: REQUIRED }]);
    });
  });

  describe("exported constants", () => {
    it("should export the enum arrays", () => {
      expect(v.ACCESS_LEVELS).toEqual(["owner", "editor", "viewer"]);
      expect(v.PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
      expect(v.SPRINT_STATUSES).toEqual(["planned", "active", "completed"]);
      expect(v.RELATION_TYPES).toEqual(["relates_to", "duplicates", "blocks", "blocked_by", "parent_of", "child_of"]);
    });
  });
});
