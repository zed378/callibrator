/**
 * P21-01 (spec MEMORY/specs/P19-01-inspection-catalogue.md § 8.2, § 8.4) — the catalogue's request
 * schemas: the content union refuses a limit on a `tri_state` item and an outcome outside the
 * section's set before any service runs; more than 300 items and a blank change note are 400s; the
 * proposal kinds need what each kind needs; the route forms carry their path parameter.
 */
import {
  MAX_PROPOSAL_ITEMS,
  MAX_SECTION_ITEMS,
  MAX_VERSION_ITEMS,
  acceptProposal,
  createDeviceType,
  createDraft,
  createItemDefinition,
  createProposal,
  inspectionItemContent,
  listDeviceTypesQuery,
  listItemDefinitionsQuery,
  listTemplatesQuery,
  listVersionsQuery,
  proposalItemInput,
  publishVersion,
  rejectProposal,
  rejectProposalBody,
  renameDeviceType,
  replaceDraftItems,
  replaceDraftItemsBody,
  updateItemDefinition,
  updateItemDefinitionBody,
} from "../src/inspectionCatalogue";

const ID = "c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4";
const ID2 = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const tri = { section: "function", label: "Synthetic check", inputKind: "tri_state", allowedOutcomes: ["pass", "fail"] };
const leak = { section: "electrical_safety", label: "Synthetic leak", inputKind: "measured_with_limit", unit: "µA", limitText: "≤ 100 µA", allowedOutcomes: ["pass", "fail"] };

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }): string[] =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.message);

describe("the content union (§ 5.2, § 6)", () => {
  it("accepts each kind with what it carries", () => {
    expect(inspectionItemContent.safeParse(tri).success).toBe(true);
    expect(inspectionItemContent.safeParse(leak).success).toBe(true);
    expect(inspectionItemContent.safeParse({ section: "tools_used", label: "x", inputKind: "check", allowedOutcomes: ["done", "not_done"] }).success).toBe(true);
    expect(inspectionItemContent.safeParse({ section: "physical", label: "x", inputKind: "condition_clean", allowedOutcomes: ["good"] }).success).toBe(true);
    expect(inspectionItemContent.safeParse({ section: "environment", label: "x", inputKind: "measured", unit: "°C", validMin: "-20", validMax: 80 }).success).toBe(true);
    expect(
      inspectionItemContent.safeParse({ section: "performance", label: "x", inputKind: "setting_measured_reference", unit: "bpm", settingText: "60", settingValue: "60", limitText: "± 10%", allowedOutcomes: ["pass"] }).success,
    ).toBe(true);
  });

  it("refuses a limit on a tri_state item, a setting on a measured one, and a text item with outcomes (the shape)", () => {
    expect(inspectionItemContent.safeParse({ ...tri, limitText: "≤ 1" }).success).toBe(false);
    expect(inspectionItemContent.safeParse({ section: "environment", label: "x", inputKind: "measured", unit: "°C", settingText: "1" }).success).toBe(false);
    expect(inspectionItemContent.safeParse({ section: "tools_used", label: "x", inputKind: "text", allowedOutcomes: [] }).success).toBe(false);
  });

  it("refuses outcomes outside the section's set, a unit mismatch, a bad decimal, a control character, a repeated outcome", () => {
    expect(messages(inspectionItemContent.safeParse({ ...tri, allowedOutcomes: ["good"] }))).toEqual(['"Synthetic check": good is not an outcome of the function section.']);
    expect(messages(inspectionItemContent.safeParse({ ...leak, limitText: "≤ 1 mA" }))).toEqual(['"Synthetic leak": the limit is in mA but the item records µA.']);
    expect(inspectionItemContent.safeParse({ ...leak, validMin: "1.000,5" }).success).toBe(false);
    expect(inspectionItemContent.safeParse({ ...tri, label: "bad\u0007label" }).success).toBe(false);
    expect(inspectionItemContent.safeParse({ ...tri, allowedOutcomes: ["pass", "pass"] }).success).toBe(false);
    expect(inspectionItemContent.parse({ ...tri, label: "  Two   words " }).label).toBe("Two words");
  });
});

