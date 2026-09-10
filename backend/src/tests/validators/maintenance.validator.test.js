/**
 * Maintenance validator tests
 */
const {
  createWorkOrder,
  updateWorkOrder,
  validate,
  formatErrors,
} = require("../../validators/maintenance.validator");

describe("Maintenance Validators", () => {
  describe("createWorkOrder", () => {
    it("should validate correct work order", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
      };

      const { error, value } = validate(data, createWorkOrder);

      expect(error).toBeUndefined();
      expect(value.title).toBe("Annual Calibration");
      expect(value.type).toBe("Preventative");
    });

    it("should validate with default priority", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
      };

      const { error, value } = validate(data, createWorkOrder);

      expect(error).toBeUndefined();
      expect(value.priority).toBe("Medium");
    });

    it("should validate with default status", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
      };

      const { error, value } = validate(data, createWorkOrder);

      expect(error).toBeUndefined();
      expect(value.status).toBe("Open");
    });

    it("should validate with all priority levels", () => {
      const priorities = ["Low", "Medium", "High", "Critical"];

      for (const priority of priorities) {
        const data = {
          deviceId: "123e4567-e89b-12d3-a456-426614174000",
          title: "Test",
          type: "Preventative",
          priority,
        };

        const { error } = validate(data, createWorkOrder);
        expect(error).toBeUndefined();
      }
    });

    it("should validate with all types", () => {
      const types = ["Preventative", "Breakdown", "Repair"];

      for (const type of types) {
        const data = {
          deviceId: "123e4567-e89b-12d3-a456-426614174000",
          title: "Test",
          type,
        };

        const { error } = validate(data, createWorkOrder);
        expect(error).toBeUndefined();
      }
    });

    it("should validate with all statuses", () => {
      const statuses = ["Open", "InProgress", "Completed", "Cancelled"];

      for (const status of statuses) {
        const data = {
          deviceId: "123e4567-e89b-12d3-a456-426614174000",
          title: "Test",
          type: "Preventative",
          status,
        };

        const { error } = validate(data, createWorkOrder);
        expect(error).toBeUndefined();
      }
    });

    it("should validate with optional fields", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
        vendorId: "123e4567-e89b-12d3-a456-426614174001",
        assigneeId: "123e4567-e89b-12d3-a456-426614174002",
        description: "Full calibration check",
        scheduledDate: "2026-08-01",
        estimatedCost: 500,
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeUndefined();
    });

    it("should validate with null vendor and assignee", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
        vendorId: null,
        assigneeId: null,
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeUndefined();
    });

    it("should reject missing device ID", () => {
      const data = {
        title: "Annual Calibration",
        type: "Preventative",
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject missing title", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        type: "Preventative",
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject missing type", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject invalid type", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Inspection",
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject negative estimated cost", () => {
      const data = {
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        title: "Annual Calibration",
        type: "Preventative",
        estimatedCost: -100,
      };

      const { error } = validate(data, createWorkOrder);

      expect(error).toBeDefined();
    });
  });

  describe("updateWorkOrder", () => {
    it("should validate with partial update", () => {
      const data = {
        status: "Completed",
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeUndefined();
    });

    it("should validate with all fields", () => {
      const data = {
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
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeUndefined();
    });

    it("should validate with null values", () => {
      const data = {
        vendorId: null,
        assigneeId: null,
        scheduledDate: null,
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeUndefined();
    });

    it("should reject invalid status update", () => {
      const data = {
        status: "Pending",
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject invalid type update", () => {
      const data = {
        type: "Inspection",
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeDefined();
    });

    it("should reject negative actual cost", () => {
      const data = {
        actualCost: -100,
      };

      const { error } = validate(data, updateWorkOrder);

      expect(error).toBeDefined();
    });
  });

  describe("formatErrors", () => {
    it("should format error details correctly", () => {
      const details = [
        { path: ["tenantId"], message: "tenantId is required" },
        { path: ["email"], message: "Invalid email" },
      ];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "tenantId", message: "tenantId is required" },
        { field: "email", message: "Invalid email" },
      ]);
    });

    it("should handle nested field paths", () => {
      const details = [{ path: ["user", "name"], message: "Name is required" }];

      const result = formatErrors(details);

      expect(result).toEqual([
        { field: "user.name", message: "Name is required" },
      ]);
    });

    it("should return empty array for empty input", () => {
      const result = formatErrors([]);

      expect(result).toEqual([]);
    });
  });
});
