/**
 * Kanban validator tests
 */
const v = require("../../validators/kanban.validator");

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID2 = "223e4567-e89b-12d3-a456-426614174000";

describe("Kanban Validators", () => {
  describe("createProject", () => {
    it("should validate minimal project data", () => {
      const { error, value } = v.createProject.validate({ name: "Board" });
      expect(error).toBeUndefined();
      expect(value.members).toEqual([]);
    });

    it("should validate a full project payload with members", () => {
      const { error } = v.createProject.validate({
        name: "Board",
        code: "MGT",
        description: "desc",
        color: "#fff",
        members: [{ userId: UUID, accessLevel: "editor" }],
      });
      expect(error).toBeUndefined();
    });

    it("should reject missing name", () => {
      const { error } = v.createProject.validate({});
      expect(error).toBeDefined();
    });

    it("should reject a code with invalid characters", () => {
      const { error } = v.createProject.validate({ name: "Board", code: "BAD CODE!" });
      expect(error).toBeDefined();
    });

    it("should allow null/empty code", () => {
      expect(v.createProject.validate({ name: "Board", code: null }).error).toBeUndefined();
      expect(v.createProject.validate({ name: "Board", code: "" }).error).toBeUndefined();
    });
  });

  describe("updateProject", () => {
    it("should validate partial data", () => {
      expect(v.updateProject.validate({ archived: true }).error).toBeUndefined();
    });

    it("should reject a bad code", () => {
      expect(v.updateProject.validate({ code: "no good" }).error).toBeDefined();
    });
  });

  describe("memberSchema (addMember)", () => {
    it("should accept exactly userId", () => {
      expect(v.addMember.validate({ userId: UUID }).error).toBeUndefined();
    });

    it("should accept exactly roleId", () => {
      expect(v.addMember.validate({ roleId: UUID }).error).toBeUndefined();
    });

    it("should reject both userId and roleId (xor)", () => {
      expect(v.addMember.validate({ userId: UUID, roleId: UUID2 }).error).toBeDefined();
    });

    it("should reject neither userId nor roleId (xor)", () => {
      expect(v.addMember.validate({ accessLevel: "editor" }).error).toBeDefined();
    });

    it("should default accessLevel to viewer", () => {
      const { value } = v.addMember.validate({ userId: UUID });
      expect(value.accessLevel).toBe("viewer");
    });

    it("should reject an invalid accessLevel", () => {
      expect(v.addMember.validate({ userId: UUID, accessLevel: "admin" }).error).toBeDefined();
    });
  });

  describe("updateMember", () => {
    it("should require a valid accessLevel", () => {
      expect(v.updateMember.validate({ accessLevel: "owner" }).error).toBeUndefined();
      expect(v.updateMember.validate({}).error).toBeDefined();
      expect(v.updateMember.validate({ accessLevel: "nope" }).error).toBeDefined();
    });
  });

  describe("createColumn / updateColumn", () => {
    it("should validate a column", () => {
      expect(v.createColumn.validate({ name: "To Do", wipLimit: 5 }).error).toBeUndefined();
    });
    it("should reject a missing name on create", () => {
      expect(v.createColumn.validate({}).error).toBeDefined();
    });
    it("should allow a null wipLimit", () => {
      expect(v.createColumn.validate({ name: "X", wipLimit: null }).error).toBeUndefined();
    });
    it("should validate a partial update", () => {
      expect(v.updateColumn.validate({ position: 2 }).error).toBeUndefined();
    });
  });

  describe("reorderColumns", () => {
    it("should validate a non-empty list of uuids", () => {
      expect(v.reorderColumns.validate({ order: [UUID, UUID2] }).error).toBeUndefined();
    });
    it("should reject an empty list", () => {
      expect(v.reorderColumns.validate({ order: [] }).error).toBeDefined();
    });
    it("should reject non-uuid entries", () => {
      expect(v.reorderColumns.validate({ order: ["nope"] }).error).toBeDefined();
    });
  });

  describe("createCard (sprintRef alternatives)", () => {
    it("should accept a uuid sprintId", () => {
      expect(
        v.createCard.validate({ columnId: UUID, title: "T", sprintId: UUID2 }).error,
      ).toBeUndefined();
    });
    it("should accept 'backlog'", () => {
      expect(
        v.createCard.validate({ columnId: UUID, title: "T", sprintId: "backlog" }).error,
      ).toBeUndefined();
    });
    it("should accept null sprintId", () => {
      expect(
        v.createCard.validate({ columnId: UUID, title: "T", sprintId: null }).error,
      ).toBeUndefined();
    });
    it("should reject an arbitrary string sprintId", () => {
      expect(
        v.createCard.validate({ columnId: UUID, title: "T", sprintId: "whatever" }).error,
      ).toBeDefined();
    });
    it("should require columnId and title", () => {
      expect(v.createCard.validate({ title: "T" }).error).toBeDefined();
      expect(v.createCard.validate({ columnId: UUID }).error).toBeDefined();
    });
    it("should default assigneeIds/labelIds", () => {
      const { value } = v.createCard.validate({ columnId: UUID, title: "T" });
      expect(value.assigneeIds).toEqual([]);
      expect(value.labelIds).toEqual([]);
    });
    it("should reject an invalid priority", () => {
      expect(
        v.createCard.validate({ columnId: UUID, title: "T", priority: "critical" }).error,
      ).toBeDefined();
    });
  });

  describe("updateCard", () => {
    it("should validate a partial card update", () => {
      expect(v.updateCard.validate({ title: "New" }).error).toBeUndefined();
    });
    it("should accept assigneeIds replacement", () => {
      expect(v.updateCard.validate({ assigneeIds: [UUID] }).error).toBeUndefined();
    });
  });

  describe("moveCard", () => {
    it("should require columnId and position", () => {
      expect(v.moveCard.validate({ columnId: UUID, position: 0 }).error).toBeUndefined();
      expect(v.moveCard.validate({ columnId: UUID }).error).toBeDefined();
    });
  });

  describe("createLabel / updateLabel", () => {
    it("should validate a label", () => {
      expect(v.createLabel.validate({ name: "bug", color: "#f00" }).error).toBeUndefined();
    });
    it("should reject a missing name on create", () => {
      expect(v.createLabel.validate({}).error).toBeDefined();
    });
    it("should validate a partial label update", () => {
      expect(v.updateLabel.validate({ color: null }).error).toBeUndefined();
    });
  });

  describe("createSprint / updateSprint", () => {
    it("should validate a sprint with default status", () => {
      const { error, value } = v.createSprint.validate({ name: "S1" });
      expect(error).toBeUndefined();
      expect(value.status).toBe("planned");
    });
    it("should reject an invalid status", () => {
      expect(v.createSprint.validate({ name: "S1", status: "frozen" }).error).toBeDefined();
    });
    it("should validate a partial sprint update", () => {
      expect(v.updateSprint.validate({ status: "active" }).error).toBeUndefined();
    });
  });

  describe("migrateCards (.or)", () => {
    it("should accept cardIds", () => {
      expect(
        v.migrateCards.validate({ cardIds: [UUID], targetSprintId: "backlog" }).error,
      ).toBeUndefined();
    });
    it("should accept allNotDone", () => {
      expect(
        v.migrateCards.validate({ allNotDone: true, targetSprintId: UUID }).error,
      ).toBeUndefined();
    });
    it("should reject when neither cardIds nor allNotDone given", () => {
      expect(v.migrateCards.validate({ targetSprintId: "backlog" }).error).toBeDefined();
    });
    it("should require targetSprintId", () => {
      expect(v.migrateCards.validate({ allNotDone: true }).error).toBeDefined();
    });
    it("should accept a fromSprintId sprintRef", () => {
      expect(
        v.migrateCards.validate({
          allNotDone: true,
          fromSprintId: null,
          targetSprintId: UUID,
        }).error,
      ).toBeUndefined();
    });
  });

  describe("addRelation", () => {
    it("should validate a relation", () => {
      expect(
        v.addRelation.validate({ targetCardId: UUID, type: "blocks" }).error,
      ).toBeUndefined();
    });
    it("should reject an invalid relation type", () => {
      expect(
        v.addRelation.validate({ targetCardId: UUID, type: "supersedes" }).error,
      ).toBeDefined();
    });
    it("should require targetCardId", () => {
      expect(v.addRelation.validate({ type: "blocks" }).error).toBeDefined();
    });
  });

  describe("exported constants", () => {
    it("should export the enum arrays", () => {
      expect(v.ACCESS_LEVELS).toEqual(["owner", "editor", "viewer"]);
      expect(v.PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
      expect(v.SPRINT_STATUSES).toEqual(["planned", "active", "completed"]);
      expect(v.RELATION_TYPES).toEqual([
        "relates_to",
        "duplicates",
        "blocks",
        "blocked_by",
        "parent_of",
        "child_of",
      ]);
    });
  });
});
