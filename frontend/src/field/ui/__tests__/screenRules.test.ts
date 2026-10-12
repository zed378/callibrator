/**
 * P22-10c2 — the pure parts of the field screens:
 *  - the checklist: the version for a device type or by id, the print order, and the answers read
 *    back from the stored `ipmResultInput` rows — a ROUND TRIP through P22-03's `resultInputs` for
 *    every input kind and an ad-hoc row (so a capture re-opened offline re-sends the same rows);
 *  - the outbox: every § 9.6 answer's explanation and its actions;
 *  - the register's create body: a bound user's carries no QR and no facility (ADR-132);
 *  - the navigation: unknown views read as home, links carry id / ref.
 */
import { resultInputs, newAdHoc, EMPTY_ANSWER, type CaptureState } from "@/app/(app)/dashboard/ipm/capture";
import type { Attention } from "../../engine/model";
import { versionById, versionFor, type PublishedVersion } from "../screens/checklist";
import { sortedItems, stateFromInputs } from "../screens/captureState";
import { actionsOf, explanationOf, EXPLAINED_CODES } from "../screens/OutboxScreen";
import { deviceBody } from "../screens/RegisterScreen";
import { hrefOf, parseRoute } from "../nav";
import type { PublishedCatalogue } from "../fieldStore";

const item = (id: string, section: string, inputKind: string, sortOrder: number) =>
  ({
    id,
    itemDefinitionId: `def-${id}`,
    origin: "base",
    section,
    label: id,
    inputKind,
    unit: null,
    symbol: null,
    settingText: null,
    settingValue: null,
    limitOp: null,
    limitValue: null,
    limitLow: null,
    limitHigh: null,
    limitNominal: null,
    limitTolerance: null,
    limitText: null,
    validMin: null,
    validMax: null,
    warnMin: null,
    warnMax: null,
    allowedOutcomes: [],
    required: false,
    sortOrder,
  }) as unknown as PublishedVersion["items"][number];

const catalogue = {
  schema: "inspection-catalogue-v1",
  deviceTypes: [],
  versions: [
    { id: "v1", templateId: "t", deviceTypeId: "type-1", versionNumber: 1, baseVersionId: null, contentHash: null, publishedAt: null, items: [item("b", "function", "check", 2), item("a", "function", "check", 1), item("e", "environment", "measured", 9)] },
  ],
} as unknown as PublishedCatalogue;

describe("checklist", () => {
  it("finds the version by device type and by id; none for an unknown or null one", () => {
    expect(versionFor(catalogue, "type-1")?.id).toBe("v1");
    expect(versionFor(catalogue, "type-2")).toBeNull();
    expect(versionFor(catalogue, null)).toBeNull();
    expect(versionFor(null, "type-1")).toBeNull();
    expect(versionById(catalogue, "v1")?.id).toBe("v1");
    expect(versionById(catalogue, "v9")).toBeNull();
    expect(versionById(catalogue, null)).toBeNull();
    expect(versionById(null, "v1")).toBeNull();
  });

  it("orders items by section, then their own order", () => {
    expect(sortedItems(versionById(catalogue, "v1") as PublishedVersion).map((i) => i.id)).toEqual(["e", "a", "b"]);
  });

  it("reads the stored rows back so that resultInputs gives the same rows (every kind, an ad-hoc row)", () => {
    const items = [
      item("c", "function", "check", 1),
      item("t", "function", "tri_state", 2),
      item("cc", "physical", "condition_clean", 3),
      item("m", "environment", "measured", 4),
      item("mna", "environment", "measured", 5),
      item("ml", "electrical_safety", "measured_with_limit", 6),
      item("mlna", "electrical_safety", "measured_with_limit", 7),
      item("s", "performance", "setting_measured_reference", 8),
      item("x", "function", "text", 9),
    ];
    const state: CaptureState = {
      answers: {
        c: { ...EMPTY_ANSWER, outcome: "done" },
        t: { ...EMPTY_ANSWER, outcome: "pass" },
        cc: { ...EMPTY_ANSWER, outcome: "good", cleanliness: "clean" },
        m: { ...EMPTY_ANSWER, value: "21,5" },
        mna: { ...EMPTY_ANSWER, notApplicable: true },
        ml: { ...EMPTY_ANSWER, value: "50", outcome: "pass" },
        mlna: { ...EMPTY_ANSWER, notApplicable: true },
        s: { ...EMPTY_ANSWER, value1: "10", value2: "10.2", outcome: "pass" },
        x: { ...EMPTY_ANSWER, text: "note" },
      },
      adHoc: [{ ...newAdHoc("tools_used", "k1"), label: "Analyser", unit: "V", settingText: "s", referenceText: "r", answer: { ...EMPTY_ANSWER, text: "SN-1" } }],
    };
    const rows = resultInputs(items as never, state);
    const back = stateFromInputs(rows);
    expect(resultInputs(items as never, back)).toEqual(rows);
    expect(back.adHoc[0]).toMatchObject({ section: "tools_used", label: "Analyser", unit: "V", settingText: "s", referenceText: "r" });
  });

  it("tolerates rows without the optional parts (no adHoc block, odd values)", () => {
    const back = stateFromInputs([null, { inputKind: "text", adHoc: undefined }, { inputKind: "check", templateItemId: "i", outcome: 3, cleanliness: "muddy" }]);
    expect(back.adHoc).toHaveLength(2);
    expect(back.adHoc[0]?.label).toBe("");
    expect(back.answers["i"]).toMatchObject({ outcome: null, cleanliness: null, value: "" });
  });
});

