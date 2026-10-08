/**
 * P21-03 (ADR-126 Am. 4; P19-02 spec § 9.4, § 10.3, § 17) — the IPM session contracts: the 409
 * codes, `normaliseResult` (the one implementation the server and the offline client share), and
 * the strict request schemas (FT-91: no server-owned field accepted).
 */
import {
  IDEMPOTENCY_CONFLICT_CODES,
  IPM_CONFLICT_CODES,
  IPM_MAX_AD_HOC_RESULTS,
  IPM_MAX_RESULTS,
  normaliseResult,
  type NormalisableItem,
} from "@callibrator/contracts/inspectionValues";
import {
  AD_HOC_SECTIONS,
  UUID_V4,
  deviceIpmSessionsQuery,
  fieldWipe,
  ipmResultInput,
  ipmResultsReplace,
  ipmSessionCorrection,
  ipmSessionCreate,
  ipmSessionHeaderUpdate,
  ipmSessionListQuery,
} from "@callibrator/contracts/inspectionSessions";

const ID = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

const item = (over: Partial<NormalisableItem>): NormalisableItem => ({
  section: "function",
  label: "Synthetic check",
  inputKind: "tri_state",
  limitOp: null,
  allowedOutcomes: [],
  ...over,
});

const leakage = item({
  section: "electrical_safety",
  label: "Synthetic leakage",
  inputKind: "measured_with_limit",
  limitOp: "lte",
  limitValue: "100",
  limitText: "≤ 100 µA",
  validMin: "0",
  validMax: "10000",
  warnMax: "80",
  allowedOutcomes: ["pass", "fail", "not_applicable"],
});

const pressure = item({
  section: "performance",
  label: "Synthetic pressure",
  inputKind: "setting_measured_reference",
  limitOp: "plus_minus",
  settingValue: "120",
  limitTolerance: "3",
  allowedOutcomes: ["pass", "fail"],
});

describe("P21-03 — the codes", () => {
  it("IPM_CONFLICT_CODES and IDEMPOTENCY_CONFLICT_CODES, in the spec's order", () => {
    expect(IPM_CONFLICT_CODES).toEqual([
      "IPM_DEVICE_RETIRED",
      "IPM_DEVICE_INACTIVE",
      "IPM_FACILITY_ENDED",
      "IPM_VERSION_RETIRED",
      "IPM_VERSION_STALE",
      "IPM_NO_CHECKLIST",
      "IPM_DRAFT_EXISTS",
      "IPM_CLIENT_REF_REUSED",
      "IPM_REVISION_CONFLICT",
      "IPM_NOT_DRAFT",
      "IPM_NOT_SUBMITTED",
      "IPM_VOIDED",
      "IPM_SUPERSEDED",
      "IPM_CORRECTION_OPEN",
      "IPM_ORIGINAL_NOT_EFFECTIVE",
    ]);
    expect(IDEMPOTENCY_CONFLICT_CODES).toEqual(["IDEMPOTENCY_IN_FLIGHT", "IDEMPOTENCY_KEY_REUSED", "IDEMPOTENCY_SCOPE_CHANGED"]);
    expect(Object.isFrozen(IPM_CONFLICT_CODES)).toBe(true);
    expect([IPM_MAX_RESULTS, IPM_MAX_AD_HOC_RESULTS]).toEqual([400, 100]);
  });
});

