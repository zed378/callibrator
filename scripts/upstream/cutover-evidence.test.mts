import assert from "node:assert/strict";
import { test } from "node:test";
import { collectCutoverEvidence } from "./cutover-evidence.mts";

const runId = "10000000-0000-4000-8000-000000000001";
const tenant = "20000000-0000-4000-8000-000000000001";
const options = { origin: "http://127.0.0.1:9999", runId, token: "synthetic-secret" };
// Independent list: deleting a check or field from the production schema cannot green this fixture.
const names = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8", "R-9", "R-10", "R-11", "RC-F1", "RC-F2", "RC-F3", "RC-F4", "RC-F5", "R-12"];
const fields = ["device.name", "facility", "ipm.date", "room", "device.qr", "device.brand", "device.serial", "device.model", "visit", "results.rows", "results.values", "inspection.result", "maintenance.result", "recommendation", "notes", "technician"];
const fixture = () => ({
  reconciliation: { runId, providerTenantId: tenant, transformSummary: { durationMs: 125, steps: 13 },
    facilities: [{ clientFacilityId: tenant, facilityCode: "F-TEST", checks: names.filter((c) => ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8", "RC-F4"].includes(c)).map((check) => ({ check, status: "pass", expected: 2, actual: 2, delta: 0, quarantined: 0, note: "PRIVATE NOTE" })) }],
    runChecks: names.filter((c) => ["R-8", "R-9", "R-10", "R-11", "RC-F1", "RC-F2", "RC-F3", "RC-F4", "RC-F5", "R-12"].includes(c)).map((check) => ({ check, status: check === "R-12" ? "manual" : "pass", expected: 2, actual: 2, delta: 0, quarantined: 0, note: "PRIVATE NOTE" })) },
  "report-diff": { runId, providerTenantId: tenant, sample: { requested: 200, population: 2, sessions: 2, facilities: 1 },
    fields: fields.map((field) => ({ field, status: "pass", compared: 2, equal: 2, explained: 0, differs: 0, note: "PRIVATE NOTE" })) },
  "data-quality": { runId, providerTenantId: tenant, facilities: [{ clientFacilityId: tenant, facilityCode: "F-TEST", quarantine: [], findings: [] }], totals: [{ sourceTable: "PRIVATE TABLE", reason: "PRIVATE REASON", rows: 3 }],
    runFindings: [{ finding: "PRIVATE FINDING", status: "flagged", count: 1, note: "PRIVATE NOTE" }] },
});
const requestFor = (data: Record<string, unknown>): typeof fetch => (async (url, init) => {
  assert.equal(init?.redirect, "error");
  assert.deepEqual(init?.headers, { Authorization: "Bearer synthetic-secret" });
  const name = new URL(String(url)).pathname.split("/").at(-1) as keyof typeof data;
  return Response.json({ success: true, data: data[name] });
}) as typeof fetch;

test("counts-only evidence preserves manual work and never asserts cutover readiness", async () => {
  const result = await collectCutoverEvidence(options, requestFor(fixture()));
  assert.equal(result.automatedPass, true);
  assert.equal(result.readyForCutover, false);
  assert.deepEqual(result.manualChecks, ["R-12"]);
  assert.equal(result.quarantinedRows, 3);
  assert.equal(result.flaggedFindings, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|synthetic-secret|20000000|10000000/);
});
test("a missing check or field fails collection's automated verdict", async () => {
  const data = fixture(); data.reconciliation.runChecks.pop(); data["report-diff"].fields.pop();
  const result = await collectCutoverEvidence(options, requestFor(data));
  assert.equal(result.automatedPass, false);
  assert.deepEqual(result.missingChecks, ["R-12"]);
  assert.deepEqual(result.missingFields, ["technician"]);
});
test("inconsistent counts fail even if the server labels them pass", async () => {
  const data = fixture(); data.reconciliation.facilities[0]!.checks[0]!.actual = 3; data["report-diff"].fields[0]!.differs = 1;
  const result = await collectCutoverEvidence(options, requestFor(data));
  assert.equal(result.automatedPass, false);
  assert.deepEqual(result.failedChecks, ["R-1"]); assert.deepEqual(result.failedFields, ["device.name"]);
});
test("mismatched tenants and malformed response envelopes are refused", async () => {
  const data = fixture(); data["report-diff"].providerTenantId = runId;
  await assert.rejects(collectCutoverEvidence(options, requestFor(data)), /disagree/);
  await assert.rejects(collectCutoverEvidence(options, (async () => Response.json({ success: false, data: {} })) as typeof fetch), /envelope/);
});
test("non-HTTPS remote origins and invalid run IDs never receive the token", async () => {
  const never = (async () => { throw new Error("network should not run"); }) as typeof fetch;
  await assert.rejects(collectCutoverEvidence({ ...options, origin: "http://remote.example" }, never), /HTTPS/);
  await assert.rejects(collectCutoverEvidence({ ...options, runId: "../wrong" }, never), /UUID/);
});
test("HTTP failures are recorded without disclosing server bodies", async () => {
  await assert.rejects(collectCutoverEvidence(options, (async () => new Response("PRIVATE", { status: 403 })) as typeof fetch), /reconciliation HTTP 403/);
});
test("a partial facility and an empty report sample cannot pass", async () => {
  const data = fixture();
  const withFacility = { ...data, reconciliation: { ...data.reconciliation, facilities: [{ clientFacilityId: tenant, facilityCode: "F-TEST", checks: [data.reconciliation.runChecks[0]!] }] } };
  const result = await collectCutoverEvidence(options, requestFor(withFacility));
  assert.equal(result.automatedPass, false);
  assert.equal(result.incompleteFacilities, 1);
  data["report-diff"].sample.sessions = 0;
  assert.equal((await collectCutoverEvidence(options, requestFor(data))).automatedPass, false);
});
test("manual cannot replace automated checks and facility membership must match", async () => {
  const data = fixture(); data.reconciliation.facilities[0]!.checks[0]!.status = "manual";
  let result = await collectCutoverEvidence(options, requestFor(data));
  assert.equal(result.automatedPass, false);
  assert.deepEqual(result.failedChecks, ["R-1"]);
  const wrong = fixture(); wrong["data-quality"].facilities[0]!.clientFacilityId = runId;
  result = await collectCutoverEvidence(options, requestFor(wrong));
  assert.equal(result.automatedPass, false); assert.equal(result.facilityMismatch, true);
  const empty = fixture(); empty.reconciliation.facilities = []; empty["data-quality"].facilities = [];
  assert.equal((await collectCutoverEvidence(options, requestFor(empty))).automatedPass, false);
});

test("every report field must compare every sampled session", async () => {
  for (const compared of [0, 1, 3]) {
    const data = fixture();
    Object.assign(data["report-diff"].fields[0]!, { compared, equal: compared });
    const result = await collectCutoverEvidence(options, requestFor(data));
    assert.equal(result.automatedPass, false, "field coverage " + compared);
    assert.deepEqual(result.failedFields, ["device.name"]);
  }
});

test("sample totals must describe the complete requested sample and possible facilities", async () => {
  for (const sample of [
    { requested: 200, population: 3, sessions: 2, facilities: 1 },
    { requested: 1, population: 2, sessions: 2, facilities: 1 },
    { requested: 200, population: 1, sessions: 2, facilities: 1 },
    { requested: 200, population: 2, sessions: 2, facilities: 0 },
    { requested: 200, population: 2, sessions: 2, facilities: 3 },
  ]) {
    const data = fixture(); data["report-diff"].sample = sample;
    const result = await collectCutoverEvidence(options, requestFor(data));
    assert.equal(result.automatedPass, false, JSON.stringify(sample));
    assert.equal(result.sampleMismatch || result.facilityMismatch, true);
  }
});

test("a deliberately capped complete sample still passes automated checks", async () => {
  const data = fixture();
  data["report-diff"].sample = { requested: 1, population: 2, sessions: 1, facilities: 1 };
  for (const field of data["report-diff"].fields) Object.assign(field, { compared: 1, equal: 1 });
  const result = await collectCutoverEvidence(options, requestFor(data));
  assert.equal(result.automatedPass, true);
  assert.equal(result.sampleMismatch, false);
  assert.equal(result.readyForCutover, false);
});
