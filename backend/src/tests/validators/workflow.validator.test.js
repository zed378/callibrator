/**
 * Workflow validator tests
 */
const {
  createWorkflowSchema,
  updateWorkflowSchema,
  submitActionSchema,
} = require("../../validators/workflow.validator");
const { checkInput } = require("../../validators/input");

// P9-11: the schemas are Zod. `run` checks through the shared checkInput
// (strip-unknown, every issue listed, as the old options here were) and
// answers in the old `{ error, value }` shape, with `error` the
// `{ field, message }` list.
const run = (schema, data) => {
  const result = checkInput(data, schema);
  return result.ok ? { error: undefined, value: result.value } : { error: result.errors, value: undefined };
};

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

      const result = run(createWorkflowSchema, data);

      expect(result.error).toBeUndefined();
      expect(result.value).toEqual(data);
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

        const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should convert numeric-string step numbers and strip unknown step keys", () => {
      const result = run(createWorkflowSchema, {
        name: "W",
        resourceType: "Certificate",
        isActive: "true",
        steps: [{ stepOrder: "2", roleId: "123e4567-e89b-12d3-a456-426614174000", requiredApprovals: "3", extra: 1 }],
      });

      expect(result.error).toBeUndefined();
      expect(result.value).toEqual({
        name: "W",
        resourceType: "Certificate",
        isActive: true,
        steps: [{ stepOrder: 2, roleId: "123e4567-e89b-12d3-a456-426614174000", requiredApprovals: 3 }],
      });
    });

    it("should list every missing top-level field", () => {
      expect(run(createWorkflowSchema, {}).error).toEqual([
        { field: "name", message: "Invalid input: expected string, received undefined" },
        {
          field: "resourceType",
          message: 'Invalid option: expected one of "Certificate"|"StockTransfer"|"MaintenanceWorkOrder"',
        },
        { field: "steps", message: "Invalid input: expected array, received undefined" },
      ]);
    });

    it("should reject an empty name", () => {
      const result = run(createWorkflowSchema, {
        name: "",
        resourceType: "Certificate",
        steps: [{ stepOrder: 1, roleId: "123e4567-e89b-12d3-a456-426614174000" }],
      });

      expect(result.error).toEqual([{ field: "name", message: "Too small: expected string to have >=1 characters" }]);
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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

      expect(result.error).toBeDefined();
    });

    it("should reject missing steps", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
      };

      const result = run(createWorkflowSchema, data);

      expect(result.error).toBeDefined();
    });

    it("should reject empty steps array", () => {
      const data = {
        name: "Workflow",
        resourceType: "Certificate",
        steps: [],
      };

      const result = run(createWorkflowSchema, data);

      expect(result.error).toEqual([{ field: "steps", message: "Too small: expected array to have >=1 items" }]);
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

      const result = run(createWorkflowSchema, data);

      expect(result.error).toEqual([
        { field: "steps.0.stepOrder", message: "Invalid input: expected number, received undefined" },
      ]);
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

      const result = run(createWorkflowSchema, data);

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

      const result = run(createWorkflowSchema, data);

      expect(result.error).toEqual([{ field: "steps.0.roleId", message: "Invalid GUID" }]);
    });

    it("should reject step numbers below 1, with each step path", () => {
      const result = run(createWorkflowSchema, {
        name: "W",
        resourceType: "Certificate",
        steps: [{ stepOrder: 0, roleId: "123e4567-e89b-12d3-a456-426614174000", requiredApprovals: 0 }],
      });

      expect(result.error).toEqual([
        { field: "steps.0.stepOrder", message: "Too small: expected number to be >=1" },
        { field: "steps.0.requiredApprovals", message: "Too small: expected number to be >=1" },
      ]);
    });
  });

  describe("updateWorkflowSchema", () => {
    it("should validate with partial update", () => {
      const data = {
        name: "Updated Name",
      };

      const result = run(updateWorkflowSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with isActive update", () => {
      const data = {
        isActive: false,
      };

      const result = run(updateWorkflowSchema, data);

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

      const result = run(updateWorkflowSchema, data);

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

      const result = run(updateWorkflowSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should convert a boolean string, and accept an empty patch", () => {
      expect(run(updateWorkflowSchema, { isActive: "false" }).value).toEqual({ isActive: false });
      expect(run(updateWorkflowSchema, {}).value).toEqual({});
    });

    it("should reject an empty steps array or an empty name", () => {
      expect(run(updateWorkflowSchema, { steps: [] }).error).toBeDefined();
      expect(run(updateWorkflowSchema, { name: "" }).error).toBeDefined();
    });

    it("should reject invalid isActive value", () => {
      const data = {
        isActive: "yes",
      };

      const result = run(updateWorkflowSchema, data);

      expect(result.error).toBeDefined();
    });
  });

  describe("submitActionSchema", () => {
    it("should validate APPROVED action", () => {
      const data = {
        action: "APPROVED",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate REJECTED action", () => {
      const data = {
        action: "REJECTED",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with empty comments", () => {
      const data = {
        action: "APPROVED",
        comments: "",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with null comments", () => {
      const data = {
        action: "APPROVED",
        comments: null,
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should validate with actual comments", () => {
      const data = {
        action: "APPROVED",
        comments: "Looks good to me",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeUndefined();
    });

    it("should reject missing action", () => {
      const data = {
        comments: "Some comment",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toBeDefined();
    });

    it("should reject invalid action", () => {
      const data = {
        action: "PENDING",
      };

      const result = run(submitActionSchema, data);

      expect(result.error).toEqual([
        { field: "action", message: 'Invalid option: expected one of "APPROVED"|"REJECTED"' },
      ]);
    });

    it("should reject a lower-case action", () => {
      expect(run(submitActionSchema, { action: "approved" }).error).toBeDefined();
    });

    it("should accept the A-182 re-authentication fields", () => {
      const data = {
        action: "APPROVED",
        authMethod: "password",
        authPayload: "pw",
        meaning: "Approved by me",
      };

      expect(run(submitActionSchema, data)).toEqual({ error: undefined, value: data });
    });

    it("should reject an unknown authMethod and empty authPayload or meaning", () => {
      expect(run(submitActionSchema, { action: "APPROVED", authMethod: "sms" }).error).toEqual([
        { field: "authMethod", message: 'Invalid option: expected one of "password"|"mfa"' },
      ]);
      expect(run(submitActionSchema, { action: "APPROVED", authPayload: "" }).error).toBeDefined();
      expect(run(submitActionSchema, { action: "APPROVED", meaning: "" }).error).toBeDefined();
      expect(run(submitActionSchema, { action: "APPROVED", meaning: "m".repeat(256) }).error).toEqual([
        { field: "meaning", message: "Too big: expected string to have <=255 characters" },
      ]);
    });

    it("should not trim comments", () => {
      expect(run(submitActionSchema, { action: "APPROVED", comments: "  hi  " }).value.comments).toBe("  hi  ");
    });
  });
});
