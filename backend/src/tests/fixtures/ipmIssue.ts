/**
 * ipmIssue — an ISSUED IPM session through the real routes (P21-04): a draft created, its header and
 * results filled, then submitted — so the report number, token, content hash and snapshots are the
 * service's own, never hand-made. For the P21-04 suites over memoryDb (fixtures/ipmSeed's world).
 *
 * The submit's advisory lock is raw SQL, which memoryDb refuses: `answerAdvisoryLocks(mdb)` answers
 * it (and only it). Synthetic data only.
 */
import type { MemoryDb } from "./memoryDb";
import type { Principal } from "./routeClient";
import { IPM } from "./ipmSeed";

/** A complete set of results for the type checklist (TYPE_V1): every required item answered. */
export const IPM_RESULTS: readonly Record<string, unknown>[] = Object.freeze([
  { inputKind: "measured", templateItemId: IPM.ITEM_BASE_TEMP, value: "24.50" },
  { inputKind: "tri_state", templateItemId: IPM.ITEM_PLACEMENT, outcome: "pass" },
  { inputKind: "measured_with_limit", templateItemId: IPM.ITEM_LEAK, value: "50" },
  { inputKind: "setting_measured_reference", templateItemId: IPM.ITEM_PRESSURE, value1: "120", value2: "121", outcome: "pass" },
  { inputKind: "tri_state", templateItemId: IPM.ITEM_POWER, outcome: "pass" },
]);

interface Res {
  status: number;
  body: { data?: unknown; message?: string };
}
type Caller = (principal: Principal, method: string, url: string, body?: unknown) => Promise<Res>;

/** Answer the submit's advisory lock (memoryDb refuses every other raw statement). */
export const answerAdvisoryLocks = (mdb: MemoryDb): void => {
  mdb.onQuery((statement: string) => {
    if (statement.includes("pg_advisory_xact_lock")) {
      return [];
    }
    throw new Error(`memoryDb: unexpected raw SQL in an IPM suite: ${statement}`);
  });
};

/**
 * Create, fill and submit a session of `deviceId` as `principal`.
 *
 * @param send - a caller bound to the IPM sessions router
 * @param principal - the technician
 * @param deviceId - a device it may capture
 * @param header - header overrides (recommendation, room …)
 * @param results - the results (default: complete)
 * @returns the submitted session's id
 */
export const issueSession = async (
  send: Caller,
  principal: Principal,
  deviceId: string,
  header: Record<string, unknown> = {},
  results: readonly Record<string, unknown>[] = IPM_RESULTS,
): Promise<string> => {
  const created = await send(principal, "POST", "/", { deviceId, performedAt: "2026-10-08T01:00:00Z" });
  if (created.status !== 201) {
    throw new Error(`issueSession: create answered ${String(created.status)} ${String(created.body.message)}`);
  }
  const id = (created.body.data as { id: string }).id;
  const steps: [string, string, unknown][] = [
    ["PATCH", `/${id}`, { revision: 0, inspectionOutcome: "pass", maintenanceOutcome: "pass", recommendation: "fit_for_use", ...header }],
    ["PUT", `/${id}/results`, { revision: 1, results }],
    ["POST", `/${id}/submit`, { revision: 2 }],
  ];
  for (const [method, url, body] of steps) {
    const res = await send(principal, method, url, body);
    if (res.status !== 200) {
      throw new Error(`issueSession: ${method} ${url} answered ${String(res.status)} ${String(res.body.message)}`);
    }
  }
  return id;
};
