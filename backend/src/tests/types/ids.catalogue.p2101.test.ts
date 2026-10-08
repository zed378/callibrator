/**
 * P21-01 — the validating constructors of the six catalogue brands (types/ids.ts; spec P19-01
 * § 4): a UUID passes through unchanged (a brand is a type, not a value), anything else throws a
 * TypeError naming what was expected.
 */
import {
  toDeviceTypeId,
  toInspectionItemDefinitionId,
  toInspectionTemplateId,
  toInspectionTemplateItemId,
  toInspectionTemplateProposalId,
  toInspectionTemplateVersionId,
} from "../../types/ids";

const UUID = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";

describe.each([
  ["toDeviceTypeId", toDeviceTypeId, "A device type id must be a UUID"],
  ["toInspectionItemDefinitionId", toInspectionItemDefinitionId, "An item definition id must be a UUID"],
  ["toInspectionTemplateId", toInspectionTemplateId, "A template id must be a UUID"],
  ["toInspectionTemplateVersionId", toInspectionTemplateVersionId, "A template version id must be a UUID"],
  ["toInspectionTemplateItemId", toInspectionTemplateItemId, "A template item id must be a UUID"],
  ["toInspectionTemplateProposalId", toInspectionTemplateProposalId, "A proposal id must be a UUID"],
] as const)("%s", (_name, construct, message) => {
  it("passes a UUID through unchanged", () => {
    expect(construct(UUID)).toBe(UUID);
  });

  it("refuses anything else", () => {
    expect(() => construct("not-a-uuid")).toThrow(new TypeError(message));
  });
});
