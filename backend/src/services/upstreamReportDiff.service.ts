/**
 * P25-03 (ADR-129 Am. 14; docs/UPSTREAM/09 § 2.3) — the sampled report diff of one transformed
 * upstream run: for a deterministic sample of the run's imported sessions, what the upstream IPM
 * report prints set beside what our report document is built from, field by field.
 *
 * Aggregates only. The rows are read into this process on the transform connection (the
 * application's connection never touches `upstream_import`) and compared by reportDiff.ts; only the
 * tally leaves: counts and fixed codes, never a staged value, a name, a QR or a serial.
 *
 * THE STAGED SIDE IS FOUND AS UPSTREAM FINDS IT: every section from its table for `(QR, date)`
 * (09 § 2.3), not through `id_map` — `id_map` only names the stored row a staged row is compared
 * with. THE SAMPLE is the first `sample` imported sessions by `md5(legacy_key)`: spread over the
 * facilities, and the same keys on a re-run, whatever ids the transform gave them.
 */
import { sql, type BindValue, type SqlRunner } from "../utils/sql.util";
import { createTransformDb, sourceTimeZone, transformRoleName } from "../config/upstreamImport";
import { ID_MAP, QUARANTINE, stagedTable, stagedTableExists } from "./upstreamImport/transform/ledger";
import { RESULT_TABLES, SESSION_TABLES, tenantOf } from "./upstreamImport/transform/ipm";
import type { StepContext } from "./upstreamImport/transform/steps";
import {
  compareSession,
  tallyFields,
  type StagedReportRow,
  type StagedUser,
  type StoredResult,
} from "./upstreamImport/reportDiff";
import {
  UPSTREAM_REPORT_DIFF_FIELDS,
  type UpstreamReportDiffResult,
} from "@callibrator/contracts/upstreamReportDiff";
import models from "../models";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";

const { UpstreamSqlImport } = models;

interface Run {
  transformStatus: string;
  transformTenantId: string | null;
}

type Raw = Readonly<Record<string, unknown>>;

/** A sampled session as stored. */
interface SessionRow {
  id: string;
  legacyKey: string;
  facilityId: string;
  day: string | null;
  performer: { name?: string | null } | null;
  device: Readonly<Record<string, string | null>> | null;
  facility: { name?: string | null } | null;
  room: string | null;
  legacyVisitNumber: number | null;
  inspectionOutcome: string | null;
  maintenanceOutcome: string | null;
  recommendation: string | null;
  notes: string | null;
}

/** The staged rows of the session keys, per key. */
const stagedRowsByKey = async (
  context: StepContext,
  zone: string,
  keys: readonly string[],
): Promise<Map<string, StagedReportRow[]>> => {
  const byKey = new Map<string, StagedReportRow[]>();
  for (const table of [...SESSION_TABLES, ...Object.keys(RESULT_TABLES)]) {
    if (!(await stagedTableExists(context, table))) {
      continue;
    }
    const rows = await sql<{ key: string; row: Raw; targetId: string | null; quarantined: boolean }>(
      context.runner,
      `SELECT y.key, to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row, m.target_id AS "targetId",
              EXISTS (SELECT 1 FROM ${QUARANTINE} q
                       WHERE q.import_run_id = $1 AND q.source_table = $4 AND q.source_row_number = s.source_row_number) AS quarantined
         FROM ${stagedTable(table)} s
        CROSS JOIN LATERAL (
          SELECT nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') || '|' ||
                 to_char(((to_jsonb(s) ->> 'created_at')::timestamp AT TIME ZONE $2) AT TIME ZONE $3, 'YYYY-MM-DD') AS key) y
         JOIN unnest($5::text[]) AS k(key) ON k.key = y.key
         LEFT JOIN ${ID_MAP} m ON m.source_table = $4 AND m.legacy_id = s."id"::text
        WHERE s.import_run_id = $1`,
      [context.runId, context.sourceZone, zone, table, [...keys]],
      { transaction: context.transaction },
    );
    for (const { key, row, targetId, quarantined } of rows) {
      const list = byKey.get(key) ?? [];
      list.push({ table, row, targetId, quarantined });
      byKey.set(key, list);
    }
  }
  return byKey;
};

