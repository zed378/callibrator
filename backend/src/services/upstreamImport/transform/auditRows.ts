/**
 * Step 13 of the transform (P24-02a; ADR-129 Am. 3; 04 § 7, UD-13): ONE audit row per
 * application row the transform wrote, inside the transform's one transaction — so a rolled-back
 * transform leaves no audit row, and a committed one leaves no unattributed row.
 *
 * What "wrote" means: an `id_map` row of this run touched in THIS transaction (its `updated_at`
 * is the transaction's `now()`; `recordMappings` sets it on insert and on update). An unchanged
 * row the step skipped is not touched, so a re-run of the same dump writes no new audit row.
 * Several upstream rows merged into one target (duplicate names) are ONE audit row. Only the
 * tables a step WRITES are audited (RESOURCE_TYPES): a use-only row mapped to what it decided —
 * an upstream group to its role (P24-02b) — writes no row, because nothing was created.
 *
 *  - `action` CREATE when a mapping of the target was first made in this transaction
 *    (`imported_at = now()`), UPDATE otherwise;
 *  - actor `system:upstream-transform` (constants/systemActors.ts), no user;
 *  - the row's tenant (`id_map.tenant_id`; the PLATFORM tenant for the global catalogue) and its
 *    facility (`id_map.client_facility_id`, AM-28 — the facility the transform decided);
 *  - `changes`: `{ operation: "UPSTREAM_IMPORT", source: "skp_ipm", importRunId, sourceTable,
 *    targetTable }` — never a legacy id or a value (07 § 3: the legacy link lives only in
 *    `id_map`, archived and dropped at decommission).
 *
 * P24-02d (ADR-129 Am. 6): the template tables are STEP_AUDITED — step 5 writes the catalogue
 * service's own rows (CREATE per template, APPROVE per published version) and this step skips them,
 * so an item of a new version is never audited as an UPDATE of a row it never was.
 */
import { sql } from "../../../utils/sql.util";
import { PLATFORM_TENANT_ID } from "../../../constants/platformTenant";
import { SYSTEM_ACTORS } from "../../../constants/systemActors";
import { ID_MAP } from "./ledger";
import type { StepContext } from "./steps";

/** The audit `resource_type` of every table a step writes (steps.ts `writes`). */
export const RESOURCE_TYPES: Readonly<Record<string, string>> = Object.freeze({
  client_facilities: "ClientFacility",
  users: "User",
  device_types: "DeviceType",
  inspection_item_definitions: "InspectionItemDefinition",
  inspection_templates: "InspectionTemplate",
  inspection_template_versions: "InspectionTemplateVersion",
  inspection_template_items: "InspectionTemplateItem",
  vendors: "Vendor",
  warehouses: "Warehouse",
  calibration_devices: "CalibrationDevice",
  attachments: "Attachment",
  calibration_records: "CalibrationRecord",
  inspection_sessions: "InspectionSession",
  inspection_results: "InspectionResult",
});

/** The tables whose step writes its own audit rows (templates.ts); step 13 leaves them alone. */
export const STEP_AUDITED: ReadonlySet<string> = new Set(["inspection_templates", "inspection_template_versions", "inspection_template_items"]);

/** Step 13's `run`: the audit rows of everything this transaction wrote. */
export const runAuditRows = async (context: StepContext): Promise<void> => {
  const tables = Object.keys(RESOURCE_TYPES).filter((table) => !STEP_AUDITED.has(table));
  await sql(
    context.runner,
    `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id,
                             client_facility_id, changes, created_at)
     SELECT gen_random_uuid(), coalesce(w.tenant_id, $3::uuid), NULL, 'system', $4,
            w.action::"enum_audit_logs_action", r.resource_type, w.target_id::text,
            w.client_facility_id,
            jsonb_build_object('operation', 'UPSTREAM_IMPORT', 'source', 'skp_ipm', 'importRunId', $1::text,
                               'sourceTable', w.source_table, 'targetTable', w.target_table),
            now()
       FROM (SELECT m.target_table, m.target_id, m.tenant_id, m.client_facility_id, min(m.source_table) AS source_table,
                    CASE WHEN bool_or(m.imported_at = now()) THEN 'CREATE' ELSE 'UPDATE' END AS action
               FROM ${ID_MAP} m
              WHERE m.import_run_id = $1 AND m.updated_at = now() AND (m.tenant_id = $2 OR m.tenant_id IS NULL)
              GROUP BY m.target_table, m.target_id, m.tenant_id, m.client_facility_id) w
       JOIN unnest($5::text[], $6::text[]) AS r(target_table, resource_type) ON r.target_table = w.target_table
      ORDER BY w.target_table, w.target_id`,
    [
      context.runId,
      context.tenantId,
      PLATFORM_TENANT_ID,
      SYSTEM_ACTORS.UPSTREAM_TRANSFORM,
      tables,
      tables.map((t) => RESOURCE_TYPES[t] as string),
    ],
    { transaction: context.transaction },
  );
};
