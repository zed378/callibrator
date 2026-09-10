/**
 * Ticket validator tests
 */
const v = require("../../validators/ticket.validator");

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Ticket Validators", () => {
  describe("createTicket", () => {
    it("validates a minimal payload and applies enum defaults", () => {
      const { error, value } = v.createTicket.validate({ subject: "Help me" });
      expect(error).toBeUndefined();
      expect(value.priority).toBe("medium");
      expect(value.category).toBe("support");
    });

    it("validates a full payload", () => {
      const { error } = v.createTicket.validate({
        subject: "Broken thing",
        description: "<p>details</p>",
        priority: "urgent",
        category: "bug",
        assignedTo: UUID,
        dueDate: "2026-08-01",
      });
      expect(error).toBeUndefined();
    });

    it("accepts a null assignedTo and empty/null description", () => {
      expect(
        v.createTicket.validate({ subject: "Subj", assignedTo: null, description: null }).error,
      ).toBeUndefined();
      expect(
        v.createTicket.validate({ subject: "Subj", description: "" }).error,
      ).toBeUndefined();
    });

    it("rejects a missing subject", () => {
      expect(v.createTicket.validate({}).error).toBeDefined();
    });

    it("rejects a too-short subject", () => {
      expect(v.createTicket.validate({ subject: "ab" }).error).toBeDefined();
    });

    it("rejects an invalid priority", () => {
      expect(
        v.createTicket.validate({ subject: "Subject", priority: "critical" }).error,
      ).toBeDefined();
    });

    it("rejects an invalid category", () => {
      expect(
        v.createTicket.validate({ subject: "Subject", category: "other" }).error,
      ).toBeDefined();
    });

    it("rejects a non-uuid assignedTo", () => {
      expect(
        v.createTicket.validate({ subject: "Subject", assignedTo: "nope" }).error,
      ).toBeDefined();
    });
  });

  describe("updateTicket", () => {
    it("validates a partial update", () => {
      expect(v.updateTicket.validate({ status: "resolved" }).error).toBeUndefined();
    });

    it("rejects an empty object (min 1 field)", () => {
      expect(v.updateTicket.validate({}).error).toBeDefined();
    });

    it("rejects an invalid status", () => {
      expect(v.updateTicket.validate({ status: "frozen" }).error).toBeDefined();
    });

    it("accepts a null assignedTo", () => {
      expect(v.updateTicket.validate({ assignedTo: null }).error).toBeUndefined();
    });
  });

  describe("assignTicket", () => {
    it("accepts a uuid assignee", () => {
      expect(v.assignTicket.validate({ assignedTo: UUID }).error).toBeUndefined();
    });

    it("accepts a null assignee (unassign)", () => {
      expect(v.assignTicket.validate({ assignedTo: null }).error).toBeUndefined();
    });

    it("requires assignedTo", () => {
      expect(v.assignTicket.validate({}).error).toBeDefined();
    });

    it("rejects a non-uuid assignee", () => {
      expect(v.assignTicket.validate({ assignedTo: "nope" }).error).toBeDefined();
    });
  });

  describe("addComment", () => {
    it("validates a comment and defaults isInternal to false", () => {
      const { error, value } = v.addComment.validate({ body: "hello" });
      expect(error).toBeUndefined();
      expect(value.isInternal).toBe(false);
    });

    it("accepts an explicit isInternal flag", () => {
      expect(v.addComment.validate({ body: "note", isInternal: true }).error).toBeUndefined();
    });

    it("rejects an empty body", () => {
      expect(v.addComment.validate({ body: "" }).error).toBeDefined();
    });

    it("requires a body", () => {
      expect(v.addComment.validate({}).error).toBeDefined();
    });
  });

  describe("exported constants", () => {
    it("exports the enum arrays", () => {
      expect(v.STATUSES).toEqual(["open", "in_progress", "resolved", "closed"]);
      expect(v.PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
      expect(v.CATEGORIES).toEqual([
        "support",
        "bug",
        "feature",
        "incident",
        "question",
      ]);
    });
  });
});