/** The staged upstream device of a QR, with its facility's upstream name and whether its serial is shared there. */
interface StagedDevice {
  qr: string;
  row: Raw;
  facilityName: string | null;
  shared: boolean;
}

const stagedDevices = async (context: StepContext, qrs: readonly string[]): Promise<Map<string, StagedDevice>> => {
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return new Map();
  }
  const facilities = await stagedTableExists(context, "mst_faskes");
  const bind: BindValue[] = [context.runId, [...new Set(qrs)]];
  const rows = await sql<StagedDevice>(
    context.runner,
    `SELECT y.qr, y.row, y.shared, ${facilities ? `(SELECT f."name_faskes"::text FROM ${stagedTable("mst_faskes")} f WHERE f.import_run_id = $1 AND f."id"::text = y.client LIMIT 1)` : "NULL"} AS "facilityName"
       FROM (SELECT nullif(btrim(to_jsonb(s) ->> 'no_qrcode'), '') AS qr, btrim(to_jsonb(s) ->> 'id_client') AS client,
                    to_jsonb(s) - 'import_run_id' - 'source_row_number' AS row,
                    count(*) OVER (PARTITION BY btrim(to_jsonb(s) ->> 'id_client'), lower(btrim(coalesce(to_jsonb(s) ->> 'sn', '')))) > 1 AS shared
               FROM ${stagedTable("trx_inventory")} s WHERE s.import_run_id = $1) y
       JOIN unnest($2::text[]) AS q(qr) ON q.qr = y.qr`,
    bind,
    { transaction: context.transaction },
  );
  return new Map(rows.map((r) => [r.qr, r]));
};

/** The staged accounts, and whether each was imported. */
const stagedUsers = async (context: StepContext): Promise<Map<string, StagedUser>> => {
  if (!(await stagedTableExists(context, "users"))) {
    return new Map();
  }
  const rows = await sql<StagedUser & { id: string }>(
    context.runner,
    `SELECT s."id"::text AS id, to_jsonb(s) ->> 'fullname' AS name, m.legacy_id IS NOT NULL AS imported
       FROM ${stagedTable("users")} s
       LEFT JOIN ${ID_MAP} m ON m.source_table = 'users' AND m.legacy_id = s."id"::text
      WHERE s.import_run_id = $1`,
    [context.runId],
    { transaction: context.transaction },
  );
  return new Map(rows.map(({ id, name, imported }) => [id, { name, imported }]));
};

/**
 * The diff of one transformed run.
 * @param runId - the run
 * @param sample - how many imported sessions to compare (the contract caps it)
 * @throws {CodedError} 404 UPSTREAM_SQL_IMPORT_NOT_FOUND; 409 RUN_NOT_TRANSFORMED (not `transformed`, or no provider tenant)
 */
