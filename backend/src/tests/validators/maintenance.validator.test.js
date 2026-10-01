/**
 * Maintenance validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the schemas are exercised through the shared checkInput (validators/input),
 * which answers { ok: true, value } or { ok: false, errors: [{ field, message }] }.
 * The formatErrors cases now live with fieldErrors (session.validator.test.js).
 */
const { createWorkOrder, updateWorkOrder } = require("../../validators/maintenance.validator");
const { checkInput } = require("../../validators/input");

const DEVICE = "123e4567-e89b-12d3-a456-426614174000";
const BASE = { deviceId: DEVICE, title: "Annual Calibration", type: "Preventative" };

describe("Maintenance Validators", () => {
  describe("createWorkOrder", () => {
    it("should validate correct work order", () => {
      const result = checkInput(BASE, createWorkOrder);

      expect(result.ok).toBe(true);
      expect(result.value.title).toBe("Annual Calibration");
      expect(result.value.type).toBe("Preventative");
    });

    it("should validate with default priority", () => {
      expect(checkInput(BASE, createWorkOrder).value.priority).toBe("Medium");
    });

    it("should validate with default status", () => {
      expect(checkInput(BASE, createWorkOrder).value.status).toBe("Open");
    });

    it("should validate with all priority levels", () => {
      for (const priority of ["Low", "Medium", "High", "Critical"]) {
        expect(checkInput({ ...BASE, title: "Test", priority }, createWorkOrder).value.priority).toBe(priority);
      }
    });

    it("should validate with all types", () => {
      for (const type of ["Preventative", "Breakdown", "Repair"]) {
        expect(checkInput({ ...BASE, title: "Test", type }, createWorkOrder).value.type).toBe(type);
      }
    });

    it("should validate with all statuses", () => {
      for (const status of ["Open", "InProgress", "Completed", "Cancelled"]) {
        expect(checkInput({ ...BASE, title: "Test", status }, createWorkOrder).value.status).toBe(status);
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
      expect(result.value.scheduledDate).toEqual(new Date("2026-08-01T00:00:00.000Z"));
      expect(result.value.estimatedCost).toBe(500);
    });

    it("should validate with null vendor and assignee (and other nullable fields)", () => {
      const result = checkInput(
        { ...BASE, vendorId: null, assigneeId: null, scheduledDate: null, estimatedCost: null, description: null },
        createWorkOrder,
      );

      expect(result.ok).toBe(true);
    });

    it("should trim title and description, and convert a numeric-string cost", () => {
      const result = checkInput({ ...BASE, title: "  t  ", description: "  d  ", estimatedCost: "12.5" }, createWorkOrder);

      expect(result.value).toMatchObject({ title: "t", description: "d", estimatedCost: 12.5 });
    });

    it("should strip unknown keys (tenantId is never read from a body)", () => {
      expect(checkInput({ ...BASE, tenantId: DEVICE }, createWorkOrder).value).not.toHaveProperty("tenantId");
    });

    it("should reject missing device ID", () => {
      expect(checkInput({ title: "Annual Calibration", type: "Preventative" }, createWorkOrder).errors).toEqual([
        { field: "deviceId", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject missing title", () => {
      expect(checkInput({ deviceId: DEVICE, type: "Preventative" }, createWorkOrder).errors).toEqual([
        { field: "title", message: "Invalid input: expected string, received undefined" },
      ]);
    });

    it("should reject a blank title", () => {
      expect(checkInput({ ...BASE, title: "   " }, createWorkOrder).errors).toEqual([
        { field: "title", message: "Too small: expected string to have >=1 characters" },
      ]);
    });

    it("should reject missing type", () => {
      expect(checkInput({ deviceId: DEVICE, title: "Annual Calibration" }, createWorkOrder).errors).toEqual([
        { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
      ]);
    });

    it("should reject invalid type", () => {
      expect(checkInput({ ...BASE, type: "Inspection" }, createWorkOrder).errors).toEqual([
        { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
      ]);
    });

    it("should reject a non-ISO scheduledDate", () => {
      expect(checkInput({ ...BASE, scheduledDate: "08/01/2026" }, createWorkOrder).errors).toEqual([
        { field: "scheduledDate", message: "Invalid input" },
      ]);
    });

    it("should reject negative estimated cost", () => {
      expect(checkInput({ ...BASE, estimatedCost: -100 }, createWorkOrder).errors).toEqual([
        { field: "estimatedCost", message: "Too small: expected number to be >=0" },
      ]);
    });
  });

  describe("updateWorkOrder", () => {
    it("should validate with partial update", () => {
      expect(checkInput({ status: "Completed" }, updateWorkOrder)).toEqual({ ok: true, value: { status: "Completed" } });
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
      expect(result.value.completedDate).toEqual(new Date("2026-08-15T00:00:00.000Z"));
    });

    it("should validate with null values", () => {
      const result = checkInput(
        { vendorId: null, assigneeId: null, scheduledDate: null, completedDate: null, actualCost: null, resolutionNotes: "" },
        updateWorkOrder,
      );

      expect(result.ok).toBe(true);
    });

    it("should reject invalid status update", () => {
      expect(checkInput({ status: "Pending" }, updateWorkOrder).errors).toEqual([
        { field: "status", message: 'Invalid option: expected one of "Open"|"InProgress"|"Completed"|"Cancelled"' },
      ]);
    });

    it("should reject invalid type update", () => {
      expect(checkInput({ type: "Inspection" }, updateWorkOrder).errors).toEqual([
        { field: "type", message: 'Invalid option: expected one of "Preventative"|"Breakdown"|"Repair"' },
      ]);
    });

    it("should reject negative actual cost", () => {
      expect(checkInput({ actualCost: -100 }, updateWorkOrder).errors).toEqual([
        { field: "actualCost", message: "Too small: expected number to be >=0" },
      ]);
    });

    it("should reject an empty title", () => {
      expect(checkInput({ title: "" }, updateWorkOrder).errors).toEqual([
        { field: "title", message: "Too small: expected string to have >=1 characters" },
      ]);
    });
  });
});
