/**
 * Ticket validator tests
 */
import type { z } from "zod";
import { checkInput } from "../../validators/input";
import {
  addComment,
  assignTicket,
  CATEGORIES,
  createTicket,
  PRIORITIES,
  STATUSES,
  updateTicket,
} from "../../validators/ticket.validator";

// P9-11: the schemas are Zod. checkInput applies them as the app does (unknown
// keys stripped, every issue listed), as the old schemas' own options did.
const check = <S extends z.ZodType>(schema: S, body: unknown) => checkInput(body, schema);

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("Ticket Validators", () => {
  describe("createTicket", () => {
    it("validates a minimal payload and applies enum defaults", () => {
      expect(check(createTicket, { subject: "Help me" })).toEqual({
        ok: true,
        value: { subject: "Help me", priority: "medium", category: "support" },
      });
    });

    it("validates a full payload", () => {
      const result = check(createTicket, {
        subject: "Broken thing",
        description: "<p>details</p>",
        priority: "urgent",
        category: "bug",
        assignedTo: UUID,
        dueDate: "2026-08-01",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.dueDate).toEqual(new Date("2026-08-01"));
      }
    });

    it("accepts a null assignedTo and empty/null description", () => {
      expect(check(createTicket, { subject: "Subj", assignedTo: null, description: null }).ok).toBe(true);
      expect(check(createTicket, { subject: "Subj", description: "" }).ok).toBe(true);
    });

    it("rejects a missing subject", () => {
      expect(check(createTicket, {})).toEqual({
        ok: false,
        errors: [{ field: "subject", message: "Invalid input: expected string, received undefined" }],
      });
    });

    it("converts a millisecond-string dueDate and accepts a null one", () => {
      const fromString = check(createTicket, { subject: "Subj", dueDate: "1700000000000" });
      expect(fromString.ok).toBe(true);
      if (fromString.ok) {
        expect(fromString.value.dueDate).toEqual(new Date(1700000000000));
      }
      const nullDate = check(createTicket, { subject: "Subj", dueDate: null });
      expect(nullDate.ok).toBe(true);
      if (nullDate.ok) {
        expect(nullDate.value.dueDate).toBeNull();
      }
    });

    it("rejects an unparseable or empty dueDate", () => {
      const bad = check(createTicket, { subject: "Subj", dueDate: "not a date" });
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        expect(bad.errors).toEqual([{ field: "dueDate", message: "Invalid input: expected date, received string" }]);
      }
      expect(check(createTicket, { subject: "Subj", dueDate: "" }).ok).toBe(false);
    });

    it("rejects an over-long description", () => {
      expect(check(createTicket, { subject: "Subj", description: "d".repeat(50001) }).ok).toBe(false);
    });

    it("strips unknown keys (tenantId, createdBy)", () => {
      const result = check(createTicket, { subject: "Subj", tenantId: "x", createdBy: "y" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("tenantId");
        expect(result.value).not.toHaveProperty("createdBy");
      }
    });

    it("rejects a too-short subject, counted after trimming", () => {
      expect(check(createTicket, { subject: "ab" }).ok).toBe(false);
      expect(check(createTicket, { subject: "  ab  " })).toEqual({
        ok: false,
        errors: [{ field: "subject", message: "Too small: expected string to have >=3 characters" }],
      });
    });

    it("rejects an invalid priority", () => {
      expect(check(createTicket, { subject: "Subject", priority: "critical" }).ok).toBe(false);
    });

    it("rejects an invalid category", () => {
      expect(check(createTicket, { subject: "Subject", category: "other" }).ok).toBe(false);
    });

    it("rejects a non-uuid assignedTo", () => {
      expect(check(createTicket, { subject: "Subject", assignedTo: "nope" }).ok).toBe(false);
    });
  });

  describe("updateTicket", () => {
    it("validates a partial update", () => {
      expect(check(updateTicket, { status: "resolved" }).ok).toBe(true);
    });

    it("rejects an empty object (min 1 field)", () => {
      expect(check(updateTicket, {})).toEqual({
        ok: false,
        errors: [{ field: "", message: "Provide at least one field to update" }],
      });
    });

    it("rejects an object whose only keys are stripped unknowns", () => {
      expect(check(updateTicket, { foo: 1 }).ok).toBe(false);
    });

    it("rejects an invalid status", () => {
      expect(check(updateTicket, { status: "frozen" })).toEqual({
        ok: false,
        errors: [{ field: "status", message: 'Invalid option: expected one of "open"|"in_progress"|"resolved"|"closed"' }],
      });
    });

    it("accepts a null assignedTo", () => {
      expect(check(updateTicket, { assignedTo: null }).ok).toBe(true);
    });
  });

  describe("assignTicket", () => {
    it("accepts a uuid assignee", () => {
      expect(check(assignTicket, { assignedTo: UUID }).ok).toBe(true);
    });

    it("accepts a null assignee (unassign)", () => {
      expect(check(assignTicket, { assignedTo: null }).ok).toBe(true);
    });

    it("requires assignedTo", () => {
      expect(check(assignTicket, {}).ok).toBe(false);
    });

    it("rejects a non-uuid assignee", () => {
      expect(check(assignTicket, { assignedTo: "nope" })).toEqual({
        ok: false,
        errors: [{ field: "assignedTo", message: "Invalid GUID" }],
      });
    });
  });

  describe("addComment", () => {
    it("validates a comment and defaults isInternal to false", () => {
      expect(check(addComment, { body: "hello" })).toEqual({
        ok: true,
        value: { body: "hello", isInternal: false },
      });
    });

    it("accepts an explicit isInternal flag", () => {
      expect(check(addComment, { body: "note", isInternal: true }).ok).toBe(true);
    });

    it("rejects an empty or blank body", () => {
      expect(check(addComment, { body: "" }).ok).toBe(false);
      expect(check(addComment, { body: "   " }).ok).toBe(false);
    });

    it("converts an isInternal string and refuses a non-boolean", () => {
      const coerced = check(addComment, { body: "x", isInternal: "true" });
      expect(coerced.ok).toBe(true);
      if (coerced.ok) {
        expect(coerced.value.isInternal).toBe(true);
      }
      expect(check(addComment, { body: "x", isInternal: "yes" }).ok).toBe(false);
    });

    it("requires a body", () => {
      expect(check(addComment, {}).ok).toBe(false);
    });
  });

  describe("exported constants", () => {
    it("exports the enum arrays", () => {
      expect(STATUSES).toEqual(["open", "in_progress", "resolved", "closed"]);
      expect(PRIORITIES).toEqual(["low", "medium", "high", "urgent"]);
      expect(CATEGORIES).toEqual(["support", "bug", "feature", "incident", "question"]);
    });
  });
});