describe("device types, the library, templates", () => {
  it("device types: names normalised, filters defaulted, the route form carries its id", () => {
    expect(createDeviceType.parse({ name: " Test   Type " })).toEqual({ name: "Test Type" });
    expect(listDeviceTypesQuery.parse({})).toEqual({ status: "active", page: 1, limit: 25 });
    expect(listDeviceTypesQuery.safeParse({ status: "deleted" }).success).toBe(false);
    expect(renameDeviceType.parse({ deviceTypeId: ID, name: "New" })).toEqual({ deviceTypeId: ID, name: "New" });
  });

  it("the library: content required to create; an edit changes at least one field", () => {
    expect(createItemDefinition.parse({ content: tri, notes: null })).toMatchObject({ notes: null });
    expect(updateItemDefinitionBody.safeParse({}).success).toBe(false);
    expect(updateItemDefinitionBody.safeParse({ defaultRequired: false }).success).toBe(true);
    expect(updateItemDefinition.safeParse({ itemDefinitionId: ID }).success).toBe(false);
    expect(updateItemDefinition.safeParse({ itemDefinitionId: ID, content: tri }).success).toBe(true);
    expect(listItemDefinitionsQuery.parse({ status: "all", section: "function", inputKind: "tri_state" })).toMatchObject({ status: "all" });
  });

  it("templates and versions: the draft source defaults to the published version; a history names its template", () => {
    expect(createDraft.parse({ templateId: ID })).toEqual({ templateId: ID, copyFrom: "published" });
    expect(listTemplatesQuery.parse({ hasDraft: "false" })).toMatchObject({ hasDraft: false });
    expect(listVersionsQuery.safeParse({}).success).toBe(false);
    expect(publishVersion.safeParse({ versionId: ID, revision: 0, changeNote: "  " }).success).toBe(false);
    expect(publishVersion.parse({ versionId: ID, revision: "2", changeNote: "Fine note" })).toEqual({ versionId: ID, revision: 2, changeNote: "Fine note" });
  });

  it("a draft's items: at most 300, each definition once, at most 60 per section (when the content says the section)", () => {
    expect(MAX_VERSION_ITEMS).toBe(300);
    expect(MAX_SECTION_ITEMS).toBe(60);
    const ids = (n: number): string[] => Array.from({ length: n }, (_v, i) => `c4c4c4c4-c4c4-4c4c-8c4c-${String(i).padStart(12, "0")}`);
    expect(replaceDraftItemsBody.safeParse({ revision: 0, items: ids(301).map((itemDefinitionId) => ({ itemDefinitionId })) }).success).toBe(false);
    expect(messages(replaceDraftItems.safeParse({ versionId: ID, revision: 0, items: [{ itemDefinitionId: ID }, { itemDefinitionId: ID }] }))).toEqual([
      "A definition appears twice in the draft",
    ]);
    expect(messages(replaceDraftItemsBody.safeParse({ revision: 0, items: ids(61).map((itemDefinitionId) => ({ itemDefinitionId, content: tri })) }))).toEqual([
      "At most 60 items in the function section",
    ]);
    expect(replaceDraftItemsBody.safeParse({ revision: 0, items: ids(61).map((itemDefinitionId) => ({ itemDefinitionId })) }).success).toBe(true);
    expect(replaceDraftItemsBody.safeParse({ revision: 0, items: ids(2).map((itemDefinitionId) => ({ itemDefinitionId, content: tri })) }).success).toBe(true);
  });
});

describe("proposals (§ 4.6, § 7.4)", () => {
  const item = { section: "function", label: "Synthetic proposed", inputKind: "tri_state" };

  it("each kind needs what it needs", () => {
    expect(MAX_PROPOSAL_ITEMS).toBe(100);
    expect(createProposal.parse({ kind: "new_device_type", proposedDeviceTypeName: "New Type", reason: "Needed" })).toMatchObject({ proposedItems: [] });
    expect(messages(createProposal.safeParse({ kind: "new_device_type", reason: "Needed" }))).toEqual([
      "A new-type proposal names the type; no other kind does",
    ]);
    expect(messages(createProposal.safeParse({ kind: "new_device_type", proposedDeviceTypeName: "N", deviceTypeId: ID, reason: "Needed" }))).toEqual([
      "Name the device type the proposal is about (not for a new type)",
    ]);
    expect(messages(createProposal.safeParse({ kind: "add_items", proposedDeviceTypeName: "N", reason: "Needed" }))).toEqual([
      "A new-type proposal names the type; no other kind does",
      "Name the device type the proposal is about (not for a new type)",
      "Propose at least one item",
    ]);
    expect(messages(createProposal.safeParse({ kind: "change_items", deviceTypeId: ID, proposedItems: [item], reason: "Needed" }))).toEqual([
      "A change or a retirement names the item it is about",
    ]);
    expect(createProposal.safeParse({ kind: "retire_items", deviceTypeId: ID, proposedItems: [{ ...item, itemDefinitionId: ID2 }], reason: "Needed" }).success).toBe(true);
    expect(createProposal.safeParse({ kind: "add_items", deviceTypeId: ID, proposedItems: [item], reason: "Needed", tenantId: ID }).success).toBe(false);
  });

  it("a proposed item's kind must suit its section", () => {
    expect(proposalItemInput.safeParse({ ...item, inputKind: "measured" }).success).toBe(false);
  });

  it("decisions: a rejection needs its note; an acceptance may name the new type", () => {
    expect(rejectProposalBody.safeParse({}).success).toBe(false);
    expect(rejectProposal.parse({ proposalId: ID, decisionNote: "No thanks" })).toEqual({ proposalId: ID, decisionNote: "No thanks" });
    expect(acceptProposal.parse({ proposalId: ID, deviceTypeId: ID2 })).toEqual({ proposalId: ID, deviceTypeId: ID2 });
  });
});