describe("outbox — § 9.6", () => {
  const at = (status: number, code: string | null = null): Attention => ({ status, code, message: "", draftId: null, opKind: "create", previousState: "submitted_local" });

  it("explains every listed code by its own key, else by status", () => {
    for (const code of EXPLAINED_CODES) expect(explanationOf(at(409, code))).toBe(`field.conflict.${code}`);
    expect(explanationOf(at(409, "SOMETHING_ELSE"))).toBe("field.conflict.other");
    expect(explanationOf(at(404))).toBe("field.conflict.notFound");
    expect(explanationOf(at(403))).toBe("field.conflict.forbidden");
    expect(explanationOf(at(413))).toBe("field.conflict.photo");
    expect(explanationOf(at(415))).toBe("field.conflict.photo");
    expect(explanationOf(at(400))).toBe("field.conflict.invalid");
    expect(explanationOf(at(0))).toBe("field.conflict.other");
  });

  it("offers the actions each answer allows", () => {
    expect(actionsOf(at(409, "IPM_DRAFT_EXISTS"))).toEqual(["use_server_draft"]);
    expect(actionsOf(at(409, "IPM_REVISION_CONFLICT"))).toEqual(["keep_mine"]);
    expect(actionsOf(at(409, "IDEMPOTENCY_SCOPE_CHANGED"))).toEqual(["retry"]);
    expect(actionsOf(at(409, "IDEMPOTENCY_KEY_REUSED"))).toEqual(["retry"]);
    expect(actionsOf(at(400))).toEqual(["edit"]);
    expect(actionsOf(at(413))).toEqual(["edit"]);
    expect(actionsOf(at(415))).toEqual(["edit"]);
    expect(actionsOf(at(502))).toEqual(["retry"]);
    expect(actionsOf(at(0))).toEqual(["retry"]);
    expect(actionsOf(at(404))).toEqual([]);
    expect(actionsOf(at(409, "IPM_NOT_DRAFT"))).toEqual([]);
  });
});

describe("register — the create body", () => {
  const draft = { name: " Pump ", manufacturer: "", model: "M", serialNumber: " SN ", qrCode: "RS1", deviceTypeId: "", clientFacilityId: "f1", locationId: "", condition: "" };
  it("an unbound user's carries the QR and the facility; empty fields are null or absent", () => {
    expect(deviceBody(draft, false)).toEqual({ name: "Pump", serialNumber: "SN", manufacturer: null, model: "M", deviceTypeId: null, qrCode: "RS1", clientFacilityId: "f1" });
    expect(deviceBody({ ...draft, clientFacilityId: "", locationId: "r1", condition: "good" }, false)).toEqual({
      name: "Pump",
      serialNumber: "SN",
      manufacturer: null,
      model: "M",
      deviceTypeId: null,
      locationId: "r1",
      condition: "good",
      qrCode: "RS1",
    });
  });
  it("a bound user's carries neither", () => {
    expect(deviceBody(draft, true)).toEqual({ name: "Pump", serialNumber: "SN", manufacturer: null, model: "M", deviceTypeId: null });
  });
});

describe("navigation", () => {
  it("reads the view, id and ref; an unknown view is home; links carry what is given", () => {
    expect(parseRoute("?view=device&id=d1")).toEqual({ view: "device", id: "d1", ref: null });
    expect(parseRoute("?view=nope")).toEqual({ view: "home", id: null, ref: null });
    expect(parseRoute("")).toEqual({ view: "home", id: null, ref: null });
    expect(hrefOf("capture", { ref: "l1" })).toBe("/field?view=capture&ref=l1");
    expect(hrefOf("home")).toBe("/field?view=home");
  });
});
