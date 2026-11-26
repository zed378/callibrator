/** P30-02: read-only report collection; no sign-off or readiness is inferred. */
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { upstreamReconciliationResult, UPSTREAM_RECONCILIATION_CHECKS } from "@callibrator/contracts/upstreamReconciliation";
import { upstreamReportDiffResult, UPSTREAM_REPORT_DIFF_FIELDS } from "@callibrator/contracts/upstreamReportDiff";
import { upstreamDataQualityResult } from "@callibrator/contracts/upstreamDataQuality";

type Options = { origin: string; runId: string; token: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function collectCutoverEvidence(options: Options, request: typeof fetch = fetch) {
  const origin = new URL(options.origin);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Use the API origin without a path, credentials, query or fragment");
  }
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) {
    throw new Error("Use HTTPS, or a loopback HTTP origin for a disposable rehearsal");
  }
  if (!UUID.test(options.runId) || !options.token || /[\r\n]/.test(options.token)) throw new Error("A run UUID and token are required");
  const durationsMs: Record<string, number> = {};
  const read = async (name: string): Promise<unknown> => {
    const started = performance.now();
    const reply = await request(new URL("/api/v1/admin/upstream-sql-imports/" + options.runId + "/" + name, origin), {
      headers: { Authorization: "Bearer " + options.token }, redirect: "error", signal: AbortSignal.timeout(120000),
    });
    durationsMs[name] = Math.round(performance.now() - started);
    if (!reply.ok) throw new Error(name + " HTTP " + reply.status);
    const envelope: unknown = await reply.json();
    if (!envelope || typeof envelope !== "object" || !("success" in envelope) || envelope.success !== true || !("data" in envelope)) {
      throw new Error(name + " invalid response envelope");
    }
    return envelope.data;
  };
  // Sequential reads avoid competing expensive report queries on the rehearsal DB.
  const reconciliation = upstreamReconciliationResult.safeParse(await read("reconciliation"));
  const diff = upstreamReportDiffResult.safeParse(await read("report-diff"));
  const quality = upstreamDataQualityResult.safeParse(await read("data-quality"));
  if (!reconciliation.success || !diff.success || !quality.success) throw new Error("Report contract validation failed");
  const reports = [reconciliation.data, diff.data, quality.data];
  if (reports.some((r) => r.runId !== options.runId || r.providerTenantId !== reports[0]!.providerTenantId)) {
    throw new Error("Reports disagree about their run or provider tenant");
  }
  const checks = [...reconciliation.data.runChecks, ...reconciliation.data.facilities.flatMap((f) => f.checks)];
  const missingChecks = UPSTREAM_RECONCILIATION_CHECKS.filter((name) => !checks.some((c) => c.check === name));
  const missingFields = UPSTREAM_REPORT_DIFF_FIELDS.filter((name) => diff.data.fields.filter((f) => f.field === name).length !== 1);
  const facilityChecks = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6", "R-7", "R-8", "RC-F4"];
  const runChecks = ["R-8", "R-9", "R-10", "R-11", "RC-F1", "RC-F2", "RC-F3", "RC-F4", "RC-F5", "R-12"];
  const incompleteFacilities = reconciliation.data.facilities.filter((f) => facilityChecks.some((name) => f.checks.filter((c) => c.check === name && c.status === "pass").length !== 1)).length;
  const incompleteRunChecks = runChecks.filter((name) => reconciliation.data.runChecks.filter((c) => c.check === name && (name === "R-12" ? c.status === "manual" || c.status === "pass" : c.status === "pass")).length !== 1);
  const facilityIds = reconciliation.data.facilities.map((f) => f.clientFacilityId).sort();
  const qualityIds = quality.data.facilities.map((f) => f.clientFacilityId).sort();
  const facilityMismatch = JSON.stringify(facilityIds) !== JSON.stringify(qualityIds) || new Set(facilityIds).size !== facilityIds.length || diff.data.sample.facilities > facilityIds.length;
  const sample = diff.data.sample;
  const sampleMismatch = sample.sessions !== Math.min(sample.requested, sample.population) || sample.sessions === 0 || sample.facilities === 0 || sample.facilities > sample.sessions;
  const failedChecks = [...new Set(checks.filter((c) => (c.check !== "R-12" && c.status !== "pass") || c.status === "fail" || c.delta !== c.actual - c.expected || (c.status === "pass" && c.delta !== 0)).map((c) => c.check))];
  const failedFields = [...new Set(diff.data.fields.filter((f) => f.status === "fail" || f.differs !== 0 || f.compared !== sample.sessions || f.compared !== f.equal + f.explained + f.differs).map((f) => f.field))];
  const findings = [...quality.data.runFindings, ...quality.data.facilities.flatMap((f) => f.findings)];
  // Deliberately omit note/code/name/id fields, even when accepted by the API schema.
  return {
    kind: "upstream-cutover-report-evidence-v1", collectedAt: new Date().toISOString(),
    automatedPass: missingChecks.length === 0 && missingFields.length === 0 && incompleteFacilities === 0 && incompleteRunChecks.length === 0 && !facilityMismatch && !sampleMismatch && facilityIds.length > 0 && failedChecks.length === 0 && failedFields.length === 0,
    readyForCutover: false,
    durationsMs, transformDurationMs: reconciliation.data.transformSummary?.durationMs ?? null,
    facilities: reconciliation.data.facilities.length, sampledSessions: diff.data.sample.sessions,
    missingChecks, failedChecks, missingFields, failedFields, incompleteFacilities, incompleteRunChecks, facilityMismatch, sampleMismatch,
    manualChecks: [...new Set(checks.filter((c) => c.status === "manual").map((c) => c.check))],
    quarantinedRows: quality.data.totals.reduce((sum, group) => sum + group.rows, 0),
    flaggedFindings: findings.filter((f) => f.status === "flagged").length,
    manualFindings: findings.filter((f) => f.status === "manual").length,
    pendingOperatorEvidence: ["legal-basis", "security-review", "signed-reconciliation", "UAT", "backup-restore", "freeze-and-delta-timing", "invitations-ready", "go-no-go"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [origin, runId, output] = process.argv.slice(2);
    if (!origin || !runId || !output) throw new Error("Usage: node --import tsx scripts/upstream/cutover-evidence.mts <API-origin> <run-UUID> <output.json>; token in UPSTREAM_REHEARSAL_TOKEN");
    const evidence = await collectCutoverEvidence({ origin, runId, token: process.env["UPSTREAM_REHEARSAL_TOKEN"] ?? "" });
    writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Report evidence written; automatedPass=" + evidence.automatedPass + "; readyForCutover=false");
    process.exitCode = evidence.automatedPass ? 0 : 1;
  } catch {
    // Never print server bodies, validation values, URLs or authentication material.
    console.error("Cutover report collection failed. Check arguments, access, endpoint status and report contracts. No sign-off recorded.");
    process.exitCode = 1;
  }
}