describe("normaliseResult (spec § 9.4)", () => {
  it("refuses another kind than the item's", () => {
    expect(normaliseResult(item({}), { inputKind: "check", outcome: "done" })).toEqual({
      ok: false,
      problem: '"Synthetic check" is a tri_state item, not check.',
    });
  });

  it("check / tri_state: the outcome must be allowed (the item's, else the section's)", () => {
    expect(normaliseResult(item({ allowedOutcomes: ["pass", "fail"] }), { inputKind: "tri_state", outcome: "not_applicable" })).toEqual({
      ok: false,
      problem: '"Synthetic check" cannot be answered "not_applicable"; choose one of: pass, fail.',
    });
    const answered = normaliseResult(item({}), { inputKind: "tri_state", outcome: "not_applicable" });
    expect(answered).toMatchObject({ ok: true, result: { outcome: "not_applicable", outcomeSource: "technician" } });
    expect(normaliseResult(item({ section: "tools_used", inputKind: "check" }), { inputKind: "check" })).toMatchObject({
      ok: true,
      result: { outcome: null, outcomeSource: null },
    });
  });

  it("condition_clean keeps the cleanliness in its own field (fixes 09 L-3)", () => {
    const physical = item({ section: "physical", inputKind: "condition_clean" });
    expect(normaliseResult(physical, { inputKind: "condition_clean", outcome: "minor_damage", cleanliness: "dirty" })).toMatchObject({
      ok: true,
      result: { outcome: "minor_damage", cleanliness: "dirty" },
    });
    expect(normaliseResult(physical, { inputKind: "condition_clean" })).toMatchObject({ ok: true, result: { cleanliness: null } });
  });

  it("text: trimmed, empty is null", () => {
    const text = item({ inputKind: "text" });
    expect(normaliseResult(text, { inputKind: "text", text: "  Synthetic  " })).toMatchObject({ ok: true, result: { textValue: "Synthetic" } });
    expect(normaliseResult(text, { inputKind: "text", text: "   " })).toMatchObject({ ok: true, result: { textValue: null } });
    expect(normaliseResult(text, { inputKind: "text" })).toMatchObject({ ok: true, result: { textValue: null } });
  });

  it("measured: a decimal comma is read, grouping is refused, the hard range is 400, the warn range flags", () => {
    const temperature = item({ section: "environment", label: "Synthetic temperature", inputKind: "measured", validMin: "-20", validMax: "80", warnMin: "15", warnMax: "30" });
    expect(normaliseResult(temperature, { inputKind: "measured", value: "25,5" })).toMatchObject({ ok: true, result: { measuredValue: "25.5", warnFlag: false } });
    expect(normaliseResult(temperature, { inputKind: "measured", value: 31 })).toMatchObject({ ok: true, result: { measuredValue: "31", warnFlag: true } });
    expect(normaliseResult(temperature, { inputKind: "measured", value: "10" })).toMatchObject({ ok: true, result: { warnFlag: true } });
    expect(normaliseResult(temperature, { inputKind: "measured", value: "1.000,5" })).toEqual({
      ok: false,
      problem: 'The value of "Synthetic temperature" (1.000,5) is not a number: write one decimal separator and no digit grouping.',
    });
    expect(normaliseResult(temperature, { inputKind: "measured", value: "90" })).toEqual({
      ok: false,
      problem: '"Synthetic temperature": 90 is outside the possible range (-20 – 80); check the reading.',
    });
    expect(normaliseResult(item({ inputKind: "measured", validMax: "5" }), { inputKind: "measured", value: "6" })).toEqual({
      ok: false,
      problem: '"Synthetic check": 6 is outside the possible range (… – 5); check the reading.',
    });
    expect(normaliseResult(item({ inputKind: "measured", validMin: "5" }), { inputKind: "measured", value: "4" })).toMatchObject({
      problem: '"Synthetic check": 4 is outside the possible range (5 – …); check the reading.',
    });
    expect(normaliseResult(temperature, { inputKind: "measured", value: "  " })).toMatchObject({ ok: true, result: { measuredValue: null } });
    expect(normaliseResult(temperature, { inputKind: "measured", value: null })).toMatchObject({ ok: true, result: { measuredValue: null } });
  });

  it("not applicable only where the item allows it, and then with no reading", () => {
    const supply = item({ section: "electrical_supply", inputKind: "measured" });
    expect(normaliseResult(supply, { inputKind: "measured", notApplicable: true, value: "5" })).toMatchObject({
      ok: true,
      result: { outcome: "not_applicable", measuredValue: null },
    });
    expect(normaliseResult(item({ section: "environment", inputKind: "measured" }), { inputKind: "measured", notApplicable: true })).toEqual({
      ok: false,
      problem: '"Synthetic check" cannot be marked not applicable.',
    });
  });

  it("measured_with_limit: a determinate computed outcome IS the outcome; overriding it is refused", () => {
    expect(normaliseResult(leakage, { inputKind: "measured_with_limit", value: "50" })).toMatchObject({
      ok: true,
      result: { outcome: "pass", outcomeSource: "computed", computedOutcome: "pass", measuredValue: "50", warnFlag: false },
    });
    expect(normaliseResult(leakage, { inputKind: "measured_with_limit", value: "90", outcome: "fail" })).toEqual({
      ok: false,
      problem: 'The result of "Synthetic leakage" is computed from its limit (≤ 100 µA): pass. Re-measure instead of overriding it.',
    });
    expect(normaliseResult(leakage, { inputKind: "measured_with_limit", value: "150", outcome: "fail" })).toMatchObject({
      ok: true,
      result: { outcome: "fail", computedOutcome: "fail" },
    });
    expect(normaliseResult(leakage, { inputKind: "measured_with_limit", value: "-1" })).toMatchObject({ ok: false });
    expect(normaliseResult(leakage, { inputKind: "measured_with_limit", notApplicable: true })).toMatchObject({ ok: true, result: { outcome: "not_applicable" } });
    expect(normaliseResult({ ...leakage, limitText: null, limitValue: "100" }, { inputKind: "measured_with_limit", value: "120", outcome: "pass" })).toEqual({
      ok: false,
      problem: 'The result of "Synthetic leakage" is computed from its limit (its limit): fail. Re-measure instead of overriding it.',
    });
  });

  it("measured_with_limit: an indeterminate limit (text) leaves the outcome to the technician", () => {
    const textual = { ...leakage, limitOp: "text" as const, limitText: "Sesuai pabrikan" };
    expect(normaliseResult(textual, { inputKind: "measured_with_limit", value: "50", outcome: "fail" })).toMatchObject({
      ok: true,
      result: { outcome: "fail", outcomeSource: "technician", computedOutcome: null },
    });
    expect(normaliseResult(textual, { inputKind: "measured_with_limit" })).toMatchObject({ ok: true, result: { outcome: null, outcomeSource: null } });
  });

  it("setting_measured_reference: the technician's outcome, the computed one beside it, the disagreement flagged", () => {
    expect(normaliseResult(pressure, { inputKind: "setting_measured_reference", value1: "121", value2: "126", outcome: "pass" })).toMatchObject({
      ok: true,
      result: { outcome: "pass", computedOutcome: "fail", disagreementFlag: true, measuredValue1: "121", measuredValue2: "126" },
    });
    expect(normaliseResult(pressure, { inputKind: "setting_measured_reference", value1: "121", outcome: "pass" })).toMatchObject({
      ok: true,
      result: { computedOutcome: "pass", disagreementFlag: false, measuredValue2: null },
    });
    expect(normaliseResult(pressure, { inputKind: "setting_measured_reference" })).toMatchObject({ ok: true, result: { computedOutcome: null, disagreementFlag: false } });
    expect(normaliseResult(pressure, { inputKind: "setting_measured_reference", value1: "12,0,1" })).toMatchObject({ ok: false });
    expect(normaliseResult(pressure, { inputKind: "setting_measured_reference", value1: "121", value2: "x" })).toMatchObject({ ok: false });
    const warned = { ...pressure, warnMax: "122" };
    expect(normaliseResult(warned, { inputKind: "setting_measured_reference", value1: "121", value2: "123" })).toMatchObject({ result: { warnFlag: true } });
    expect(normaliseResult(warned, { inputKind: "setting_measured_reference", value1: "123", value2: "121" })).toMatchObject({ result: { warnFlag: true } });
  });
});

