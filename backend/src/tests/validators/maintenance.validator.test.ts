/**
 * Maintenance validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input),
 * which answers { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 * The formatErrors cases now live with fieldErrors (session.validator.test.js).
 */
import { checkInput } from "../../validators/input";
import { createWorkOrder, updateWorkOrder } from "../../validators/maintenance.validator";

const DEVICE = "123e4567-e89b-12d3-a456-426614174000";
const BASE = { deviceId: DEVICE, title: "Annual Calibration", type: "Preventative" };

describe("Maintenance Validators", () => {
  describe("createWorkOrder", () => {
    it("should validate correct work order", () => {
      const result = checkInput(BASE, createWorkOrder);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.title).toBe("Annual Calibration");
        expect(result.value.type).toBe("Preventative");
      }
    });

    it("should validate with default priority", () => {
      const result = checkInput(BASE, createWorkOrder);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.priority).toBe("Medium");
      }
    });

    it("should validate with default status", () => {
      const result = checkInput(BASE, createWorkOrder);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("Open");
      }
    });

    it("should validate with all priority levels", () => {
      for (const priority of ["Low", "Medium", "High", "Critical"]) {
        const result = checkInput({ ...BASE, title: "Test", priority }, createWorkOrder);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.priority).toBe(priority);
        }
      }
    });

    it("should validate with all types", () => {
      for (const type of ["Preventative", "Breakdown", "Repair"]) {
        const result = checkInput({ ...BASE, title: "Test", type }, createWorkOrder);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.type).toBe(type);
        }
      }
    });

    it("should validate with all statuses", () => {
      for (const status of ["Open", "InProgress", "Completed", "Cancelled"]) {
        const result = checkInput({ ...BASE, title: "Test", status }, createWorkOrder);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.status).toBe(status);
        }
      }
    });

    it("should validate with optional fields", () => {
      const result = checkInput(
        {
          ...BASE,
          vendorId: "123e4567-e89b-12d3-a456-426614174001",
          assigneeId: "123e4567-e89b-12d3-a456-426614174002",
          description: "Full calibration check",
          scheduledDate: "2026-08-01",
          estimatedCost: 500,
        },
        createWorkOrder,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.scheduledDate).toEqual(new Date("2026-08-01T00:00:00.000Z"));
        expect(result.value.estimatedCost).toBe(500);
      }
    });

    it("should validate with null vendor and assignee (and other nullable fields)", () => {
      const result = checkInput(
        { ...BASE, vendorId: null, assigneeId: null, scheduledDate: null, estimatedCost: null, description: null },
        createWorkOrder,
      );

      expect(result.ok).toBe(true);
    });

    it("should trim title and description, and convert a numeric-string cost", () => {
      const result = checkInput(
        { ...BASE, title: "  t  ", description: "  d  ", estimatedCost: "12.5" },
        createWorkOrder,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatchObject({ title: "t", description: "d", estimatedCost: 12.5 });
      }
    });

    it("should strip unknown keys (tenantId is never read from a body)", () => {
      const result = checkInput({ ...BASE, tenantId: DEVICE }, createWorkOrder);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toHaveProperty("tenantId");
      }
    });

    it("should reject missing device ID", () => {
      const result = checkInput({ title: "Annual Calibration", type: "Preventative" }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "deviceId", message: "Invalid input: expected string, received undefined" },
        ]);
      }
    });

    it("should reject missing title", () => {
      const result = checkInput({ deviceId: DEVICE, type: "Preventative" }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "title", message: "Invalid input: expected string, received undefined" },
        ]);
      }
    });

    it("should reject a blank title", () => {
      const result = checkInput({ ...BASE, title: "   " }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "title", message: "Too small: expected string to have >=1 characters" },
        ]);
      }
    });

    it("should reject missing type", () => {
      const result = checkInput({ deviceId: DEVICE, title: "Annual Calibration" }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
        ]);
      }
    });

    it("should reject invalid type", () => {
      const result = checkInput({ ...BASE, type: "Inspection" }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
        ]);
      }
    });

    it("should reject a non-ISO scheduledDate", () => {
      const result = checkInput({ ...BASE, scheduledDate: "08/01/2026" }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: "scheduledDate", message: "Invalid input" }]);
      }
    });

    it("should reject negative estimated cost", () => {
      const result = checkInput({ ...BASE, estimatedCost: -100 }, createWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "estimatedCost", message: "Too small: expected number to be >=0" },
        ]);
      }
    });
  });

  describe("updateWorkOrder", () => {
    it("should validate with partial update", () => {
      expect(checkInput({ status: "Completed" }, updateWorkOrder)).toEqual({
        ok: true,
        value: { status: "Completed" },
      });
    });

    it("should validate with all fields", () => {
      const result = checkInput(
        {
          title: "Updated Title",
          vendorId: "123e4567-e89b-12d3-a456-426614174001",
          assigneeId: "123e4567-e89b-12d3-a456-426614174002",
          type: "Breakdown",
          priority: "High",
          status: "InProgress",
          description: "Updated description",
          scheduledDate: "2026-08-01",
          completedDate: "2026-08-15",
          estimatedCost: 500,
          actualCost: 450,
          resolutionNotes: "Fixed the issue",
        },
        updateWorkOrder,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.completedDate).toEqual(new Date("2026-08-15T00:00:00.000Z"));
      }
    });

    it("should validate with null values", () => {
      const result = checkInput(
        {
          vendorId: null,
          assigneeId: null,
          scheduledDate: null,
          completedDate: null,
          actualCost: null,
          resolutionNotes: "",
        },
        updateWorkOrder,
      );

      expect(result.ok).toBe(true);
    });

    it("should reject invalid status update", () => {
      const result = checkInput({ status: "Pending" }, updateWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "status", message: 'Invalid option: expected one of "Open"|"InProgress"|"Completed"|"Cancelled"' },
        ]);
      }
    });

    it("should reject invalid type update", () => {
      const result = checkInput({ type: "Inspection" }, updateWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
        ]);
      }
    });

    it("should reject negative actual cost", () => {
      const result = checkInput({ actualCost: -100 }, updateWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([{ field: "actualCost", message: "Too small: expected number to be >=0" }]);
      }
    });

    it("should reject an empty title", () => {
      const result = checkInput({ title: "" }, updateWorkOrder);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual([
          { field: "title", message: "Too small: expected string to have >=1 characters" },
        ]);
      }
    });
  });
});
