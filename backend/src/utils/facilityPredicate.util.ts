/**
 * P21-09d — the facility predicate for a raw statement (spec MEMORY/specs/P19-04-client-facilities.md
 * § 8; threat model AM-9, FT-35; G-14).
 *
 * Raw SQL bypasses the hooks, so a raw statement over a facility-scoped table that a BOUND
 * principal can reach must carry the facility predicate itself — bound, from the CONTEXT only.
 * There is deliberately no facility parameter: a caller cannot name a facility (AM-9). The clause
 * is appended LAST (`position = bind.length + 1`), so an empty clause shifts no placeholder.
 *
 *   no context / system task / super admin / unbound -> { clause: "", bind: [] }
 *   bound                                             -> { clause: " AND <column> = $<position>", bind: [facility] }
 *   bound with no resolvable facility                 -> the same clause bound to NO_FACILITY_ID (deny)
 *
 * No `IS NULL OR` form exists; tests/utils/rawSqlFacilityPredicate.d05twin refuses one anywhere.
 * Named exports only (ADR-087 Am. 15).
 */
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { NO_FACILITY_ID } from "../types/ids";
import type { BindValue } from "./sql.util";

/** The column a clause may name: an allow-listed SHAPE (an identifier, never a value). */
export type FacilityColumn = "client_facility_id" | `${string}.client_facility_id`;

/** The shape a FacilityColumn must have at run time too (a JavaScript caller, a cast). */
const COLUMN_SHAPE = /^([a-z_]+\.)?client_facility_id$/;

/** A clause and the one value it binds (or nothing). */
export interface FacilityClause {
  readonly clause: string;
  readonly bind: BindValue[];
}

/**
 * The facility clause for a raw statement, from the active context.
 *
 * @param column - the facility column, optionally qualified by a table alias
 * @param position - the `$n` the clause binds (the statement's bind length + 1)
 * @returns the clause to append and the values to append to `bind`
 * @throws TypeError on a column outside the allow-listed shape or a position below 1
 */
export const facilityClause = (column: FacilityColumn, position: number): FacilityClause => {
  if (!COLUMN_SHAPE.test(column)) {
    throw new TypeError(`facilityClause(): "${column}" is not a facility column (AM-9)`);
  }
  if (!Number.isInteger(position) || position < 1) {
    throw new TypeError(`facilityClause(): position must be a positive integer, got ${String(position)}`);
  }
  const ctx = tenantStorage.getStore();
  if (!ctx || ctx.isSystemTask || ctx.isSuperAdmin || ctx.facilityBound !== true) {
    return { clause: "", bind: [] };
  }
  return { clause: ` AND ${column} = $${String(position)}`, bind: [ctx.clientFacilityId ?? NO_FACILITY_ID] };
};