describe("the request schemas (strict — FT-91)", () => {
  it("a create refuses every server-owned field and a clientRef that is not a UUID v4", () => {
    expect(ipmSessionCreate.safeParse({ deviceId: ID, clientRef: ID, capturedOffline: true, performedAt: "2026-10-09T01:00:00Z" }).success).toBe(true);
    for (const extra of [{ tenantId: ID }, { clientFacilityId: ID }, { createdBy: ID }, { status: "submitted" }, { performedBy: ID }]) {
      expect(ipmSessionCreate.safeParse({ deviceId: ID, ...extra }).success).toBe(false);
    }
    expect(ipmSessionCreate.safeParse({ deviceId: ID, clientRef: "0a0a0a0a-0a0a-1a0a-8a0a-0a0a0a0a0a0a" }).success).toBe(false);
    expect(UUID_V4.test(ID)).toBe(true);
  });

  it("the header, the correction and the list query", () => {
    expect(ipmSessionHeaderUpdate.safeParse({ sessionId: ID, revision: "2", notes: "x", recommendation: null }).success).toBe(true);
    expect(ipmSessionHeaderUpdate.safeParse({ sessionId: ID }).success).toBe(false);
    expect(ipmSessionCorrection.safeParse({ sessionId: ID, reason: "ab" }).success).toBe(false);
    expect(ipmSessionListQuery.parse({})).toMatchObject({ page: 1, limit: 25, sort: "performedAt" });
    expect(ipmSessionListQuery.safeParse({ limit: 201 }).success).toBe(false);
    expect(deviceIpmSessionsQuery.parse({ calibrationDeviceId: ID })).toMatchObject({ page: 1, limit: 25 });
  });

  it("a result row: a union on inputKind, exactly one of templateItemId or adHoc, an ad-hoc row of its section's kind", () => {
    expect(ipmResultInput.safeParse({ inputKind: "tri_state", templateItemId: ID, outcome: "pass" }).success).toBe(true);
    expect(ipmResultInput.safeParse({ inputKind: "tri_state", templateItemId: ID, value: "1" }).success).toBe(false);
    expect(ipmResultInput.safeParse({ inputKind: "check", outcome: "done" }).success).toBe(false);
    expect(ipmResultInput.safeParse({ inputKind: "check", templateItemId: ID, adHoc: { section: "tools_used", label: "x" } }).success).toBe(false);
    expect(ipmResultInput.safeParse({ inputKind: "check", adHoc: { section: "tools_used", label: "  Synthetic   analyser " } })).toMatchObject({
      success: true,
      data: { adHoc: { label: "Synthetic analyser" } },
    });
    expect(ipmResultInput.safeParse({ inputKind: "tri_state", adHoc: { section: "tools_used", label: "x" } }).success).toBe(false);
    expect(ipmResultInput.safeParse({ inputKind: "tri_state", adHoc: { section: "function", label: "x" } }).success).toBe(false);
    expect(AD_HOC_SECTIONS).toEqual(["tools_used", "electrical_safety", "performance", "consumable"]);
    for (const row of [
      { inputKind: "condition_clean", templateItemId: ID, outcome: "good", cleanliness: "clean" },
      { inputKind: "measured", templateItemId: ID, value: 1.5, notApplicable: false },
      { inputKind: "measured_with_limit", templateItemId: ID, value: "0,5", outcome: "pass" },
      { inputKind: "setting_measured_reference", templateItemId: ID, value1: "1", value2: null, outcome: "fail" },
      { inputKind: "text", templateItemId: ID, text: "x" },
    ]) {
      expect(ipmResultInput.safeParse(row).success).toBe(true);
    }
  });

  it("a results replace: no item twice, at most 100 ad-hoc rows, at most 400 rows", () => {
    const row = { inputKind: "tri_state", templateItemId: ID, outcome: "pass" };
    expect(ipmResultsReplace.safeParse({ sessionId: ID, revision: 0, results: [row] }).success).toBe(true);
    expect(ipmResultsReplace.safeParse({ sessionId: ID, revision: 0, results: [row, row] }).success).toBe(false);
    const adHoc = Array.from({ length: 101 }, () => ({ inputKind: "check", adHoc: { section: "tools_used", label: "x" } }));
    expect(ipmResultsReplace.safeParse({ sessionId: ID, revision: 0, results: adHoc }).success).toBe(false);
    expect(ipmResultsReplace.safeParse({ sessionId: ID, revision: 0, results: Array.from({ length: 401 }, () => adHoc[0]) }).success).toBe(false);
  });

  it("a field wipe carries counts only", () => {
    expect(fieldWipe.parse({ wipedUserId: ID, captures: "2", photos: 0 })).toEqual({ wipedUserId: ID, captures: 2, photos: 0 });
    expect(fieldWipe.safeParse({ wipedUserId: ID, captures: 1, photos: 1, content: "x" }).success).toBe(false);
  });
});
