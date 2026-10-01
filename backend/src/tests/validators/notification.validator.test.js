/**
 * Notification validator tests
 *
 * P9-11 (ADR-093): the module's own validate/formatErrors helpers are gone;
 * the one schema it exports (deleteManySchema) is exercised through the
 * shared checkInput helper, with the two messages the bulk-delete UI shows.
 */
const { deleteManySchema } = require("../../validators/notification.validator");
const { checkInput } = require("../../validators/input");

const UUID = "8c352a92-d6cf-4b71-b0db-6e69622d1b11";

describe("Notification Validators", () => {
  describe("deleteManySchema", () => {
    it("should accept a list of uuids and return it", () => {
      const result = checkInput({ ids: [UUID] }, deleteManySchema);
      expect(result).toEqual({ ok: true, value: { ids: [UUID] } });
    });

    it("should strip unknown keys", () => {
      const result = checkInput({ ids: [UUID], extra: 1 }, deleteManySchema);
      expect(result.ok).toBe(true);
      expect(result.value).not.toHaveProperty("extra");
    });

    it("should say 'ids is required' when ids is missing", () => {
      expect(checkInput({}, deleteManySchema)).toEqual({
        ok: false,
        errors: [{ field: "ids", message: "ids is required" }],
      });
    });

    it("should say 'ids is required' for an absent body", () => {
      expect(checkInput(undefined, deleteManySchema).errors).toEqual([
        { field: "ids", message: "ids is required" },
      ]);
    });

    it("should refuse an empty list with the UI message", () => {
      expect(checkInput({ ids: [] }, deleteManySchema).errors).toEqual([
        { field: "ids", message: "Select at least one notification to delete" },
      ]);
    });

    it("should keep the default type message for a non-array ids", () => {
      expect(checkInput({ ids: "x" }, deleteManySchema).errors).toEqual([
        { field: "ids", message: "Invalid input: expected array, received string" },
      ]);
    });

    it("should refuse a non-uuid id at its index", () => {
      expect(checkInput({ ids: ["bad"] }, deleteManySchema).errors).toEqual([
        { field: "ids.0", message: "Invalid GUID" },
      ]);
    });

    it("should refuse more than 500 ids", () => {
      expect(checkInput({ ids: Array(501).fill(UUID) }, deleteManySchema).errors).toEqual([
        { field: "ids", message: "Too big: expected array to have <=500 items" },
      ]);
    });
  });
});
