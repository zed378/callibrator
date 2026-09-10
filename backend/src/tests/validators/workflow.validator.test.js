/**
 * Workflow validator tests
 */
const {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
} = require("../../validators/workflow.validator");

describe("Workflow Validators", () => {
  describe("createWorkflowSchema", () => {
    it("should validate correct workflow", () => {
      const data = {
        name: "Approval Workflow",
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const { error, value } = {
        error: null,
        value: createWorkflowSchema.validate(data, {
          abortEarly: false,
          stripUnknown: true,
        }).value,
      };

      // Using Joi directly
      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
      expect(value.name).toBe("Approval Workflow");
    });

    it("should validate with all resource types", () => {
      const resourceTypes = [
        "Certificate",
        "StockTransfer",
        "MaintenanceWorkOrder",
      ];

      for (const resourceType of resourceTypes) {
        const data = {
          name: "Workflow",
          resourceType,
          steps: [
            {
              stepOrder: 1,
              roleId: "123e4567-e89b-12d3-a456-426614174000",
            },
          ],
        };

        const result = createWorkflowSchema.validate(data, {
          abortEarly: false,
          stripUnknown: true,
        });

        expect(result.error).toBeUndefined();
      }
    });

    it("should validate with isActive true", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        isActive: true,
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with isActive false", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        isActive: false,
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with required approvals", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
            requiredApprovals: 3,
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with multiple steps", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
          {
            stepOrder: 2,
            roleId: "123e4567-e89b-12d3-a456-426614174001",
          },
          {
            stepOrder: 3,
            roleId: "123e4567-e89b-12d3-a456-426614174002",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should reject missing name", () => {
      const data = {
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject missing resourceType", () => {
      const data = {
        name: "Workflow",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject invalid resourceType", () => {
      const data = {
        name: "Workflow",
        resourceType: "InvalidType",
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject missing steps", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject empty steps array", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject step missing stepOrder", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [
          {
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject step missing roleId", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject step with invalid roleId UUID", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [
          {
            stepOrder: 1,
            roleId: "not-a-uuid",
          },
        ],
      };

      const result = createWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });
  });

  describe("updateWorkflowSchema", () => {
    it("should validate with partial update", () => {
      const data = {
        name: "Updated Name",
      };

      const result = updateWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with isActive update", () => {
      const data = {
        isActive: false,
      };

      const result = updateWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with steps update", () => {
      const data = {
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
          },
        ],
      };

      const result = updateWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with all fields", () => {
      const data = {
        name: "Updated Name",
        isActive: true,
        steps: [
          {
            stepOrder: 1,
            roleId: "123e4567-e89b-12d3-a456-426614174000",
            requiredApprovals: 2,
          },
        ],
      };

      const result = updateWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should reject invalid isActive value", () => {
      const data = {
        isActive: "yes",
      };

      const result = updateWorkflowSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });
  });

  describe("submitActionSchema", () => {
    it("should validate APPROVED action", () => {
      const data = {
        action: "APPROVED",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate REJECTED action", () => {
      const data = {
        action: "REJECTED",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with empty comments", () => {
      const data = {
        action: "APPROVED",
        comments: "",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with null comments", () => {
      const data = {
        action: "APPROVED",
        comments: null,
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should validate with actual comments", () => {
      const data = {
        action: "APPROVED",
        comments: "Looks good to me",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeUndefined();
    });

    it("should reject missing action", () => {
      const data = {
        comments: "Some comment",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });

    it("should reject invalid action", () => {
      const data = {
        action: "PENDING",
      };

      const result = submitActionSchema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
      });

      expect(result.error).toBeDefined();
    });
  });
});
