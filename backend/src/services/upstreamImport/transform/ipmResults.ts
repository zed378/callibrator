/**
 * Step 12 of the transform (P24-02g; ADR-129 Am. 9; P19-02 spec § 13; P19-06 spec § 5, § 6;
 * P19-01 spec § 5.1; 04 § 4.9, § 5): the upstream IPM result tables → `inspection_results` of the
 * drafts step 11 wrote, and then the ISSUE of every such draft — the report number, the token, the
 * issuer and the content hash of scheme `ipm-report-v1`, set by the one draft → submitted UPDATE
 * 0127 admits (0126's issued-fields CHECK).
 *
 *  - Each row goes to the session of its key (ipm.ts); none (the key was quarantined in step 11)
 *    → `session_not_imported`; no label, or an id that is not an integer → `value_out_of_range`.
 *  - Values by ipm.ts `resultValuesOf`; `sort_order` the upstream id order within the section;
 *    `template_item_id` NULL (imported history, 0127); `item_definition_id` the catalogue row of the
 *    upstream item id (step 4's `id_map`), else the one definition of the section with that label
 *    (case-folded), else NULL (03 Q-6, Q-7).
 *  - RE-RUNS (Am. 9): the rows of a key whose session is already issued are mapped onto its results
 *    while they still describe them (ipm.ts `resultsFingerprint`), else quarantined
 *    `session_changed_upstream`; an issued session is never written.
 *  - THE ISSUE reads every draft of the tenant that carries a `legacy_key` — only this transaction's
 *    (an imported session is issued before the commit, so no such draft survives one) — and its
 *    results AS STORED, so the hash is the one ipmReport.service `checkIntegrity` recomputes. Report
 *    numbers per facility code and day of `performed_at` in the tenant's zone, after the highest of
 *    that prefix, in `performed_at` order (P19-06 § 5); a concurrent capture taking the same number
 *    fails the transform on the unique index, and it rolls back (no advisory lock per day: thousands
 *    of locks in one transaction would exhaust the lock table). `submitted_at` = `performed_at`.
 *  - AUDIT (UD-13; STEP_AUDITED): CREATE per issued session (with its report number and hash) and
 *    per result, actor `system:upstream-transform`, each with the session's facility — never a legacy
 *    id or a value (07 § 3).
 */
import { randomUUID } from "crypto";
import { sql } from "../../../utils/sql.util";
import { SYSTEM_ACTORS } from "../../../constants/systemActors";
import { contentHash, newVerificationToken, reportPayload } from "../../ipmReport.service";
import { IPM_REPORT_SCHEME, ipmReportNumber, type IpmReportResult } from "@callibrator/contracts/ipmReport";
import { compactDay, zonedDay } from "@callibrator/contracts/inspectionValues";
import type { IpmDeviceSnapshot, IpmFacilitySnapshot, IpmIssuerSnapshot, IpmPersonSnapshot } from "../../../utils/jsonShape.util";
import { RESOURCE_TYPES } from "./auditRows";
import { quarantineRows, recordMappings, stagedTableExists, type Mapping, type QuarantineEntry } from "./ledger";
import { mappedTargets } from "./people";
import {
  RESULT_SOURCES,
  RESULT_TABLES,
  byLegacyId,
  codeOf,
  legacyKeyOf,
  readStagedIpm,
  resultValuesOf,
  resultsFingerprint,
  tenantOf,
  type ComparableResult,
  type DefinitionFacts,
  type ResultTableRule,
  type ResultValues,
  type StagedIpmRow,
} from "./ipm";
import type { StepContext } from "./steps";

/** A session of a key, as step 12 finds it. */
export interface KeySession {
  id: string;
  facilityId: string;
  /** Still a draft: written by step 11 in this transaction. */
  draft: boolean;
}

/** A stored result of an issued session, what a re-run compares and maps onto. */
export type StoredResult = ComparableResult & { id: string };

/** What the result plan reads. */
export interface ResultInput {
  tenantId: string;
  zone: string;
  rows: Readonly<Record<string, readonly StagedIpmRow[]>>;
  sessions: ReadonlyMap<string, KeySession>;
  /** issued session → its stored results. */
  stored: ReadonlyMap<string, readonly StoredResult[]>;
  /** `<catalogue table>#<upstream item id>` → the definition step 4 wrote. */
  itemTargets: ReadonlyMap<string, string>;
  definitions: ReadonlyMap<string, DefinitionFacts>;
  newId: () => string;
}

