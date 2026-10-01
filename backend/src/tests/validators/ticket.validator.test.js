/**
 * Ticket validator tests
 */
const v = require("../../validators/ticket.validator");
const { checkInput } = require("../../validators/input");

// P9-11: the schemas are Zod. checkInput applies them as the app does (unknown
// keys stripped, every issue listed), as the old schemas' own options did.
const check = (schema, body) => checkInput(body, schema);

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Ticket Validators", () => {
  describe("createTicket", () => {
    it("validates a minimal payload and applies enum defaults", () => {
      expect(check(v.createTicket, { subject: "Help me" })).toEqual({
        ok: true,
        value: { subject: "Help me", priority: "medium", category: "support" },
      });
    });

    it("validates a full payload", () => {
      const result = check(v.createTicket, {
        subject: "Broken thing",
        description: "<p>details</p>",
        priority: "urgent",
        category: "bug",
        assignedTo: UUID,
        dueDate: "2026-08-01",
      });
      expect(result.ok).toBe(true);
      expect(result.value.dueDate).toEqual(new Date("2026-08-01"));
    });

    it("accepts a null assignedTo and empty/null description", () => {
      expect(
        check(v.createTicket, { subject: "Subj", assignedTo: null, description: null }).ok,
      ).toBe(true);
      expect(
        check(v.createTicket, { subject: "Subj", description: "" }).ok,
      ).toBe(true);
    });

    it("rejects a missing subject", () => {
      expect(check(v.createTicket, {})).toEqual({
        ok: false,
        errors: [{ field: "subject", message: "Invalid input: expected string, received undefined" }],
      });
    });

    it("converts a millisecond-string dueDate and accepts a null one", () => {
      expect(check(v.createTicket, { subject: "Subj", dueDate: "1700000000000" }).value.dueDate).toEqual(
        new Date(1700000000000),
      );
      expect(check(v.createTicket, { subject: "Subj", dueDate: null }).value.dueDate).toBeNull();
    });

    it("rejects an unparseable or empty dueDate", () => {
      expect(check(v.createTicket, { subject: "Subj", dueDate: "not a date" }).errors).toEqual([
        { field: "dueDate", message: "Invalid input: expected date, received string" },
      ]);
      expect(check(v.createTicket, { subject: "Subj", dueDate: "" }).ok).toBe(false);
    });

    it("rejects an over-long description", () => {
      expect(check(v.createTicket, { subject: "Subj", description: "d".repeat(50001) }).ok).toBe(false);
    });

    it("strips unknown keys (tenantId, createdBy)", () => {
      const result = check(v.createTicket, { subject: "Subj", tenantId: "x", createdBy: "y" });
      expect(result.ok).toBe(true);
      expect(result.value).not.toHaveProperty("tenantId");
      expect(result.value).not.toHaveProperty("createdBy");
    });

    it("rejects a too-short subject, counted after trimming", () => {
      expect(check(v.createTicket, { subject: "ab" }).ok).toBe(false);
      expect(check(v.createTicket, { subject: "  ab  " }).errors).toEqual([
        { field: "subject", message: "Too small: expected string to have >=3 characters" },
      ]);
    });

    it("rejects an invalid priority", () => {
      expect(
        check(v.createTicket, { subject: "Subject", priority: "critical" }).ok,
      ).toBe(false);
    });

    it("rejects an invalid category", () => {
      expect(
        check(v.createTicket, { subject: "Subject", category: "other" }).ok,
      ).toBe(false);
    });

    it("rejects a non-uuid assignedTo", () => {
      expect(
        check(v.createTicket, { subject: "Subject", assignedTo: "nope" }).ok,
      ).toBe(false);
    });
  });

  describe("updateTicket", () => {
    it("validates a partial update", () => {
      expect(check(v.updateTicket, { status: "resolved" }).ok).toBe(true);
    });

    it("rejects an empty object (min 1 field)", () => {
      expect(check(v.updateTicket, {})).toEqual({
        ok: false,
        errors: [{ field: "", message: "Provide at least one field to update" }],
      });
    });

    it("rejects an object whose only keys are stripped unknowns", () => {
      expect(check(v.updateTicket, { foo: 1 }).ok).toBe(false);
    });

    it("rejects an invalid status", () => {
      expect(check(v.updateTicket, { status: "frozen" }).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "open"|"in_progress"|"resolved"|"closed"' },
      ]);
    });

    it("accepts a null assignedTo", () => {
      expect(check(v.updateTicket, { assignedTo: null }).ok).toBe(true);
    });
  });

  describe("assignTicket", () => {
    it("accepts a uuid assignee", () => {
      expect(check(v.assignTicket, { assignedTo: UUID }).ok).toBe(true);
    });

    it("accepts a null assignee (unassign)", () => {
      expect(check(v.assignTicket, { assignedTo: null }).ok).toBe(true);
    });

    it("requires assignedTo", () => {
      expect(check(v.assignTicket, {}).ok).toBe(false);
    });

    it("rejects a non-uuid assignee", () => {
      expect(check(v.assignTicket, { assignedTo: "nope" })).toEqual({
        ok: false,
        errors: [{ field: "assignedTo", message: "Invalid GUID" }],
      });
    });
  });

  describe("addComment", () => {
    it("validates a comment and defaults isInternal to false", () => {
      expect(check(v.addComment, { body: "hello" })).toEqual({
        ok: true,
        value: { body: "hello", isInternal: false },
      });
    });

    it("accepts an explicit isInternal flag", () => {
      expect(check(v.addComment, { body: "note", isInternal: true }).ok).toBe(true);
    });

    it("rejects an empty or blank body", () => {
      expect(check(v.addComment, { body: "" }).ok).toBe(false);
      expect(check(v.addComment, { body: "   " }).ok).toBe(false);
    });

    it("converts an isInternal string and refuses a non-boolean", () => {
      expect(check(v.addComment, { body: "x", isInternal: "true" }).value.isInternal).toBe(true);
      expect(check(v.addComment, { body: "x", isInternal: "yes" }).ok).toBe(false);
    });

    it("requires a body", () => {
      expect(check(v.addComment, {}).ok).toBe(false);
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