export const diffRun = async (runId: string, sample: number): Promise<UpstreamReportDiffResult> => {
  const found = (await UpstreamSqlImport.findByPk(runId)) as unknown as Run | null;
  if (found === null) {
    throw new CodedError(404, "UPSTREAM_SQL_IMPORT_NOT_FOUND", "Import run not found");
  }
  if (found.transformStatus !== "transformed") {
    throw new CodedError(409, "RUN_NOT_TRANSFORMED", `The run's transform is ${found.transformStatus}; only a transformed run can be diffed.`);
  }
  const tenantId = found.transformTenantId;
  if (tenantId === null) {
    throw new CodedError(409, "RUN_NOT_TRANSFORMED", "The run names no provider tenant.");
  }
  const connection = createTransformDb();
  try {
    return await connection.transaction(async (transaction) => {
      const runner = connection as unknown as SqlRunner;
      // The transform role, not a superuser (the runner's own proof, P24-01).
      const [role] = await sql<{ currentUser: string }>(runner, 'SELECT current_user AS "currentUser"', [], { transaction });
      if (role?.currentUser !== transformRoleName()) {
        throw new AppError(500, "The report diff's connection is not the transform role.");
      }
      const context: StepContext = { runId, runner, transaction, tenantId, sourceZone: sourceTimeZone() };
      const { zone } = await tenantOf(context);
      const [population] = await sql<{ n: number }>(
        runner,
        "SELECT count(*)::int AS n FROM inspection_sessions WHERE tenant_id = $1 AND legacy_key IS NOT NULL",
        [tenantId],
        { transaction },
      );
      const sessions = await sql<SessionRow>(
        runner,
        `SELECT s.id, s.legacy_key AS "legacyKey", s.client_facility_id AS "facilityId",
                to_char(s.performed_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
                s.performer_snapshot AS performer, s.device_snapshot AS device, s.facility_snapshot AS facility, s.room_snapshot AS room,
                s.legacy_visit_number AS "legacyVisitNumber", s.inspection_outcome::text AS "inspectionOutcome",
                s.maintenance_outcome::text AS "maintenanceOutcome", s.recommendation::text AS recommendation, s.notes
           FROM inspection_sessions s
          WHERE s.tenant_id = $1 AND s.legacy_key IS NOT NULL
          ORDER BY md5(s.legacy_key)
          LIMIT $3`,
        [tenantId, zone, sample],
        { transaction },
      );
      const results = await sql<StoredResult & { sessionId: string }>(
        runner,
        `SELECT r.id, r.session_id AS "sessionId", r.label_snapshot AS label, r.outcome::text AS outcome, r.cleanliness::text AS cleanliness,
                r.measured_value::text AS "measuredValue", r.measured_value_1::text AS "measuredValue1", r.measured_value_2::text AS "measuredValue2",
                r.raw_value AS "rawValue", r.setting_text AS setting, r.reference_text AS reference, r.symbol, r.warn_flag AS "warnFlag"
           FROM inspection_results r
          WHERE r.tenant_id = $1 AND r.session_id = ANY($2::uuid[])`,
        [tenantId, sessions.map((s) => s.id)],
        { transaction },
      );
      const resultsOf = new Map<string, StoredResult[]>();
      for (const { sessionId, ...result } of results) {
        const list = resultsOf.get(sessionId) ?? [];
        list.push(result);
        resultsOf.set(sessionId, list);
      }
      const keys = sessions.map((s) => s.legacyKey);
      const qrOf = (key: string): string => key.slice(0, key.lastIndexOf("|"));
      const staged = await stagedRowsByKey(context, zone, keys);
      const devices = await stagedDevices(context, keys.map(qrOf));
      const users = await stagedUsers(context);
      const cases = sessions.map((s) => {
        const device = devices.get(qrOf(s.legacyKey));
        return compareSession({
          day: s.legacyKey.slice(s.legacyKey.lastIndexOf("|") + 1),
          device: device?.row ?? null,
          facilityName: device?.facilityName ?? null,
          serialShared: device?.shared ?? false,
          rows: staged.get(s.legacyKey) ?? [],
          users,
          stored: {
            day: s.day,
            device: s.device ?? {},
            facilityName: s.facility?.name ?? null,
            room: s.room,
            performerName: s.performer?.name ?? null,
            legacyVisitNumber: s.legacyVisitNumber,
            inspectionOutcome: s.inspectionOutcome,
            maintenanceOutcome: s.maintenanceOutcome,
            recommendation: s.recommendation,
            notes: s.notes,
            results: resultsOf.get(s.id) ?? [],
          },
        });
      });
      return {
        runId,
        providerTenantId: tenantId,
        sample: {
          requested: sample,
          population: population?.n ?? 0,
          sessions: sessions.length,
          facilities: new Set(sessions.map((s) => s.facilityId)).size,
        },
        fields: tallyFields(UPSTREAM_REPORT_DIFF_FIELDS, cases),
      };
    });
  } finally {
    await connection.close();
  }
};