/** One result the step inserts. */
export type ResultRow = ResultValues & { id: string; sessionId: string; facilityId: string; sortOrder: number; legacyTable: string; legacyId: number };

/** What the result plan writes. */
export interface ResultPlan {
  insert: ResultRow[];
  mappings: Mapping[];
  quarantine: QuarantineEntry[];
}

const INTEGER = /^\d{1,9}$/;

/** The definition of one row: by its upstream item id, else by the section's unique label, else none. */
export const definitionFor = (
  rule: ResultTableRule,
  row: Readonly<Record<string, unknown>>,
  label: string,
  itemTargets: ReadonlyMap<string, string>,
  definitions: ReadonlyMap<string, DefinitionFacts>,
  byLabel: ReadonlyMap<string, DefinitionFacts | null>,
): DefinitionFacts | null => {
  const item = rule.item === null ? null : codeOf(row, rule.item.column);
  const target = rule.item === null || item === null ? undefined : itemTargets.get(`${rule.item.catalogue}#${item}`);
  const direct = target === undefined ? undefined : definitions.get(target);
  if (direct?.section === rule.section) {
    return direct;
  }
  return byLabel.get(`${rule.section}#${label.toLowerCase()}`) ?? null;
};

/** The section's definitions by case-folded label; a label two definitions share matches none. */
export const labelIndex = (definitions: ReadonlyMap<string, DefinitionFacts>): Map<string, DefinitionFacts | null> => {
  const index = new Map<string, DefinitionFacts | null>();
  for (const d of [...definitions.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = `${d.section}#${d.label.toLowerCase()}`;
    index.set(key, index.has(key) ? null : d);
  }
  return index;
};

/**
 * Decide every staged result row. Pure.
 */
export const planResults = (input: ResultInput): ResultPlan => {
  const plan: ResultPlan = { insert: [], mappings: [], quarantine: [] };
  const byLabel = labelIndex(input.definitions);
  /** session id → its planned rows, with the staged row each came from. */
  const planned = new Map<string, { table: string; staged: StagedIpmRow; values: ResultRow }[]>();
  const sessionOf = new Map<string, KeySession>();
  for (const table of Object.keys(RESULT_TABLES)) {
    const rule = RESULT_TABLES[table] as ResultTableRule;
    for (const staged of [...(input.rows[table] ?? [])].sort(byLegacyId)) {
      const quarantine = (reason: QuarantineEntry["reason"]): void => {
        plan.quarantine.push({ sourceTable: table, sourceRowNumber: staged.sourceRowNumber, legacyId: staged.legacyId, reason });
      };
      const key = legacyKeyOf(staged.qr, staged.performedAt, input.zone);
      if (key === null) {
        quarantine("value_out_of_range");
        continue;
      }
      const session = input.sessions.get(key);
      if (session === undefined) {
        quarantine("session_not_imported");
        continue;
      }
      const label = resultValuesOf(table, staged.row, null)?.label ?? null;
      if (label === null || !INTEGER.test(staged.legacyId)) {
        quarantine("value_out_of_range");
        continue;
      }
      const values = resultValuesOf(table, staged.row, definitionFor(rule, staged.row, label, input.itemTargets, input.definitions, byLabel)) as ResultValues;
      const rows = planned.get(session.id) ?? [];
      const sortOrder = rows.filter((r) => r.values.section === rule.section).length + 1;
      rows.push({
        table,
        staged,
        values: { ...values, id: input.newId(), sessionId: session.id, facilityId: session.facilityId, sortOrder, legacyTable: table, legacyId: Number(staged.legacyId) },
      });
      planned.set(session.id, rows);
      sessionOf.set(session.id, session);
    }
  }
  for (const [sessionId, rows] of planned) {
    const session = sessionOf.get(sessionId) as KeySession;
    if (session.draft) {
      for (const { table, staged, values } of rows) {
        plan.insert.push(values);
        plan.mappings.push({ sourceTable: table, legacyId: staged.legacyId, targetTable: "inspection_results", targetId: values.id, tenantId: input.tenantId, clientFacilityId: session.facilityId, rowHash: staged.rowHash, sourceValues: null });
      }
      continue;
    }
    const stored = input.stored.get(sessionId) ?? [];
    if (resultsFingerprint(rows.map((r) => r.values)) !== resultsFingerprint(stored)) {
      for (const { table, staged } of rows) {
        plan.quarantine.push({ sourceTable: table, sourceRowNumber: staged.sourceRowNumber, legacyId: staged.legacyId, reason: "session_changed_upstream" });
      }
      continue;
    }
    const storedId = new Map(stored.map((s) => [`${s.section}#${String(s.sortOrder)}`, s.id]));
    for (const { table, staged, values } of rows) {
      const targetId = storedId.get(`${values.section}#${String(values.sortOrder)}`) as string;
      if (staged.decision === "unchanged" && staged.targetId === targetId) {
        continue;
      }
      plan.mappings.push({ sourceTable: table, legacyId: staged.legacyId, targetTable: "inspection_results", targetId, tenantId: input.tenantId, clientFacilityId: session.facilityId, rowHash: staged.rowHash, sourceValues: null });
    }
  }
  return plan;
};

// ------------------------------------------------------------------
// THE ISSUE (P19-06 § 5, § 6)
// ------------------------------------------------------------------

/** A draft as the issue reads it. */
export interface DraftSession {
  id: string;
  facilityId: string;
  legacyKey: string;
  performedAt: string;
  performerSnapshot: IpmPersonSnapshot;
  deviceSnapshot: IpmDeviceSnapshot;
  facilitySnapshot: IpmFacilitySnapshot;
  room: string | null;
  floor: string | null;
  visitNumber: number;
  legacyVisitNumber: number | null;
  inspectionOutcome: string | null;
  maintenanceOutcome: string | null;
  recommendation: string | null;
  notes: string | null;
}

/** One issued report: what the UPDATE sets, and what the audit row says. */
export interface IssuedReport {
  id: string;
  facilityId: string;
  reportNumber: string;
  token: string;
  hash: string;
  resultCount: number;
}

/** The report-number prefix of a draft (`IPM-<facility code>-<YYYYMMDD>-`) in `zone`. */
export const reportPrefixOf = (draft: Pick<DraftSession, "facilitySnapshot" | "performedAt">, zone: string): { code: string; day: string; prefix: string } => {
  const code = draft.facilitySnapshot.code ?? "SELF";
  const day = compactDay(zonedDay(new Date(draft.performedAt), zone));
  return { code, day, prefix: `IPM-${code}-${day}-` };
};

/**
 * Number, token and hash every draft. Pure but for the token generator.
 *
 * @param taken - the tenant's report numbers already under the drafts' prefixes
 */
export const issueReports = (
  drafts: readonly DraftSession[],
  results: ReadonlyMap<string, readonly IpmReportResult[]>,
  taken: readonly string[],
  issuer: IpmIssuerSnapshot,
  newToken: () => string,
): IssuedReport[] => {
  const highest = new Map<string, number>();
  const ordered = [...drafts].sort((a, b) => a.performedAt.localeCompare(b.performedAt) || a.legacyKey.localeCompare(b.legacyKey));
  const prefixes = new Set(ordered.map((d) => reportPrefixOf(d, issuer.timeZone).prefix));
  for (const number of taken) {
    for (const prefix of prefixes) {
      const tail = number.startsWith(prefix) ? number.slice(prefix.length) : "";
      if (/^\d+$/.test(tail)) {
        highest.set(prefix, Math.max(highest.get(prefix) ?? 0, Number(tail)));
      }
    }
  }
  return ordered.map((draft) => {
    const { code, day, prefix } = reportPrefixOf(draft, issuer.timeZone);
    const sequence = (highest.get(prefix) ?? 0) + 1;
    highest.set(prefix, sequence);
    const reportNumber = ipmReportNumber(code, day, sequence);
    const performedAt = new Date(draft.performedAt);
    const rows = results.get(draft.id) ?? [];
    const hash = contentHash(
      reportPayload(
        {
          id: draft.id,
          reportNumber,
          supersedesReportNumber: null,
          issuer,
          snapshots: { device: draft.deviceSnapshot, facility: draft.facilitySnapshot, room: draft.room, floor: draft.floor, performer: draft.performerSnapshot },
          visitNumber: draft.visitNumber,
          legacyVisitNumber: draft.legacyVisitNumber,
          performedAt,
          submittedAt: performedAt,
          version: null,
          inspectionOutcome: draft.inspectionOutcome,
          maintenanceOutcome: draft.maintenanceOutcome,
          recommendation: draft.recommendation,
          notes: draft.notes,
          capturedOffline: false,
          imported: true,
        },
        rows,
      ),
    );
    return { id: draft.id, facilityId: draft.facilityId, reportNumber, token: newToken(), hash, resultCount: rows.length };
  });
};

// ------------------------------------------------------------------
// THE STEP
// ------------------------------------------------------------------

/** Step 12's `run`: the results, then the issue. */
export const runIpmResults = async (context: StepContext): Promise<void> => {
  const { runner, transaction, tenantId } = context;
  const tenant = await tenantOf(context);
  const rows: Record<string, StagedIpmRow[]> = {};
  const itemTargets = new Map<string, string>();
  for (const source of RESULT_SOURCES) {
    const read = (await stagedTableExists(context, source.table)) ? await readStagedIpm(context, source) : [];
    rows[source.table] = read;
    const { item } = RESULT_TABLES[source.table] as ResultTableRule;
    const ids = item === null ? [] : [...new Set(read.map((r) => codeOf(r.row, item.column)).filter((i): i is string => i !== null))];
    if (item !== null && ids.length > 0) {
      for (const [legacy, target] of await mappedTargets(context, item.catalogue, ids)) {
        itemTargets.set(`${item.catalogue}#${legacy}`, target);
      }
    }
  }
  const keys = [
    ...new Set(
      Object.values(rows)
        .flat()
        .map((r) => legacyKeyOf(r.qr, r.performedAt, tenant.zone))
        .filter((k): k is string => k !== null),
    ),
  ];
  const sessionRows = await sql<KeySession & { legacyKey: string }>(
    runner,
    `SELECT id, legacy_key AS "legacyKey", client_facility_id AS "facilityId", status = 'draft' AS draft
       FROM inspection_sessions WHERE tenant_id = $1 AND legacy_key = ANY($2::text[])`,
    [tenantId, keys],
    { transaction },
  );
  const sessions = new Map(sessionRows.map(({ legacyKey, ...s }) => [legacyKey, s]));
  const issued = sessionRows.filter((s) => !s.draft).map((s) => s.id);
  const stored = new Map<string, StoredResult[]>();
  for (const r of await storedResults(context, issued)) {
    stored.set(r.sessionId, [...(stored.get(r.sessionId) ?? []), r]);
  }
  const definitions = new Map(
    (
      await sql<DefinitionFacts>(
        runner,
        `SELECT id, section::text AS section, label, unit, limit_op::text AS "limitOp", limit_value::text AS "limitValue", limit_low::text AS "limitLow",
                limit_high::text AS "limitHigh", limit_nominal::text AS "limitNominal", limit_tolerance::text AS "limitTolerance",
                setting_value::text AS "settingValue"
           FROM inspection_item_definitions`,
        [],
        { transaction },
      )
    ).map((d) => [d.id, d]),
  );
  const plan = planResults({ tenantId, zone: tenant.zone, rows, sessions, stored, itemTargets, definitions, newId: randomUUID });
  await insertResults(context, plan.insert);
  await quarantineRows(context, plan.quarantine);
  await recordMappings(context, plan.mappings);
  await issueDrafts(context, tenant.zone);
};

/** The stored results of sessions, as compared, and as hashed. */
const storedResults = async (context: StepContext, sessionIds: readonly string[]): Promise<(StoredResult & IpmReportResult & { sessionId: string })[]> => {
  if (sessionIds.length === 0) {
    return [];
  }
  return sql<StoredResult & IpmReportResult & { sessionId: string }>(
    context.runner,
    `SELECT r.session_id AS "sessionId", r.id, r.section::text AS section, r.input_kind::text AS "inputKind", r.label_snapshot AS label,
            r.template_item_id AS "templateItemId", r.is_ad_hoc AS "adHoc", r.unit, r.symbol, r.setting_text AS setting,
            r.reference_text AS reference, r.reference_text AS "limitText", r.outcome::text AS outcome, r.cleanliness::text AS cleanliness,
            r.measured_value::text AS "measuredValue", r.measured_value_1::text AS "measuredValue1", r.measured_value_2::text AS "measuredValue2",
            r.text_value AS "textValue", r.raw_value AS "rawValue", r.computed_outcome::text AS "computedOutcome",
            r.outcome_source::text AS "outcomeSource", r.warn_flag AS "warnFlag", r.disagreement_flag AS "disagreementFlag", r.sort_order AS "sortOrder"
       FROM inspection_results r WHERE r.tenant_id = $1 AND r.session_id = ANY($2::uuid[])`,
    [context.tenantId, [...sessionIds]],
    { transaction: context.transaction },
  );
};

const BATCH = 5000;

/** The results, in batches. */
const insertResults = async (context: StepContext, results: readonly ResultRow[]): Promise<void> => {
  for (let start = 0; start < results.length; start += BATCH) {
    const batch = results.slice(start, start + BATCH);
    const col = <K extends keyof ResultRow>(key: K): ResultRow[K][] => batch.map((r) => r[key]);
    await sql(
      context.runner,
      `INSERT INTO inspection_results (id, tenant_id, client_facility_id, session_id, section, input_kind, template_item_id, item_definition_id, is_ad_hoc,
                                       label_snapshot, unit, symbol, setting_text, reference_text, outcome, cleanliness, measured_value,
                                       measured_value_1, measured_value_2, raw_value, computed_outcome, outcome_source, warn_flag,
                                       disagreement_flag, sort_order, legacy_table, legacy_id, created_at, updated_at)
       SELECT v.id, $1::uuid, v.facility, v.session, v.section::"enum_inspection_results_section", v.kind::"enum_inspection_results_input_kind",
              NULL, v.def, false, v.label, v.unit, v.symbol, v.setting, v.reference, v.outcome::"enum_inspection_results_outcome",
              v.clean::"enum_inspection_results_cleanliness", v.m::numeric, v.m1::numeric, v.m2::numeric, v.raw,
              v.computed::"enum_inspection_results_computed_outcome", v.src::"enum_inspection_results_outcome_source", v.warn, false,
              v.sort, v.ltable, v.lid, now(), now()
         FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::uuid[], $8::text[], $9::text[], $10::text[], $11::text[],
                     $12::text[], $13::text[], $14::text[], $15::text[], $16::text[], $17::text[], $18::text[], $19::text[], $20::text[],
                     $21::boolean[], $22::int[], $23::text[], $24::int[])
              AS v(id, facility, session, section, kind, def, label, unit, symbol, setting, reference, outcome, clean, m, m1, m2, raw, computed, src,
                   warn, sort, ltable, lid)`,
      [
        context.tenantId,
        col("id"),
        col("facilityId"),
        col("sessionId"),
        col("section"),
        col("inputKind"),
        col("itemDefinitionId"),
        col("label"),
        col("unit"),
        col("symbol"),
        col("setting"),
        col("reference"),
        col("outcome"),
        col("cleanliness"),
        col("measuredValue"),
        col("measuredValue1"),
        col("measuredValue2"),
        col("rawValue"),
        col("computedOutcome"),
        col("outcomeSource"),
        col("warnFlag"),
        col("sortOrder"),
        col("legacyTable"),
        col("legacyId"),
      ],
      { transaction: context.transaction },
    );
  }
  await auditRows(
    context,
    "inspection_results",
    results.map((r) => ({ id: r.id, facility: r.facilityId, changes: {} })),
  );
};

/** Issue every imported draft of this transaction: number, token, hash, one UPDATE, and the audit rows. */
const issueDrafts = async (context: StepContext, zone: string): Promise<void> => {
  const { runner, transaction, tenantId } = context;
  const drafts = await sql<DraftSession>(
    runner,
    `SELECT id, client_facility_id AS "facilityId", legacy_key AS "legacyKey",
            to_char(performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "performedAt",
            performer_snapshot AS "performerSnapshot", device_snapshot AS "deviceSnapshot", facility_snapshot AS "facilitySnapshot",
            room_snapshot AS room, floor_snapshot AS floor, visit_number AS "visitNumber", legacy_visit_number AS "legacyVisitNumber",
            inspection_outcome::text AS "inspectionOutcome", maintenance_outcome::text AS "maintenanceOutcome",
            recommendation::text AS recommendation, notes
       FROM inspection_sessions WHERE tenant_id = $1 AND status = 'draft' AND legacy_key IS NOT NULL`,
    [tenantId],
    { transaction },
  );
  if (drafts.length === 0) {
    return;
  }
  const results = new Map<string, IpmReportResult[]>();
  for (const { sessionId, ...r } of await storedResults(context, drafts.map((d) => d.id))) {
    results.set(sessionId, [...(results.get(sessionId) ?? []), r]);
  }
  const prefixes = [...new Set(drafts.map((d) => reportPrefixOf(d, zone).prefix))];
  const taken = await sql<{ reportNumber: string }>(
    runner,
    `SELECT s.report_number AS "reportNumber" FROM inspection_sessions s
      WHERE s.tenant_id = $1 AND s.report_number IS NOT NULL AND EXISTS (SELECT 1 FROM unnest($2::text[]) p WHERE starts_with(s.report_number, p))`,
    [tenantId, prefixes],
    { transaction },
  );
  const [t] = await sql<Omit<IpmIssuerSnapshot, "version" | "timeZone">>(
    runner,
    "SELECT name, email, phone, address, city, state, zip_code AS \"zipCode\", country, website FROM tenants WHERE id = $1",
    [tenantId],
    { transaction },
  );
  const issuer: IpmIssuerSnapshot = {
    version: 1,
    name: t?.name ?? null,
    email: t?.email ?? null,
    phone: t?.phone ?? null,
    address: t?.address ?? null,
    city: t?.city ?? null,
    state: t?.state ?? null,
    zipCode: t?.zipCode ?? null,
    country: t?.country ?? null,
    website: t?.website ?? null,
    timeZone: zone,
  };
  const reports = issueReports(drafts, results, taken.map((r) => r.reportNumber), issuer, newVerificationToken);
  await sql(
    runner,
    `UPDATE inspection_sessions t
        SET status = 'submitted', submitted_at = t.performed_at, report_number = v.number, verification_token = v.token,
            report_content_hash = v.hash, report_hash_scheme = $2, issuer_snapshot = $3::jsonb, updated_at = now()
       FROM unnest($4::uuid[], $5::text[], $6::text[], $7::text[]) AS v(id, number, token, hash)
      WHERE t.id = v.id AND t.tenant_id = $1 AND t.status = 'draft' AND t.legacy_key IS NOT NULL`,
    [tenantId, IPM_REPORT_SCHEME, JSON.stringify(issuer), reports.map((r) => r.id), reports.map((r) => r.reportNumber), reports.map((r) => r.token), reports.map((r) => r.hash)],
    { transaction },
  );
  await auditRows(
    context,
    "inspection_sessions",
    reports.map((r) => ({ id: r.id, facility: r.facilityId, changes: { reportNumber: r.reportNumber, reportHash: r.hash, hashScheme: IPM_REPORT_SCHEME, resultCount: r.resultCount } })),
  );
};

/** CREATE audit rows of one table, in batches. */
const auditRows = async (context: StepContext, table: "inspection_sessions" | "inspection_results", entries: readonly { id: string; facility: string; changes: object }[]): Promise<void> => {
  for (let start = 0; start < entries.length; start += BATCH) {
    const batch = entries.slice(start, start + BATCH);
    await sql(
      context.runner,
      `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, client_facility_id, changes, created_at)
       SELECT gen_random_uuid(), $1::uuid, NULL, 'system', $2, 'CREATE', $3, e.id, e.facility,
              e.changes::jsonb || jsonb_build_object('operation', 'UPSTREAM_IMPORT', 'source', 'skp_ipm', 'importRunId', $4::text, 'targetTable', $5::text),
              now()
         FROM unnest($6::text[], $7::uuid[], $8::text[]) WITH ORDINALITY AS e(id, facility, changes, n)
        ORDER BY e.n`,
      [
        context.tenantId,
        SYSTEM_ACTORS.UPSTREAM_TRANSFORM,
        RESOURCE_TYPES[table] as string,
        context.runId,
        table,
        batch.map((e) => e.id),
        batch.map((e) => e.facility),
        batch.map((e) => JSON.stringify(e.changes)),
      ],
      { transaction: context.transaction },
    );
  }
};
